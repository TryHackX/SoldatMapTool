export function guardedMapNames(baseName:string, limit:number, digest:string) {
  const stem=baseName.toLowerCase().replace(/[^a-z0-9_-]/g,'_');
  const short=(stem.slice(0,limit-11)||'map')+'_'+digest.slice(0,8)+'_g';
  return [...new Set([stem.length+2<=limit ? stem+'_g' : short,short])];
}
