export interface MissingArtwork {
  category: 'scenery' | 'texture' | 'edge';
  original: string;
  expected: string;
  reason: string;
}

export function missingArtworkText(items: readonly MissingArtwork[]): string {
  const line = (value: string) => value.replace(/[\r\n\t\x00-\x1f]/g,' ');
  const sections = [['Scenery','scenery'],['Textures','texture'],['Edges','edge']] as const;
  const legend=items.some(item=>item.original!==item.expected)
    ? 'Original name -> name to save the found file under.\r\n\r\n' : '';
  return legend+sections.map(([title,category])=>{
    const entries = items.filter(item=>item.category===category).map(item=>{
      const rename=item.expected!==item.original?' -> '+line(item.expected):'';
      return line(item.original)+rename+(item.reason==='missing'?'':' ['+line(item.reason)+']');
    });
    return title+':\r\n'+[...new Set(entries)].sort().join('\r\n');
  }).join('\r\n\r\n')+'\r\n';
}

/** Keep original authored names when repacking a previously cleaned map. */
export function readMissingArtworkText(text:string):MissingArtwork[] {
  const items:MissingArtwork[]=[];
  let category:MissingArtwork['category']|undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line==='Scenery:') category='scenery';
    else if (line==='Textures:') category='texture';
    else if (line==='Edges:') category='edge';
    else if (category && line) {
      const note=/ \[([^\]]+)\]$/.exec(line);
      const label=note?line.slice(0,note.index):line;
      const arrow=label.lastIndexOf(' -> ');
      items.push({category,original:arrow<0?label:label.slice(0,arrow),expected:arrow<0?label:label.slice(arrow+4),reason:note?.[1]??'missing'});
    }
  }
  return items;
}
