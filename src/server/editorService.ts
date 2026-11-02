import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  EditorAssetCatalogResponse,
  EditorAssetItem,
  EditorDraftPayload,
  EditorDraftSummary,
  EditorPrefabElementBundle,
  EditorPrefabItem,
  EditorSaveCheckRequest,
  EditorSaveCheckResponse,
  EditorSaveDestination,
  EditorSaveRequest,
  EditorSaveResponse,
} from '../shared/apiTypes';
import {
  checkSoldatMapLimits,
  parsePmsFull,
  PmsBounds,
  soldatCrc32,
} from '../shared/pmsParser';
import { t } from './i18n';
import {
  BackupSession,
  GeneratedOutputRegistry,
  WorkshopError,
  writeFileAtomic,
} from './safeFileWriter';
import { SoldatMapScanner } from './soldatScanner';

const ALLOWED_IMAGE_EXT = new Set(['.bmp', '.png', '.jpg', '.jpeg', '.gif', '.tga']);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_DRAFTS_KEPT = 30;
const MAX_PREFABS_KEPT = 500;

export function sanitizeMapBaseName(raw: string): string {
  const trimmed = String(raw || '')
    .trim()
    .replace(/\.pms$/i, '')
    .trim();
  if (!trimmed) {
    throw new WorkshopError(t('Enter a map file name.'), 400);
  }
  if (/[<>:"/\\|?*\x00-\x1F]/.test(trimmed) || trimmed.includes('..') || /[.\s]$/.test(trimmed)) {
    throw new WorkshopError(
      t('Invalid map file name "{name}" — avoid special path characters.', { name: trimmed }),
      400
    );
  }
  if (WINDOWS_RESERVED_NAMES.test(trimmed)) {
    throw new WorkshopError(
      t('Invalid map file name "{name}" — reserved system name.', { name: trimmed }),
      400
    );
  }
  if (trimmed.length > 64) {
    throw new WorkshopError(t('Map file name is too long (maximum 64 characters).'), 400);
  }
  return trimmed;
}

function sanitizeSafeToken(raw: string, fallback = 'draft'): string {
  const clean = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 64);
  return clean || fallback;
}

export class SoldatMapEditorService {
  private readonly draftsDir: string;
  private readonly prefabsFile: string;

  constructor(
    private readonly scanner: SoldatMapScanner,
    private readonly exportsRoot: string,
    private readonly dataDir: string,
    private readonly backupsRoot: string,
    private readonly registry: GeneratedOutputRegistry
  ) {
    this.draftsDir = path.join(this.dataDir, 'editor-drafts');
    this.prefabsFile = path.join(this.dataDir, 'editor-prefabs.json');
  }

  public listAssets(): EditorAssetCatalogResponse {
    const resolver = this.scanner.getResolver();
    const edgeEntries = resolver.listCategoryEntries('textures/edges');
    const edgeStems = new Set<string>();
    for (const e of edgeEntries) {
      const ext = path.extname(e.diskName).toLowerCase();
      edgeStems.add(e.diskName.toLowerCase());
      if (ext) edgeStems.add(e.diskName.slice(0, -ext.length).toLowerCase());
    }

    const buildList = (category: 'textures' | 'scenery-gfx'): EditorAssetItem[] => {
      const rawEntries = resolver.listCategoryEntries(category);
      const out: EditorAssetItem[] = [];
      for (const item of rawEntries) {
        const ext = path.extname(item.diskName).toLowerCase();
        if (!ALLOWED_IMAGE_EXT.has(ext)) continue;
        const isVanilla = resolver.isVanillaAsset(category, item.diskName);
        let hasEdge: boolean | undefined;
        if (category === 'textures') {
          const stem = item.diskName.slice(0, -ext.length).toLowerCase();
          hasEdge = edgeStems.has(item.diskName.toLowerCase()) || edgeStems.has(stem);
        }
        out.push({
          name: item.diskName,
          category,
          isVanilla,
          sizeBytes: item.size,
          sourcePriority: item.sourcePriority,
          ...(hasEdge !== undefined ? { hasEdge } : {}),
        });
      }
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      return out;
    };

    return {
      textures: buildList('textures'),
      sceneries: buildList('scenery-gfx'),
    };
  }

