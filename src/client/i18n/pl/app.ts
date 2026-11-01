import type { PlDictionary } from './types';

// App shell (header, banners, panels), main.tsx and the Settings window
export const APP_PL: PlDictionary = {
  // App.tsx
  '{name} (original)': '{name} (oryginał)',
  map: 'mapa',
  'map|maps': ['mapa', 'mapy', 'map'],
  'Open the Soldat folder in the file manager': 'Otwórz folder Soldata w menedżerze plików',
  'Hide the categories and prefixes panel': 'Ukryj panel kategorii i prefixów',
  'Show the categories and prefixes panel': 'Pokaż panel kategorii i prefixów',
  'Toggle the categories panel': 'Przełącz panel kategorii',
  'Hide the map details panel': 'Ukryj panel szczegółów mapy',
  'Show the map details panel': 'Pokaż panel szczegółów mapy',
  'Toggle the details panel': 'Przełącz panel szczegółów',
  'Soldat Map Workshop: automatic scenery repair after the move to 1.7.1 (_f.pms) and Optimize Sceneries layer merging (_o.pms)':
    'Warsztat Map Soldat: automatyczna naprawa scenerii po przejściu na 1.7.1 (_f.pms) oraz łączenie warstw Optimize Sceneries (_o.pms)',
  'Workshop _f / _o': 'Warsztat _f / _o',
  'Manage custom prefixes, clan categories and RSCS / Trenchwars rules':
    'Zarządzaj własnymi prefixami, kategoriami klanowymi oraz regułami RSCS / Trenchwars',
  'Custom Prefixes': 'Własne Prefixy',
  'Clean-up: duplicate maps (identical CRC32), unused scenery files and letter case in file names (Linux)':
    'Porządki: duplikaty map (identyczne CRC32), nieużywane pliki scenerii i wielkość liter w nazwach plików (Linux)',
  'Clean-up': 'Porządki',
  'Refresh the index of maps and files on disk (SQLite WAL)': 'Odśwież indeks map i plików na dysku (SQLite WAL)',
  Refresh: 'Odśwież',
  'Settings: language, Soldat game folder and extra map sources': 'Ustawienia: język, folder gry Soldat i dodatkowe źródła map',
  Settings: 'Ustawienia',
  'Map pack builder': 'Kreator paczek map',
  'Map Pack Builder': 'Kreator Paczek Map',
  'Indexing the map collection ({phase}):': 'Indeksowanie kolekcji map ({phase}):',
  'finding files': 'wyszukiwanie plików',
  indexing: 'indeksowanie',
  finishing: 'kończenie',
  idle: 'bezczynny',
  '{n} maps/s': '{n} map/s',
  'Cannot reach the indexing server: {error}': 'Błąd połączenia z serwerem indeksującym: {error}',
  'The Soldat game folder {path} does not exist or has no {maps} folder — textures, sceneries and maps will not be visible.':
    'Folder gry Soldat {path} nie istnieje lub nie zawiera katalogu {maps} — tekstury, scenerie i mapy nie będą widoczne.',
  'Set the Soldat folder': 'Ustaw folder Soldata',
  'WebGL2 map view rendering error': 'Błąd renderowania widoku mapy WebGL2',
  'preview of changes': 'podgląd zmian',
  'Could not load the application window (e.g. after an update) — refresh the page':
    'Nie udało się wczytać okna aplikacji (np. po aktualizacji) — odśwież stronę',
  'from the pack selection': 'z koszyka paczki',
  'from the current filter': 'z aktualnego filtra',

  // main.tsx
  'Soldat Map Studio ran into an error': 'Wystąpił błąd aplikacji Soldat Map Studio',

  // SettingsModal.tsx
  'Settings — language, Soldat folders and map sources': 'Ustawienia — język, katalogi Soldat i źródła map',
  'Close settings': 'Zamknij ustawienia',
  'Changing the language reloads the app.': 'Zmiana języka przeładowuje aplikację.',
  'Archive #{n}': 'Archiwum #{n}',
  'Main Soldat / OpenSoldat installation folder': 'Główny folder instalacji Soldat / OpenSoldat',
  'This folder provides the maps ({maps}, {downloads}), textures ({textures}, {edges}), sceneries ({scenery}) and the list of default game files ({readonly}).':
    'Z tego katalogu pobierane są mapy ({maps}, {downloads}), tekstury ({textures}, {edges}), scenerie ({scenery}) oraz baza plików domyślnych ({readonly}).',
  'Choose the main Soldat game folder': 'Wybierz główny katalog gry Soldat',
  'Browse...': 'Przeglądaj...',
  'Extra map archives and collections (.pms)': 'Dodatkowe archiwa i kolekcje map (.pms)',
  'You can attach huge collections (e.g. 50,000+ maps from servers, Gather or old backups). If {textures} and {scenery} folders sit next to the {maps} folder, they are detected automatically!':
    'Możesz podpiąć wielkie kolekcje (np. 50 000+ map z serwerów, Gathera lub starych kopii). Jeśli obok folderu {maps} znajdują się sąsiednie katalogi {textures} i {scenery}, zostaną wykryte automatycznie!',
  'Path to a folder with .pms files...': 'Ścieżka do folderu z plikami .pms...',
  'Label (optional)': 'Etykieta (opcj.)',
  'Scan subfolders recursively': 'Skanuj podfoldery rekurencyjnie',
  'Choose an extra folder with .pms maps': 'Wybierz dodatkowy folder z mapami .pms',
  'Pick from disk...': 'Wybierz z dysku...',
  'Add folder': 'Dodaj folder',
  Recursive: 'Rekurencyjnie',
  'Remove the folder from the sources': 'Usuń folder ze źródeł',
  'The SQLite WAL index remembers map headers — later starts take a fraction of a second.':
    'Indeks SQLite WAL zapamiętuje nagłówki map — kolejne uruchomienia trwają ułamek sekundy.',
  Cancel: 'Anuluj',
  'Scanning...': 'Skanowanie...',
  'Save and Scan Maps': 'Zapisz i Skanuj Mapy',
};
