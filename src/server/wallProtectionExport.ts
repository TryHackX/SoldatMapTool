import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { guardedMapNames } from '../shared/guardedMapNames';
import { parsePmsFull, serializePms } from '../shared/pmsParser';
import { checkWallSettings, insertWallProtection, planWallProtection, wallSourceProblem, type WallSettings } from '../shared/wallProtection';

interface Request {
  run: string; crc: number; maxLength: number; settings: WallSettings;
}

export async function exportGuardedMap(root: string, source: string, request: Request) {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.run) ||
      ![16,20,24,32].includes(request.maxLength)) throw Error('Invalid export settings');
  checkWallSettings(request.settings);
  const bytes = await fs.readFile(source);
  const map = parsePmsFull(bytes);
  if (map.crc32!==request.crc) throw Error('Map changed. Reload the library before exporting.');
  const issue=wallSourceProblem(map);
  if(issue) throw Error(issue);
  const plan = planWallProtection(map,request.settings);
  if (!plan.polygons.length) return {added:0};
  const output = serializePms(insertWallProtection(map,plan));
  const folder = path.join(root,request.run.toLowerCase());
  await fs.mkdir(folder,{recursive:true});
  const stem = path.basename(source,path.extname(source));
  const digest = createHash('sha256').update(output).digest('hex');
  // Publish a complete private sibling using a no-replace link. A second job
  // may race the first or produce a different map with the same readable stem.
  const temporary = path.join(folder,randomUUID()+'.part');
  try {
    await fs.writeFile(temporary,output,{flag:'wx'});
    for (const name of guardedMapNames(stem,request.maxLength,digest)) {
      const filename=name+'.pms';
      const target = path.join(folder,filename);
      try {
        await fs.link(temporary,target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code!=='EEXIST') throw e;
        if (!(await fs.readFile(target)).equals(output)) continue;
      }
      return {added:plan.polygons.length,filename,folder};
    }
    throw Error('Conflicting output map names.');
  } finally {
    await fs.rm(temporary,{force:true});
  }
}
