import { parsePmsFull, serializePms, soldatCrc32, type PmsMapData } from '@shared/pmsParser';
import { readStudioProjectData } from '@shared/studioProjectData';
import type { TunnelProject } from '@shared/tunnelProject';
import type { TunnelSketch } from '@shared/tunnelSketch';
import { t } from '../i18n';
import { mapAssetOriginId, rememberAssetOrigin, restoreAssetOrigin } from '../renderer/mapAssetSource';

// Four magic bytes, then four little-endian uint32s: version, JSON size, PMS size, checksum of both payloads.
const MAGIC = 0x50534d53;
const VERSION = 1;
const HEADER_SIZE = 20;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const utf8 = new TextEncoder();

export interface OpenedStudioProject {
  baseName: string;
  map: PmsMapData;
  tunnels: TunnelProject[];
  sketch?: TunnelSketch;
}

function validBaseName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 255 &&
    !/[<>:"/\\|?*\u0000-\u001f]/u.test(value) && value !== '.' && value !== '..';
}

function checkSize(total: number, manifestSize: number) {
  if (total > MAX_FILE_BYTES || manifestSize > MAX_MANIFEST_BYTES) {
    throw new Error(t('This project exceeds the supported file size.'));
  }
}

export function encodeProjectFile(
  baseName: string,
  preparedMap: PmsMapData,
  tunnels: TunnelProject[] = preparedMap.editorTunnels ?? [],
  sketch: TunnelSketch | undefined = preparedMap.editorSketch,
): Uint8Array<ArrayBuffer> {
  if (!validBaseName(baseName)) throw new Error(t('The project needs a valid map file name.'));
  const data = readStudioProjectData(tunnels, sketch, mapAssetOriginId(preparedMap));
  if (!data) throw new Error(t('The tunnel editing data in this project is invalid.'));
  const manifest = utf8.encode(JSON.stringify({ baseName, ...data }));
  const pms = serializePms(preparedMap);
  const length = HEADER_SIZE + manifest.length + pms.length;
  checkSize(length, manifest.length);
  const bytes = new Uint8Array(length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, MAGIC, true);
  header.setUint32(4, VERSION, true);
  header.setUint32(8, manifest.length, true);
  header.setUint32(12, pms.length, true);
  bytes.set(manifest, HEADER_SIZE);
  bytes.set(pms, HEADER_SIZE + manifest.length);
  header.setUint32(16, soldatCrc32(bytes.subarray(HEADER_SIZE)), true);
  return bytes;
}

export function decodeProjectFile(bytes: Uint8Array): OpenedStudioProject {
  if (bytes.length < HEADER_SIZE) throw new Error(t('Choose a Soldat Map Studio project (.smaproj).'));
  const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  if (header.getUint32(0, true) !== MAGIC) throw new Error(t('Choose a Soldat Map Studio project (.smaproj).'));
  if (header.getUint32(4, true) !== VERSION) throw new Error(t('This project uses an unsupported file version.'));
  const manifestSize = header.getUint32(8, true);
  const pmsSize = header.getUint32(12, true);
  checkSize(bytes.length, manifestSize);
  if (!manifestSize || !pmsSize || bytes.length !== HEADER_SIZE + manifestSize + pmsSize ||
      header.getUint32(16, true) !== soldatCrc32(bytes.subarray(HEADER_SIZE))) {
    throw new Error(t('The project is incomplete or damaged.'));
  }
  let manifest: unknown;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_SIZE, HEADER_SIZE + manifestSize));
    manifest = JSON.parse(json);
  } catch {
    throw new Error(t('The project is incomplete or damaged.'));
  }
  if (!manifest || typeof manifest !== 'object' || !('baseName' in manifest) || !validBaseName(manifest.baseName)) {
    throw new Error(t('The project needs a valid map file name.'));
  }
  const data = readStudioProjectData('tunnels' in manifest ? manifest.tunnels : undefined, 'sketch' in manifest ? manifest.sketch : undefined,
    'assetMapId' in manifest ? manifest.assetMapId : undefined);
  if (!data) throw new Error(t('The tunnel editing data in this project is invalid.'));
  let map: PmsMapData;
  try {
    // PMS records keep raw byte views. Keep only their backing bytes for the life of the open map.
    const pms = new Uint8Array(bytes.subarray(HEADER_SIZE + manifestSize));
    map = parsePmsFull(pms);
    if (map.parseWarnings.length) throw new Error();
  } catch {
    throw new Error(t('The map stored inside the project is damaged.'));
  }
  if (data.tunnels?.length) map.editorTunnels = data.tunnels;
  if (data.sketch) map.editorSketch = data.sketch;
  if (data.assetMapId) rememberAssetOrigin(map,data.assetMapId);
  return { baseName: manifest.baseName, map, tunnels: data.tunnels ?? [], sketch: data.sketch };
}

export async function readProjectFile(file: File): Promise<OpenedStudioProject> {
  checkSize(file.size, 0);
  const project=decodeProjectFile(new Uint8Array(await file.arrayBuffer()));
  await restoreAssetOrigin(project.map,mapAssetOriginId(project.map));
  return project;
}

interface ProjectSaveHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<ProjectSaveHandle>;

export async function downloadProjectFile(
  baseName: string,
  preparedMap: PmsMapData,
  tunnels?: TunnelProject[],
  sketch?: TunnelSketch,
): Promise<'written' | 'download-started' | false> {
  const fileName = baseName + '.smaproj';
  const blob = new Blob([encodeProjectFile(baseName, preparedMap, tunnels, sketch)], { type: 'application/octet-stream' });
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    let handle: ProjectSaveHandle;
    try {
      handle = await picker.call(window, {
        suggestedName: fileName,
        types: [{ description: 'Soldat Map Studio', accept: { 'application/octet-stream': ['.smaproj'] } }],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      // Embedded browsers can expose the API while disabling pickers for this origin.
      if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
      return downloadBlob(blob, fileName);
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    return 'written';
  }
  return downloadBlob(blob, fileName);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // Browser downloads do not acknowledge the user's final Save/Cancel decision.
  return 'download-started' as const;
}
