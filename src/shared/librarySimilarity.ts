/** Mark authored draft/version labels without matching ordinary names such as "Contest". */
export function isDraftName(name:string) {
  const stem=name.split(/[\\/]/).at(-1)!.replace(/\.(?:pms|png|bmp|jpg|jpeg|gif|tga)$/i,'');
  return /(?:^|[^a-z0-9])(?:wip|alpha|beta|draft|rough|prototyp(?:e)?|test|tmp|temp|backup|bak|robocz[ay]|szkic|wersja[_ -]?robocza)(?:[ _.-]?\d+)?(?:$|[^a-z0-9])/i.test(stem)
    || /(?:^|[ _.-])(?:rc|rev|v)\d+(?:[._-]\d+)*(?:$|[^a-z0-9])/i.test(stem);
}

export const similarityCriteria=['names','shape','sceneryNames','sceneryImages','texture','counts'] as const;
export type SimilarityCriterion=typeof similarityCriteria[number];
export type DraftFilter = 'all' | 'only' | 'exclude';
export function matchesDraftFilter(filter: DraftFilter, hasDraft: boolean) {
  if (filter === 'only') return hasDraft;
  if (filter === 'exclude') return !hasDraft;
  return true;
}
export interface LibraryPair {
  kind?: 'scenery';
  leftId:string; rightId:string; leftName:string; rightName:string; leftCrc:number; rightCrc:number;
  leftHasThumbnail:boolean; rightHasThumbnail:boolean; score:number; reasons:SimilarityCriterion[];
  sceneries:{left:string;right:string}[];
}
