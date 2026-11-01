import type { PlDictionary } from './types';

// Texts made outside the UI in English (shared parser, classifier, search chips, scan-time warnings)
export const SHARED_PL: PlDictionary = {
  // Built-in mode categories (src/shared/prefixUtils.ts) — names that are the same in both languages need no entry
  'Longshot / Sniper': 'Longshot / Snajperskie',
  'Weapon Arenas (Knife / M79 / Saw)': 'Areny Broni (Knife / M79 / Saw)',
  'Dodgeball / Sports / Fun': 'Dodgeball / Sportowe / Fun',
  'Realistic / Tactical': 'Realistic / Taktyczne',
  'Other / Custom Prefixes': 'Inne / Niestandardowe Prefixy',
  'Other / Custom': 'Inne / Niestandardowe',
  'Custom Category': 'Własna Kategoria',
  'No prefix (DM)': 'Bez prefixu (DM)',
  'DM / Classic': 'DM / Klasyczne',
  'Weapon Arenas': 'Areny Broni',
  Other: 'Inne',
  'Classic and league Capture the Flag maps': 'Klasyczne oraz ligowe mapy Capture the Flag',
  'Trench and tactical Trenchwars and Total Trenchwars maps': 'Mapy okopowe i taktyczne Trenchwars oraz Total Trenchwars',
  'Climbing, obstacle and race maps, Hardcore Climb and Bunnyhop':
    'Mapy wspinaczkowe, przeszkodowe, wyścigowe, Hardcore Climb i Bunnyhop',
  'Base attack and defence (Red vs Blue)': 'Obrona i atak bazy (Czerwoni vs Niebiescy)',
  'Hold the yellow flag for time': 'Utrzymanie żółtej flagi na czas',
  'Deathmatch (including maps without a prefix), Teammatch, Pointmatch, Rambomatch':
    'Deathmatch (w tym mapy bez prefixu), Teammatch, Pointmatch, Rambomatch',
  'Long-range sniper maps (Barrett / Ruger)': 'Mapy snajperskie dalekiego zasięgu (Barrett / Ruger)',
  'Hide & Seek, Zombie Mod / ZRPG, Hexer, Survival and Co-op': 'Hide & Seek, Zombie Mod / ZRPG, Hexer, Survival i Co-op',
  'Arenas for a single weapon (Knife, M79 nade jump, Chainsaw, LAW, Bow)':
    'Areny dedykowane pojedynczym broniom (Nóż, M79 Nadejump, Piła, LAW, Łuk)',
  'Dodgeball, Football, Volleyball, Pong, mazes and fun maps':
    'Dodgeball, Football, Volleyball, Pong, Labirynty i mapy rozrywkowe',
  'Maps for realistic, war and tactical modes': 'Mapy pod tryb realistyczny, wojenny i taktyczny',
  'Other author, clan and custom prefixes': 'Pozostałe prefixy autorskie, klanowe i niestandardowe',

  // Engine limit labels (checkSoldatMapLimits)
  Polygons: 'Poligony',
  'Sector grid': 'Siatka sektorów',
  'Sceneries (props)': 'Scenerie (propy)',
  'Scenery entries': 'Wpisy scenerii',
  Colliders: 'Collidery',
  'Spawn points': 'Spawny',

  // Warnings saved during a scan (parser and scanner)
  'Missing section: colliders (the file ends early)': 'Brak sekcji: collidery (plik kończy się wcześniej)',
  'Missing section: spawn points (the file ends early)': 'Brak sekcji: spawny (plik kończy się wcześniej)',
  'Missing section: bot waypoints (the file ends early)': 'Brak sekcji: waypointy botów (plik kończy się wcześniej)',
  'Damaged section: colliders (record count {n})': 'Uszkodzona sekcja: collidery (liczba rekordów {n})',
  'Damaged section: spawn points (record count {n})': 'Uszkodzona sekcja: spawny (liczba rekordów {n})',
  'Damaged section: bot waypoints (record count {n})': 'Uszkodzona sekcja: waypointy botów (liczba rekordów {n})',
  'Cannot read the PMS file: {message}': 'Nie można odczytać pliku PMS: {message}',

  // Map sources (labels saved in config.json in English show translated)
  'Soldat (main)': 'Soldat (Główny)',
  'Map pack: {name}': 'Paczka: {name}',

  // Search filter chips (describeSearchTerm)
  not: 'nie',
  sceneries: 'scenerie',
  polygons: 'poligony',
  colliders: 'collidery',
  spawns: 'spawny',
  waypoints: 'waypointy',
  width: 'szerokość',
  height: 'wysokość',
  'size KB': 'rozmiar KB',
  'missing files': 'brakujące pliki',
  medikits: 'apteczki',
  grenades: 'granaty',
  name: 'nazwa',
  title: 'tytuł',
  texture: 'tekstura',
  scenery: 'sceneria',
  mode: 'tryb',
  source: 'źródło',
  favorites: 'ulubione',
  default: 'oryginalne',
  custom: 'własne',
  'with missing files': 'z brakami',
  duplicates: 'duplikaty',
  "won't load": 'nie wczytają się',
  'letter case': 'wielkość liter',
  'no weather': 'brak pogody',
  rain: 'deszcz',
  sandstorm: 'burza piaskowa',
  snow: 'śnieg',
  weather: 'pogoda',
};
