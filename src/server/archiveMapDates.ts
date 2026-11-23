import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {withZipMembers} from './archiveZipReader';
import {scanArchiveInputs} from './archiveInputs';
import type {ArchiveCleanMap} from './archiveCleaner';
import {PortableNames} from './archiveBindings';
import {csvCell} from './archiveReview';

export async function writeMapVersions(file:string,maps:readonly ArchiveCleanMap[]) {
    const groups=new Map<string,ArchiveCleanMap[]>();
    for (const row of maps) {
        if (!row.output || !row.outputSha256) continue;
        const key=new PortableNames().allocate(path.posix.basename(row.source),'.pms',row.outputSha256,28);
        const entries=groups.get(key)??[];entries.push(row);groups.set(key,entries);
    }
    const lines=[['Nazwa mapy','Plik w paczce','Preferowana wersja','Data pliku (UTC)','Źródło','SHA-256 mapy w paczce'].map(csvCell).join(';')];
    for (const key of [...groups.keys()].sort()) {
        const rows=groups.get(key)!;
        if (new Set(rows.map(r=>r.outputSha256)).size<2) continue;
        rows.sort(compareMapEditions);
        const preferred=rows[0].outputSha256;
        for(const r of rows) {
            lines.push([key,r.output,r.outputSha256===preferred?'tak':'',r.sourceMtimeMs?new Date(r.sourceMtimeMs).toISOString():'',r.source,r.outputSha256].map(csvCell).join(';'));
        }
    }
    await fs.writeFile(file,'\uFEFF'+lines.join('\r\n')+'\r\n',{flag:'wx'});
}

export function compareMapEditions(a:ArchiveCleanMap,b:ArchiveCleanMap) {
    const priority=(source:string)=>source.startsWith('@installed/')?2:/\brscs\b/i.test(source)?1:0;
    return Math.trunc(b.sourceMtimeMs??0)-Math.trunc(a.sourceMtimeMs??0) || priority(b.source)-priority(a.source) ||
        (a.source<b.source?-1:a.source>b.source?1:0);
}

// A materialised SMA entry has no original timestamp. Look inside its release
// and bind the date to the exact PMS bytes before using it to choose a version.
export async function recoverIndexedMapDates(root:string,maps:ArchiveCleanMap[],signal?:AbortSignal) {
    const groups=new Map<string,ArchiveCleanMap[]>();
    for (const row of maps) {
        if (row.sourceMtimeMs || !row.outputSha256) continue;
        const outer=row.source.split('!/',1)[0];
        if (!/\.(?:zip|rar|7z(?:\.001)?)$/i.test(outer) || path.basename(outer)!==outer || /[\\/:]/.test(outer)) continue;
        const list=groups.get(outer)??[];
        list.push(row);groups.set(outer,list);
    }
    async function readDates(input:string|Buffer,prefix:string,rows:ArchiveCleanMap[],depth:number) {
        const targets=new Map<string,ArchiveCleanMap[]>();
        for (const row of rows) {
            const remaining=row.source.slice(prefix.length+2);
            // Folder names can end in "!". Only actual container members can be opened.
            const paths=[remaining,...Array.from(remaining.matchAll(/\.zip!\//gi),m=>remaining.slice(0,m.index+4))];
            for (const next of paths) {
                const members=targets.get(next)??[];members.push(row);targets.set(next,members);
            }
        }
        await withZipMembers(input,async members=>{
            for(const member of members) {
                signal?.throwIfAborted();
                const name=member.name.replaceAll('\\','/').replace(/^(?:\.\/)+/,'');
                const matches=targets.get(name);
                if (!matches || member.directory || member.problem || member.size>128*1024**2) continue;
                const label=prefix+'!/'+name;
                try {
                    if (/\.zip$/i.test(name) && depth<5) await readDates(await member.read(),label,matches,depth+1);
                    else if (member.size<=32*1024**2 && member.mtimeMs>Date.UTC(1980,0,1) && member.mtimeMs<=Date.now()+86400000) {
                        const exact=matches.filter(row=>row.source===label && row.sourceSize===member.size);
                        if (!exact.length) continue;
                        const hash=createHash('sha256').update(await member.read()).digest('hex');
                        for(const row of exact) if(row.sha256===hash) row.sourceMtimeMs=member.mtimeMs;
                    }
                } catch { signal?.throwIfAborted(); } // Filename priority is the fallback when a date is unavailable.
            }
        });
    }
    for (const [outer,rows] of groups) {
        signal?.throwIfAborted();
        const file=path.join(root,outer);
        try {
            if (!(await fs.lstat(file)).isFile()) continue;
            if (/\.zip$/i.test(outer)) { await readDates(file,outer,rows,1); continue; }
            const byPath=new Map(rows.map(row=>[row.source,row]));
            // Commit only after the complete native stream has passed its integrity checks.
            const verified=new Map<ArchiveCleanMap,number>();
            await scanArchiveInputs(file,{signal,indexedMapPaths:new Set(byPath.keys()),onEntry:async entry=>{
                const row=byPath.get(entry.path);
                if (!row || entry.kind!=='map' || entry.size!==row.sourceSize || !Number.isFinite(entry.mtimeMs) ||
                    entry.mtimeMs<=Date.UTC(1980,0,1) || entry.mtimeMs>Date.now()+86400000) return;
                if (createHash('sha256').update(await entry.read()).digest('hex')===row.sha256)
                    verified.set(row,entry.mtimeMs);
            },onIssue:issue=>{if (issue.path===outer) throw Error(issue.reason);}});
            for(const [row,stamp] of verified) row.sourceMtimeMs=stamp;
        } catch { signal?.throwIfAborted(); }
    }
}