  private resolveTargetDir(destination: EditorSaveDestination, customOutputFolder?: string): string {
    if (destination === 'soldat_maps') {
      const root = this.scanner.getResolver().getRoot();
      if (!root || !fs.existsSync(root)) {
        throw new WorkshopError(
          t('The Soldat game folder is not configured — choose Exports or a custom folder.'),
          400
        );
      }
      return path.join(root, 'maps');
    }
    if (destination === 'custom') {
      if (!customOutputFolder?.trim()) {
        throw new WorkshopError(t('Choose a custom target folder or change the save location.'), 400);
      }
      return path.resolve(customOutputFolder.trim());
    }
    return path.join(this.exportsRoot, 'edited_maps', 'maps');
  }

  public checkSaveTarget(req: EditorSaveCheckRequest): EditorSaveCheckResponse {
    const baseName = sanitizeMapBaseName(req.baseName);
    const fileName = `${baseName}.pms`;
    const targetDir = this.resolveTargetDir(req.destination, req.customOutputFolder);
    const outputPath = path.join(targetDir, fileName);

    const srcPath = req.sourceMapId ? this.scanner.getMapFilePath(req.sourceMapId) : null;
    const isSameAsSource = Boolean(
      srcPath && path.resolve(srcPath).toLowerCase() === path.resolve(outputPath).toLowerCase()
    );

    const exists = fs.existsSync(outputPath);
    let existingMapTitle: string | null = null;
    if (exists) {
      try {
        existingMapTitle = parsePmsFull(fs.readFileSync(outputPath)).mapName || null;
      } catch {
        existingMapTitle = null;
      }
    }

    return {
      baseName,
      fileName,
      outputPath,
      exists,
      isSameAsSource,
      existingMapTitle,
      existingWasGeneratedByStudio: exists && this.registry.isUnchanged(outputPath),
    };
  }

