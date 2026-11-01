import fs from 'fs';
import path from 'path';
import { PackBuildOptions, PackPreset } from '../shared/apiTypes';

const MAX_PRESETS = 50;

type PresetOptions = PackPreset['options'];

/** Saved pack option sets ("presets") in `data/pack-presets.json` */
export class PackPresetStore {
  private presets: PackPreset[] = [];

  constructor(private readonly filePath: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const list = Array.isArray(raw?.presets) ? raw.presets : [];
      for (const p of list) {
        const name = sanitizePresetName(p?.name);
        if (name) this.presets.push({ name, options: sanitizePresetOptions(p?.options), updatedAt: Number(p?.updatedAt) || 0 });
      }
    } catch {
      // No presets yet
    }
  }

  public list(): PackPreset[] {
    return [...this.presets].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }

  public save(rawName: unknown, rawOptions: unknown): PackPreset[] {
    const name = sanitizePresetName(rawName);
    if (!name) throw new Error('Podaj nazwę presetu.');
    const preset: PackPreset = { name, options: sanitizePresetOptions(rawOptions), updatedAt: Date.now() };
    const idx = this.presets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) this.presets[idx] = preset;
    else {
      if (this.presets.length >= MAX_PRESETS) throw new Error(`Można zapisać najwyżej ${MAX_PRESETS} presetów.`);
      this.presets.push(preset);
    }
    this.persist();
    return this.list();
  }

  public remove(rawName: unknown): PackPreset[] {
    const name = sanitizePresetName(rawName).toLowerCase();
    this.presets = this.presets.filter((p) => p.name.toLowerCase() !== name);
    this.persist();
    return this.list();
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, presets: this.presets }, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }
}

function sanitizePresetName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 48) : '';
}

/** Keeps only known pack options with valid values (a damaged file can never break the pack builder) */
export function sanitizePresetOptions(raw: unknown): PresetOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<PackBuildOptions>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    packName: typeof o.packName === 'string' && o.packName.trim() ? o.packName.trim().slice(0, 80) : 'Soldat_MapPack',
    outputFormat: o.outputFormat === 'smap' || o.outputFormat === 'folder' ? o.outputFormat : 'zip',
    splitBy: o.splitBy === 'prefix' || o.splitBy === 'mode' ? o.splitBy : 'none',
    excludeVanillaAssets: bool(o.excludeVanillaAssets, true),
    excludeUnusedScenery: bool(o.excludeUnusedScenery, true),
    includePngOverrides: bool(o.includePngOverrides, true),
    includeEdgeTextures: bool(o.includeEdgeTextures, true),
    fixLinuxCase: bool(o.fixLinuxCase, true),
    generateMapsListTxt: bool(o.generateMapsListTxt, true),
    generateReadmeManifest: bool(o.generateReadmeManifest, true),
    generateCrcManifest: bool(o.generateCrcManifest, true),
    customOutputFolder:
      typeof o.customOutputFolder === 'string' && o.customOutputFolder.trim() ? o.customOutputFolder.trim() : undefined,
  };
}
