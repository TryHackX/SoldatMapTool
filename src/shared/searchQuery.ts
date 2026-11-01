/**
 * Search syntax of the map browser, shared by the server (filtering) and the client (filter chips, help).
 *
 *   ctf_cs office          plain words: every word must appear in name / title / texture / scenery names
 *   props>300 polys<=1000  numeric comparisons (> >= < <= =, "props:300" means "= 300")
 *   tex:ananas scen:tree   text fields (substring, case-insensitive), "title:\"cs office\"" for spaces
 *   prefix:ctf_cs_         name starts with
 *   is:fav is:broken       flags (fav, vanilla, custom, broken, dup, incompatible, case)
 *   tag:turniej            user tags
 *   pogoda:snieg           weather (none / rain / sand / snow)
 *   -word, -tex:x, -is:dup negation
 *
 * Unknown keys and invalid values are kept as plain words, so nothing silently filters everything out.
 */

export type SearchNumericField =
  | 'props'
  | 'polys'
  | 'colliders'
  | 'spawns'
  | 'waypoints'
  | 'width'
  | 'height'
  | 'sizeKb'
  | 'missing'
  | 'medikits'
  | 'grenades'
  | 'jet';

export type SearchTextField = 'name' | 'title' | 'tex' | 'scenery' | 'prefix' | 'mode' | 'source' | 'crc' | 'tag';

export type SearchFlag = 'fav' | 'vanilla' | 'custom' | 'broken' | 'dup' | 'incompatible' | 'case';

export type SearchCompareOp = '>' | '>=' | '<' | '<=' | '=';

export type SearchTerm =
  | { kind: 'text'; value: string; negate: boolean }
  | { kind: 'field'; field: SearchTextField; value: string; negate: boolean }
  | { kind: 'num'; field: SearchNumericField; op: SearchCompareOp; value: number; negate: boolean }
  | { kind: 'flag'; flag: SearchFlag; negate: boolean }
  | { kind: 'weather'; value: number; negate: boolean };

export interface ParsedSearchQuery {
  terms: SearchTerm[];
  /** True when at least one term is more than a plain word (used for filter chips in the UI) */
  structured: boolean;
}

const NUMERIC_KEYS: Record<string, SearchNumericField> = {
  props: 'props',
  prop: 'props',
  scen: 'props',
  scenerie: 'props',
  polys: 'polys',
  poly: 'polys',
  poligony: 'polys',
  colliders: 'colliders',
  col: 'colliders',
  colidery: 'colliders',
  spawns: 'spawns',
  spawn: 'spawns',
  spawny: 'spawns',
  waypoints: 'waypoints',
  wp: 'waypoints',
  boty: 'waypoints',
  bots: 'waypoints',
  width: 'width',
  w: 'width',
  szer: 'width',
  szerokosc: 'width',
  szerokość: 'width',
  height: 'height',
  h: 'height',
  wys: 'height',
  wysokosc: 'height',
  wysokość: 'height',
  size: 'sizeKb',
  kb: 'sizeKb',
  rozmiar: 'sizeKb',
  missing: 'missing',
  braki: 'missing',
  medikits: 'medikits',
  apteczki: 'medikits',
  grenades: 'grenades',
  granaty: 'grenades',
  jet: 'jet',
};

const TEXT_KEYS: Record<string, SearchTextField> = {
  name: 'name',
  nazwa: 'name',
  title: 'title',
  tytul: 'title',
  tytuł: 'title',
  author: 'title',
  autor: 'title',
  tex: 'tex',
  texture: 'tex',
  tekstura: 'tex',
  scen: 'scenery',
  sc: 'scenery',
  scenery: 'scenery',
  sceneria: 'scenery',
  prefix: 'prefix',
  prefiks: 'prefix',
  mode: 'mode',
  tryb: 'mode',
  src: 'source',
  source: 'source',
  zrodlo: 'source',
  źródło: 'source',
  crc: 'crc',
  tag: 'tag',
  tagi: 'tag',
};

const FLAG_KEYS = new Set(['is', 'jest']);
const WEATHER_KEYS = new Set(['weather', 'pogoda']);

const FLAG_VALUES: Record<string, SearchFlag> = {
  fav: 'fav',
  favorite: 'fav',
  ulubione: 'fav',
  ulubiona: 'fav',
  vanilla: 'vanilla',
  oryginalne: 'vanilla',
  domyslne: 'vanilla',
  domyślne: 'vanilla',
  custom: 'custom',
  wlasne: 'custom',
  własne: 'custom',
  broken: 'broken',
  braki: 'broken',
  missing: 'broken',
  dup: 'dup',
  duplikat: 'dup',
  duplikaty: 'dup',
  incompatible: 'incompatible',
  bad: 'incompatible',
  limity: 'incompatible',
  niekompatybilne: 'incompatible',
  case: 'case',
};

