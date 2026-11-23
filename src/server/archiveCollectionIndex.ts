import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { classifyArchivePath, type ArchiveInputKind, type ArchiveInputOptions } from './archiveInputs';

const catalogPath = path.join('txt & other', '_collection', 'index.sqlite');

function relativeParts(name: string) {
  const parts = name.replaceAll('\\', '/').split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[:\x00]/.test(p))) {
    throw new Error('Invalid path in SMA collection index');
  }
  return parts;
}

function mappedKind(parts: string[]): ArchiveInputKind | undefined {
  const lower = parts.map(s => s.toLowerCase());
  if (lower[0] === 'maps' && lower.at(-1)?.endsWith('.pms')) return 'map';
  if (lower[0] === 'duplicates') lower.splice(0, 1);
  if (lower[0] === 'scenery-gfx') return 'scenery';
  if (lower[0] === 'textures' && !lower.includes('objects')) {
    return lower.includes('edges') ? 'edge' : 'texture';
  }
  return undefined;
}

export async function scanIndexedCollection(root: string, options: ArchiveInputOptions) {
  const collectionDir = [root, path.join(root, 'Maps')].find(d => fs.existsSync(path.join(d, catalogPath)));
  if (!collectionDir) return null;
  const canonical = await fs.promises.realpath(collectionDir);
  const under = (p: string, base=canonical) => {
    const relative = path.relative(base, p);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  const file = path.join(collectionDir, catalogPath);
  if (!under(await fs.promises.realpath(file)) || !under(canonical, await fs.promises.realpath(root))) {
    throw new Error('Collection index is outside the source folder');
  }
  const stat = await fs.promises.stat(file);
  const db = new DatabaseSync(file, { readOnly: true });
  const coveredPackages = new Set<string>(), coveredFiles = new Set<string>();
  const changedPackages = new Set<string>();
  const checked = new Map<string, {size: number; stamp: number}>();
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    const schema = db.prepare("SELECT name FROM pragma_table_list WHERE schema='main' AND type='table'").all();
    if (!['entries','files','archives'].every(t => schema.some(r => r.name === t))) {
      throw new Error('Incomplete SMA collection index');
    }
    let records=0;
    for (const row of db.prepare('SELECT path FROM files').iterate()) {
      if (++records > 2_500_000) throw new Error('SMA index file limit exceeded');
      coveredFiles.add(path.join(collectionDir, ...relativeParts(String(row.path))));
    }
    coveredFiles.add(file);
    if (root !== collectionDir) {
      const packs = db.prepare("SELECT source, volumes FROM archives WHERE instr(source,'!/')=0");
      for (const row of packs.iterate()) {
        if(String(row.volumes).length>1024*1024)throw new Error('Invalid SMA volume list');
        const volumes: unknown = JSON.parse(String(row.volumes));
        if (!Array.isArray(volumes) || !volumes.every(v => typeof v === 'string')) throw new Error('Invalid SMA volume list');
        let newer=false, complete=true;
        const regular:string[]=[];
        for (const vol of volumes) {
          const resolved = path.join(root, ...relativeParts(vol));
          const pkg = await fs.promises.lstat(resolved).catch(() => null);
          if (pkg?.isFile()) {
            regular.push(resolved);
            newer ||= pkg.mtimeMs>stat.mtimeMs;
          } else complete=false;
        }
        if(newer && complete && options.includeArchives!==false){
          changedPackages.add(String(row.source).replaceAll('\\','/'));
        }else{
          for(const member of regular)coveredPackages.add(member);
          if(newer && !complete) options.onIssue?.({path:String(row.source),reason:'Updated volume set incomplete; using verified indexed snapshot'});
        }
      }
    }
    const select = db.prepare('SELECT e.source, e.destination, f.sha256, f.size FROM entries e LEFT JOIN files f ON f.path=e.destination ORDER BY e.rowid');
    for (const row of select.iterate()) {
      options.signal?.throwIfAborted();
      if (++records > 2_500_000) throw new Error('SMA index entry limit exceeded');
      if (row.sha256 === null) throw new Error('Missing file record in SMA index: ' + row.destination);
      const parts = relativeParts(String(row.destination));
      const virtualPath = String(row.source).replaceAll('\\', '/');
      if(changedPackages.has(virtualPath.split('!/',1)[0]))continue;
      const kind = mappedKind(parts);
      if (!kind) {
        if (parts[0].toLowerCase() === 'maps' && /\.pmp$/i.test(virtualPath)) {
          options.onIssue?.({path:virtualPath,reason:'Legacy .pmp format requires separate conversion'});
        }
        continue;
      }
      // The extractor also recognised one extensionless PMS by its header.
      const refPath = kind === 'map' && !/\.pms$/i.test(virtualPath) ? virtualPath + '.pms' : virtualPath;
      const meta = classifyArchivePath(refPath);
      if (!meta) {
        options.onIssue?.({path:virtualPath,reason:'Unrecognised original entry name in collection index'});
        continue;
      }
      const materializedPath = path.join(collectionDir, ...parts);
      const digest = String(row.sha256), size = Number(row.size);
      if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(size) || size < 0 || size > 268435456) {
        options.onIssue?.({path:virtualPath,reason:'Invalid size or SHA-256 in collection index'});
        continue;
      }
      await options.onEntry?.({
        ...meta, kind, path: virtualPath, size, scope: meta.scope,
        // The index records neither an author's timestamp nor an original ZIP timestamp.
        mtimeMs: 0, verifiedSha256: digest, materializedPath,
        read: async () => {
          if (!under(await fs.promises.realpath(materializedPath))) throw new Error('Indexed file escapes collection');
          const handle = await fs.promises.open(materializedPath, 'r');
          try {
            const info = await handle.stat();
            if (!info.isFile() || info.size !== size) throw new Error('Indexed file size changed: ' + materializedPath);
            const bytes = await handle.readFile();
            const memo = checked.get(materializedPath);
            if (!memo || memo.stamp !== info.mtimeMs || memo.size !== size) {
              if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Indexed SHA-256 mismatch: ' + materializedPath);
              checked.set(materializedPath, {size,stamp:info.mtimeMs});
            }
            return bytes;
          } finally { await handle.close(); }
        }
      });
    }
    return { collectionDir, coveredPackages, coveredFiles };
  } finally { db.close(); }
}
