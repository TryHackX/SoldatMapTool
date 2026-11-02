export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PolyTypeMeta {
  id: number;
  key: string;
  namePl: string;
  nameEn: string;
  color: string; // Hex color for tactical physics overlay
  isBackground?: boolean;
  isSpecial: boolean;
}

export const POLY_TYPES: Record<number, PolyTypeMeta> = {
  0:  { id: 0,  key: 'NORMAL',                namePl: 'Normalny',                      nameEn: 'Normal',                color: '#94a3b8', isSpecial: false },
  1:  { id: 1,  key: 'ONLY_BULLETS',          namePl: 'Tylko pociski kolidują',        nameEn: 'Only Bullets Collide',  color: '#fbbf24', isSpecial: true },
  2:  { id: 2,  key: 'ONLY_PLAYER',           namePl: 'Tylko gracze kolidują',         nameEn: 'Only Players Collide',  color: '#38bdf8', isSpecial: true },
  3:  { id: 3,  key: 'DOESNT_COLLIDE',        namePl: 'Brak kolizji (Przenikalny)',    nameEn: "Doesn't Collide",       color: '#a855f7', isSpecial: true },
  4:  { id: 4,  key: 'ICE',                   namePl: 'Lód (Śliski)',                  nameEn: 'Ice',                   color: '#67e8f9', isSpecial: true },
  5:  { id: 5,  key: 'DEADLY',                namePl: 'Śmiertelny (Deadly)',           nameEn: 'Deadly',                color: '#ef4444', isSpecial: true },
  6:  { id: 6,  key: 'BLOODY_DEADLY',         namePl: 'Krwawa śmierć (Bloody Deadly)', nameEn: 'Bloody Deadly',         color: '#dc2626', isSpecial: true },
  7:  { id: 7,  key: 'HURTS',                 namePl: 'Raniący (Hurts)',               nameEn: 'Hurts',                 color: '#f97316', isSpecial: true },
  8:  { id: 8,  key: 'REGENERATES',           namePl: 'Leczący (Regenerates)',         nameEn: 'Regenerates',           color: '#22c55e', isSpecial: true },
  9:  { id: 9,  key: 'LAVA',                  namePl: 'Lawa (Podpala i zabija)',       nameEn: 'Lava',                  color: '#ff4500', isSpecial: true },
  10: { id: 10, key: 'ALPHA_BULLETS',         namePl: 'Pociski Alpha (Czerwoni)',      nameEn: 'Alpha Bullets',         color: '#fca5a5', isSpecial: true },
  11: { id: 11, key: 'ALPHA_PLAYER',          namePl: 'Gracze Alpha (Czerwoni)',       nameEn: 'Alpha Players',         color: '#f87171', isSpecial: true },
  12: { id: 12, key: 'BRAVO_BULLETS',         namePl: 'Pociski Bravo (Niebiescy)',     nameEn: 'Bravo Bullets',         color: '#93c5fd', isSpecial: true },
  13: { id: 13, key: 'BRAVO_PLAYER',          namePl: 'Gracze Bravo (Niebiescy)',      nameEn: 'Bravo Players',         color: '#60a5fa', isSpecial: true },
  14: { id: 14, key: 'CHARLIE_BULLETS',       namePl: 'Pociski Charlie (Żółci)',       nameEn: 'Charlie Bullets',       color: '#fde047', isSpecial: true },
  15: { id: 15, key: 'CHARLIE_PLAYER',        namePl: 'Gracze Charlie (Żółci)',        nameEn: 'Charlie Players',       color: '#eab308', isSpecial: true },
  16: { id: 16, key: 'DELTA_BULLETS',         namePl: 'Pociski Delta (Zieloni)',       nameEn: 'Delta Bullets',         color: '#86efac', isSpecial: true },
  17: { id: 17, key: 'DELTA_PLAYER',          namePl: 'Gracze Delta (Zieloni)',        nameEn: 'Delta Players',         color: '#4ade80', isSpecial: true },
  18: { id: 18, key: 'BOUNCY',                namePl: 'Odbijający (Bouncy)',           nameEn: 'Bouncy',                color: '#ec4899', isSpecial: true },
  19: { id: 19, key: 'EXPLOSIVE',             namePl: 'Wybuchowy (Explosive)',         nameEn: 'Explosive',             color: '#f59e0b', isSpecial: true },
  20: { id: 20, key: 'HURTS_FLAGGERS',        namePl: 'Rani niosącego flagę',          nameEn: 'Hurts Flaggers',        color: '#fb7185', isSpecial: true },
  21: { id: 21, key: 'FLAGGER_COLLIDES',      namePl: 'Koliduje tylko z flagą',        nameEn: 'Only Flagger Collides', color: '#e879f9', isSpecial: true },
  22: { id: 22, key: 'NON_FLAGGER_COLLIDES',  namePl: 'Koliduje bez flagi',            nameEn: 'Non-Flagger Collides',  color: '#c084fc', isSpecial: true },
  23: { id: 23, key: 'FLAG_COLLIDES',         namePl: 'Zatrzymuje upuszczoną flagę',   nameEn: 'Flag Object Collides',  color: '#f472b6', isSpecial: true },
  24: { id: 24, key: 'BACKGROUND',            namePl: 'Tło (Background)',              nameEn: 'Background',            color: '#64748b', isBackground: true, isSpecial: false },
  25: { id: 25, key: 'BACKGROUND_TRANSITION', namePl: 'Przejście tła (Bg Transition)', nameEn: 'Background Transition', color: '#475569', isBackground: true, isSpecial: false },
};