  public async saveEditedMap(
    req: EditorSaveRequest,
    options?: { skipRescan?: boolean }
  ): Promise<EditorSaveResponse> {
    const baseName = sanitizeMapBaseName(req.baseName);
    const fileName = `${baseName}.pms`;
    const targetDir = this.resolveTargetDir(req.destination, req.customOutputFolder);
    const outputPath = path.join(targetDir, fileName);

    if (!req.pmsBase64 || typeof req.pmsBase64 !== 'string') {
      throw new WorkshopError(t('Missing PMS map payload.'), 400);
    }

    const bytes = Buffer.from(req.pmsBase64, 'base64');
    if (bytes.byteLength < 100) {
      throw new WorkshopError(t('Invalid or empty PMS map data.'), 400);
    }

    let parsed;
    try {
      parsed = parsePmsFull(bytes);
    } catch (err) {
      throw new WorkshopError(
        t('Refusing to save invalid PMS binary: {error}', {
          error: err instanceof Error ? err.message : String(err),
        }),
        400
      );
    }

    const violations = checkSoldatMapLimits({
      polygonCount: parsed.polygons.length,
      sectorsNum: parsed.sectorsNum,
      propCount: parsed.props.length,
      sceneryCount: parsed.scenery.length,
      colliderCount: parsed.colliders.length,
      spawnCount: parsed.spawnpoints.length,
    });
    if (violations.length > 0) {
      throw new WorkshopError(
        t('Cannot save map because it exceeds Soldat engine limits ({limits}).', {
          limits: violations.map((v) => `${t(v.label)}: ${v.value} > ${v.limit}`).join(', '),
        }),
        400
      );
    }

    const exists = fs.existsSync(outputPath);
    if (exists && !req.confirmOverwrite) {
      throw new WorkshopError(
        t('File {file} already exists in the target folder. Confirm the overwrite to continue.', {
          file: fileName,
        }),
        409
      );
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const backup = new BackupSession(this.backupsRoot);
    if (exists && !this.isOwnPreviousSave(outputPath, req.documentId)) {
      backup.preserve(outputPath);
    }

    writeFileAtomic(outputPath, bytes);
    this.registry.record(outputPath, bytes, {
      kind: 'editor',
      sourceMapId: req.sourceMapId || baseName,
      ...(req.documentId ? { documentId: String(req.documentId).slice(0, 120) } : {}),
    });
    this.registry.flush();

    let newMapId: string | null = null;
    if (!options?.skipRescan && req.destination === 'soldat_maps') {
      await this.scanner.scanAsync(true);
      const entry = this.scanner.getMapEntry(baseName);
      newMapId = entry ? entry.id : null;
    }

    return {
      baseName,
      fileName,
      outputPath,
      newMapId,
      backupDir: backup.directory,
      crc32: soldatCrc32(bytes),
      fileSize: bytes.byteLength,
      meta: !options?.skipRescan ? this.scanner.getMeta() : undefined,
    };
  }

  /**
   * True when the file at `outputPath` is, unchanged, what this same editor document wrote before (Ctrl+S saving
   * again): overwriting it loses nothing the session's undo history doesn't hold, so no backup copy piles up per
   * save. Anything else (another document, even of the same map; a file edited elsewhere) is backed up first.
   */
  private isOwnPreviousSave(outputPath: string, documentId: string | undefined): boolean {
    if (!documentId) return false;
    const prev = this.registry.getRecord(outputPath);
    return Boolean(prev && prev.kind === 'editor' && prev.documentId === documentId);
  }

  // ---------------------------------------------------------------------------
  // Autosave Drafts (stored exclusively in data/editor-drafts/, NEVER in Soldat)
  // ---------------------------------------------------------------------------

  public listDrafts(): EditorDraftSummary[] {
    if (!fs.existsSync(this.draftsDir)) return [];
    const summaries: EditorDraftSummary[] = [];
    for (const entry of fs.readdirSync(this.draftsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.draftsDir, entry.name), 'utf-8'));
        if (raw && typeof raw.draftId === 'string' && typeof raw.baseName === 'string') {
          summaries.push({
            draftId: raw.draftId,
            sourceMapId: raw.sourceMapId ?? null,
            baseName: raw.baseName,
            title: String(raw.title ?? ''),
            updatedAt: Number(raw.updatedAt ?? 0),
            polygonCount: Number(raw.polygonCount ?? 0),
            propCount: Number(raw.propCount ?? 0),
            fileSize: Number(raw.fileSize ?? 0),
          });
        }
      } catch {
        // Ignore unreadable draft
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
  }

  public getDraft(draftId: string): EditorDraftPayload {
    const id = sanitizeSafeToken(draftId);
    const filePath = path.join(this.draftsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      throw new WorkshopError(t('Draft not found: {id}', { id }), 404);
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      draftId: String(raw.draftId),
      sourceMapId: raw.sourceMapId ?? null,
      baseName: String(raw.baseName || 'untitled'),
      title: String(raw.title || ''),
      updatedAt: Number(raw.updatedAt || 0),
      polygonCount: Number(raw.polygonCount || 0),
      propCount: Number(raw.propCount || 0),
      fileSize: Number(raw.fileSize || 0),
      pmsBase64: String(raw.pmsBase64 || ''),
    };
  }

