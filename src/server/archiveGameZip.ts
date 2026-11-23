import fs from 'node:fs/promises';
import path from 'node:path';
import {ZipArchive} from 'archiver';
import {pipeline} from 'node:stream/promises';
import type {Writable} from 'node:stream';
import {diskPathKey} from './diskPath';

/** The published game tree, without quarantined originals or analysis data. */
export async function writeArchiveGameZip(root:string,output:Writable) {
  const tree=await fs.realpath(root);
  const zip=new ZipArchive({zlib:{level:4},forceZip64:true});
  zip.on('warning',error=>zip.destroy(error));
  const written=pipeline(zip,output);
  // A cancelled download can close the socket while files are being enumerated.
  written.catch(()=>{});
  try {
    for (const folder of ['maps','scenery-gfx','textures','textures/edges','missing']) {
      const dir=path.join(tree,folder);
      let entries;
      try {
        if (diskPathKey(await fs.realpath(dir))!==diskPathKey(dir)) throw Error('Archive folder changed: '+folder);
        entries=await fs.readdir(dir,{withFileTypes:true});
      } catch (e) {
        if (folder!=='maps' && (e as NodeJS.ErrnoException).code==='ENOENT') continue;
        throw e;
      }
      for (const entry of entries) {
        if (zip.destroyed) throw Error('ZIP download interrupted');
        if (entry.isFile()) zip.file(path.join(dir,entry.name),{name:folder+'/'+entry.name});
      }
    }
    await Promise.all([zip.finalize(),written]);
  } catch(e) {
    zip.abort();
    zip.destroy();
    output.destroy();
    await written.catch(()=>{});
    throw e;
  }
}