const WEATHER_VALUES: Record<string, number> = {
  none: 0,
  brak: 0,
  '0': 0,
  rain: 1,
  deszcz: 1,
  '1': 1,
  sand: 2,
  piasek: 2,
  burza: 2,
  '2': 2,
  snow: 3,
  snieg: 3,
  śnieg: 3,
  '3': 3,
};

const TOKEN_RE = /^(-?)([a-ząćęłńóśźż]+)(>=|<=|:|>|<|=)(.*)$/;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (!inQuotes && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function unquote(value: string): string {
  return value.replace(/"/g, '').trim();
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const terms: SearchTerm[] = [];
  for (const raw of tokenize((input || '').trim())) {
    const term = parseToken(raw);
    if (term) terms.push(term);
  }
  return { terms, structured: terms.some((t) => t.kind !== 'text') };
}

function plainText(raw: string): SearchTerm | null {
  const negate = raw.length > 1 && raw.startsWith('-');
  const value = unquote(negate ? raw.slice(1) : raw).toLowerCase();
  return value ? { kind: 'text', value, negate } : null;
}

function parseToken(raw: string): SearchTerm | null {
  const m = TOKEN_RE.exec(raw.toLowerCase());
  if (!m) return plainText(raw);
  const negate = m[1] === '-';
  const key = m[2];
  const op = m[3];
  const value = unquote(m[4]).toLowerCase();
  if (!value) return plainText(raw);

  if (op === ':') {
    if (FLAG_KEYS.has(key)) {
      const flag = FLAG_VALUES[value];
      return flag ? { kind: 'flag', flag, negate } : plainText(raw);
    }
    if (WEATHER_KEYS.has(key)) {
      const w = WEATHER_VALUES[value];
      return w !== undefined ? { kind: 'weather', value: w, negate } : plainText(raw);
    }
    // "props:300" = "props=300" (also for "scen", which is a scenery name only when the value is not a number)
    const numField = NUMERIC_KEYS[key];
    if (numField && /^\d+(\.\d+)?$/.test(value)) {
      return { kind: 'num', field: numField, op: '=', value: Number(value), negate };
    }
    const textField = TEXT_KEYS[key];
    if (textField) return { kind: 'field', field: textField, value, negate };
    return plainText(raw);
  }

  const numField = NUMERIC_KEYS[key];
  if (!numField || !/^\d+(\.\d+)?$/.test(value)) return plainText(raw);
  return { kind: 'num', field: numField, op: op as SearchCompareOp, value: Number(value), negate };
}

export function compareNumber(actual: number, op: SearchCompareOp, expected: number): boolean {
  switch (op) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    default:
      return actual === expected;
  }
}

// English chip labels; the UI passes its translator to describeSearchTerm()
const NUMERIC_LABELS: Record<SearchNumericField, string> = {
  props: 'sceneries',
  polys: 'polygons',
  colliders: 'colliders',
  spawns: 'spawns',
  waypoints: 'waypoints',
  width: 'width',
  height: 'height',
  sizeKb: 'size KB',
  missing: 'missing files',
  medikits: 'medikits',
  grenades: 'grenades',
  jet: 'jet',
};

const TEXT_LABELS: Record<SearchTextField, string> = {
  name: 'name',
  title: 'title',
  tex: 'texture',
  scenery: 'scenery',
  prefix: 'prefix',
  mode: 'mode',
  source: 'source',
  crc: 'CRC',
  tag: 'tag',
};

const FLAG_LABELS: Record<SearchFlag, string> = {
  fav: 'favorites',
  vanilla: 'default',
  custom: 'custom',
  broken: 'with missing files',
  dup: 'duplicates',
  incompatible: "won't load",
  case: 'letter case',
};

const WEATHER_LABELS = ['no weather', 'rain', 'sandstorm', 'snow'];

/** Short label of a parsed term, for the filter chips under the search box; `tr` translates the English words */
export function describeSearchTerm(term: SearchTerm, tr: (en: string) => string = (en) => en): string {
  const not = term.negate ? `${tr('not')} ` : '';
  switch (term.kind) {
    case 'text':
      return `${not}“${term.value}”`;
    case 'field':
      return term.field === 'prefix'
        ? `${not}${tr(TEXT_LABELS.prefix)}: ${term.value}…`
        : `${tr(TEXT_LABELS[term.field])}: ${not}${term.value}`;
    case 'num':
      return `${not}${tr(NUMERIC_LABELS[term.field])} ${term.op} ${term.value}`;
    case 'flag':
      return `${not}${tr(FLAG_LABELS[term.flag])}`;
    case 'weather':
      return `${not}${WEATHER_LABELS[term.value] !== undefined ? tr(WEATHER_LABELS[term.value]) : `${tr('weather')} ${term.value}`}`;
  }
}