  public saveDraft(
    draftId: string,
    body: { sourceMapId?: string | null; baseName: string; pmsBase64: string }
  ): EditorDraftSummary {
    const id = sanitizeSafeToken(draftId);
    const bytes = Buffer.from(String(body.pmsBase64 || ''), 'base64');
    if (bytes.byteLength < 88) {
      throw new WorkshopError(t('Invalid or empty PMS map data.'), 400);
    }
    const parsed = parsePmsFull(bytes);

    fs.mkdirSync(this.draftsDir, { recursive: true });
    const payload: EditorDraftPayload = {
      draftId: id,
      sourceMapId: body.sourceMapId ?? null,
      baseName: String(body.baseName || 'untitled').slice(0, 64),
      title: parsed.mapName,
      updatedAt: Date.now(),
      polygonCount: parsed.polygons.length,
      propCount: parsed.props.length,
      fileSize: bytes.byteLength,
      pmsBase64: bytes.toString('base64'),
    };
    const filePath = path.join(this.draftsDir, `${id}.json`);
    writeFileAtomic(filePath, Buffer.from(JSON.stringify(payload), 'utf-8'));

    // Prune oldest drafts beyond MAX_DRAFTS_KEPT
    const all = this.listDrafts();
    for (const stale of all.slice(MAX_DRAFTS_KEPT)) {
      try {
        fs.rmSync(path.join(this.draftsDir, `${sanitizeSafeToken(stale.draftId)}.json`), { force: true });
      } catch {
        // Ignore
      }
    }

    const { pmsBase64: _b64, ...summary } = payload;
    return summary;
  }

  public deleteDraft(draftId: string): void {
    const id = sanitizeSafeToken(draftId);
    const filePath = path.join(this.draftsDir, `${id}.json`);
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Reusable Prefabs (stored in data/editor-prefabs.json)
  // ---------------------------------------------------------------------------

  public listPrefabs(): EditorPrefabItem[] {
    if (!fs.existsSync(this.prefabsFile)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.prefabsFile, 'utf-8'));
      if (Array.isArray(parsed)) {
        return parsed.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      }
    } catch {
      // Ignore
    }
    return [];
  }

  public savePrefab(body: {
    id?: string;
    name: string;
    bounds: PmsBounds;
    bundle: EditorPrefabElementBundle;
  }): EditorPrefabItem {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) {
      throw new WorkshopError(t('Enter a prefab name.'), 400);
    }
    if (!body.bundle || typeof body.bundle !== 'object') {
      throw new WorkshopError(t('Prefab has no elements.'), 400);
    }
    const totalElements =
      (body.bundle.polygons?.length || 0) +
      (body.bundle.props?.length || 0) +
      (body.bundle.spawns?.length || 0) +
      (body.bundle.colliders?.length || 0) +
      (body.bundle.waypoints?.length || 0);
    if (totalElements === 0) {
      throw new WorkshopError(t('Prefab has no elements.'), 400);
    }

    const existing = this.listPrefabs();
    const now = Date.now();
    const id = body.id ? sanitizeSafeToken(body.id, crypto.randomUUID()) : crypto.randomUUID();
    const prevIdx = existing.findIndex((p) => p.id === id);

    const item: EditorPrefabItem = {
      id,
      name,
      createdAt: prevIdx >= 0 ? existing[prevIdx].createdAt : now,
      updatedAt: now,
      bounds: body.bounds,
      bundle: body.bundle,
    };

    const next = prevIdx >= 0 ? existing.map((p, idx) => (idx === prevIdx ? item : p)) : [item, ...existing];
    if (next.length > MAX_PREFABS_KEPT) {
      throw new WorkshopError(t('You can save at most {max} prefabs.', { max: MAX_PREFABS_KEPT }), 400);
    }

    fs.mkdirSync(path.dirname(this.prefabsFile), { recursive: true });
    writeFileAtomic(this.prefabsFile, Buffer.from(JSON.stringify(next, null, 2), 'utf-8'));
    return item;
  }

  public deletePrefab(id: string): void {
    const cleanId = sanitizeSafeToken(id, '');
    if (!cleanId || !fs.existsSync(this.prefabsFile)) return;
    const next = this.listPrefabs().filter((p) => p.id !== cleanId);
    fs.mkdirSync(path.dirname(this.prefabsFile), { recursive: true });
    writeFileAtomic(this.prefabsFile, Buffer.from(JSON.stringify(next, null, 2), 'utf-8'));
  }
}
