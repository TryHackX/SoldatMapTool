import { AssetBindings, type CatalogFile, type ImageInfo } from './archiveBindings';

interface DocumentedArtwork {
  requested: string;
  replacement: string;
  kind: 'texture' | 'scenery';
  sha256: string;
  edgeSha256?: string;
  note: string;
  noteSha256: string;
  release: string;
}

// An inventory of individually checked releases. A checksum applies to just one
// version of the PMS. Text found inside an archive is never executed as a rule.
const documented = new Map<string, DocumentedArtwork>([
  ['a944a0bf09369ed91dde1c2aa4eb5d3fbdc80847156695ebf2327d8e91734eeb', {
    kind: 'texture',
    requested: 'lagrange2.bmp',
    replacement: 'sunnypath.bmp',
    sha256: '830c440c99d135aa68cd9222b353fd328a954b6f75d03bebfaf7e416dcfc167c',
    note: 'forums.soldat.pl dm htf.zip!/forums.soldat.pl dm htf/SunnyPath/Info.txt',
    noteSha256: 'a4112bea2faeff8b2d016fd8d07e12da2573d6b181bac23253f5da676875f1b9',
    release: 'https://tms.jrgp.org/2010/?download=303',
  }],
]);

export function findDocumentedArtwork(map: CatalogFile, kind: 'texture' | 'scenery', name: string,
    bindings: AssetBindings, images: ReadonlyMap<string, ImageInfo | null>) {
  const correction = documented.get(map.sha256);
  if (map.kind !== 'map' || !correction || correction.kind !== kind || correction.requested !== name) return;
  const original = bindings.resolve(kind,name,map.scope,true,true);
  if (!('error' in original) || original.error !== 'missing') return;

  const hit = bindings.resolve(kind,correction.replacement,map.scope,true,true);
  if (!('file' in hit)) return;
  const file = hit.file;
  if (file.kind !== kind || file.scope !== map.scope || file.sha256 !== correction.sha256 || !images.get(file.sha256)) return;

  // Keep a separately documented edge with its texture. A package that changes or
  // adds an edge has different artwork and needs its own supporting evidence.
  let edge: CatalogFile | undefined;
  if (kind === 'texture') {
    const bound = bindings.resolve('edge',correction.replacement,map.scope,true,true);
    if ('file' in bound) {
      edge = bound.file;
      if (edge.scope !== map.scope || edge.sha256 !== correction.edgeSha256 || !images.get(edge.sha256)) return;
    } else if (bound.error !== 'missing' || correction.edgeSha256) return;
  }
  const evidence = kind + '/' + name + ' · documented replacement ' + file.path +
    ' (SHA-256 ' + file.sha256 + ') for original PMS ' + map.sha256 +
    ' · archive note ' + correction.note + ' (SHA-256 ' + correction.noteSha256 + ')' +
    ' · publisher package ' + correction.release;
  return {file,edge,evidence};
}