export type SpawnCategory = 'spawn' | 'flag' | 'bonus' | 'weapon';

export interface SpawnTypeMeta {
  team: number;
  category: SpawnCategory;
  namePl: string;
  shortLabel: string;
  color: string;
  assetHint?: string; // Soldat object texture filename
}

export const SPAWN_TYPES: Record<number, SpawnTypeMeta> = {
  0:  { team: 0,  category: 'spawn',  namePl: 'Spawn Ogólny (DM/PM/RM)', shortLabel: 'DM',   color: '#f8fafc' },
  1:  { team: 1,  category: 'spawn',  namePl: 'Spawn Alpha (Czerwoni)',  shortLabel: 'A',    color: '#ef4444' },
  2:  { team: 2,  category: 'spawn',  namePl: 'Spawn Bravo (Niebiescy)', shortLabel: 'B',    color: '#3b82f6' },
  3:  { team: 3,  category: 'spawn',  namePl: 'Spawn Charlie (Żółci)',   shortLabel: 'C',    color: '#eab308' },
  4:  { team: 4,  category: 'spawn',  namePl: 'Spawn Delta (Zieloni)',   shortLabel: 'D',    color: '#22c55e' },
  5:  { team: 5,  category: 'flag',   namePl: 'Flaga Alpha (Czerwona)',  shortLabel: 'FL-A', color: '#ef4444', assetHint: 'flag.bmp' },
  6:  { team: 6,  category: 'flag',   namePl: 'Flaga Bravo (Niebieska)', shortLabel: 'FL-B', color: '#3b82f6', assetHint: 'infflag.bmp' },
  7:  { team: 7,  category: 'bonus',  namePl: 'Granaty (Grenade Kit)',   shortLabel: 'GRN',  color: '#16a34a', assetHint: 'grenadekit.png' },
  8:  { team: 8,  category: 'bonus',  namePl: 'Apteczka (Medikit)',      shortLabel: 'MED',  color: '#f43f5e', assetHint: 'medikit.png' },
  9:  { team: 9,  category: 'bonus',  namePl: 'Cluster Grenades',        shortLabel: 'CLS',  color: '#eab308', assetHint: 'clusterkit.png' },
  10: { team: 10, category: 'bonus',  namePl: 'Kamizelka (Vest)',        shortLabel: 'VST',  color: '#38bdf8', assetHint: 'vestkit.png' },
  11: { team: 11, category: 'bonus',  namePl: 'Flame God (Miotacz)',     shortLabel: 'FLM',  color: '#f97316', assetHint: 'flamerkit.bmp' },
  12: { team: 12, category: 'bonus',  namePl: 'Berserker',               shortLabel: 'BER',  color: '#ef4444', assetHint: 'berserkerkit.bmp' },
  13: { team: 13, category: 'bonus',  namePl: 'Predator (Niewidzialność)', shortLabel: 'PRD', color: '#a855f7', assetHint: 'predatorkit.bmp' },
  14: { team: 14, category: 'flag',   namePl: 'Flaga Żółta (PM / HTF)',  shortLabel: 'FL-Y', color: '#facc15', assetHint: 'flag.bmp' },
  15: { team: 15, category: 'weapon', namePl: 'Łuk Rambo (Rambo Bow)',   shortLabel: 'BOW',  color: '#fbbf24', assetHint: 'bow.png' },
  16: { team: 16, category: 'weapon', namePl: 'Działko Stacjonarne (M2)', shortLabel: 'M2',  color: '#94a3b8', assetHint: 'm2-stat.png' },
};

export const WEATHER_NAMES: Record<number, string> = {
  0: 'Brak pogody',
  1: 'Deszcz (Rain)',
  2: 'Burza piaskowa (Sandstorm)',
  3: 'Śnieg (Snow)',
};

export const STEPS_NAMES: Record<number, string> = {
  0: 'Twarde podłoże (Metal/Kamień)',
  1: 'Miękkie podłoże (Ziemia/Trawa)',
  2: 'Brak dźwięku kroków',
};

export const SCENERY_LEVEL_NAMES: Record<number, string> = {
  0: 'Tył (Back — za graczem)',
  1: 'Środek (Middle — przed graczem, za poligonami)',
  2: 'Przód (Front — kryjówka na wierzchu)',
};

/**
 * Standing / moving Soldat player collision box (OpenSoldat Control.pas / PolyMap.pas):
 * probes extend 3.5 world units left and right of centre (7 units wide) and 14 units up from the feet.
 */
export const SOLDIER_COLLISION = {
  halfWidth: 3.5,
  width: 7,
  height: 14,
} as const;

export const WAYPOINT_ACTION_NAMES_EN: Record<number, string> = {
  0: 'None',
  1: 'Stop and camp',
  2: 'Wait 1 second',
  3: 'Wait 5 seconds',
  4: 'Wait 10 seconds',
  5: 'Wait 15 seconds',
  6: 'Wait 20 seconds',
};

