import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { diskPathKey } from './diskPath';

const extensions = new Set(['.zip','.smap','.png','.jpg','.jpeg','.webp']);

export class ExportDownloads {
  private key?: Buffer;
  constructor(private readonly roots: string[], private readonly keyFile: string) {}

  private secret(): Buffer {
    if (this.key) return this.key;
    if (!fs.existsSync(this.keyFile)) {
      fs.mkdirSync(path.dirname(this.keyFile),{recursive:true});
      try { fs.writeFileSync(this.keyFile,randomBytes(32),{flag:'wx',mode:0o600}); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const key = fs.readFileSync(this.keyFile);
    if (key.length !== 32) throw Error('Invalid local download key');
    return this.key = key;
  }

  private signature(file: string, stat: fs.Stats): Buffer {
    return createHmac('sha256',this.secret()).update(JSON.stringify([diskPathKey(file),stat.size,stat.mtimeMs])).digest();
  }

  link(file: string): string {
    const canonical = fs.realpathSync(file);
    const query = new URLSearchParams({path:canonical, token:this.signature(canonical,fs.statSync(canonical)).toString('hex')});
    return '/api/exports/download?' + query;
  }

  resolve(file: string, token: unknown): string | undefined {
    if (!path.isAbsolute(file) || !extensions.has(path.extname(file).toLowerCase())) return;
    const canonical = fs.realpathSync(file);
    const stat = fs.statSync(canonical);
    if (!extensions.has(path.extname(canonical).toLowerCase()) || !stat.isFile()) return;
    if (this.roots.some(root => {
      let directory: string;
      try { directory = fs.realpathSync(root); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
      const rel = path.relative(directory,canonical);
      return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
    })) return canonical;
    if (typeof token === 'string' && /^[a-f\d]{64}$/.test(token) &&
        timingSafeEqual(this.signature(canonical,stat),Buffer.from(token,'hex'))) return canonical;
  }
}
