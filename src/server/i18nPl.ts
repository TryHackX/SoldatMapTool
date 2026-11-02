/**
 * Polish server messages: key = the exact English text passed to t(), value = Polish text with the same
 * `{placeholders}`. Entries for tp(n, one, other) use the key "one|other" and the forms [1, 2–4, 5+].
 */
export const SERVER_PL: Record<string, string | readonly [string, string, string]> = {
  // Shared plural forms
  '{n} file|{n} files': ['{n} plik', '{n} pliki', '{n} plików'],

  // index.ts — API errors and defaults
  'Access is only allowed from this computer (127.0.0.1 / localhost).':
    'Dostęp tylko z tego komputera (127.0.0.1 / localhost).',
  'A request from a foreign site was blocked.': 'Żądanie z obcej strony zostało zablokowane.',
  'Enter the path to the Soldat game folder.': 'Podaj ścieżkę do folderu gry Soldat.',
  'Folder does not exist: {path}': 'Folder nie istnieje: {path}',
  'Map not found: {id}': 'Nie znaleziono mapy: {id}',
  'No files selected.': 'Nie wybrano żadnych plików.',
  'The specified archive file was not found.': 'Nie znaleziono wskazanego pliku archiwum.',
  'The archive has {count} entries (limit {limit}).': 'Archiwum ma {count} wpisów (limit {limit}).',
  'The archive to extract was not found.': 'Nie znaleziono archiwum do wypakowania.',
  'Map pack: {name}': 'Paczka: {name}',
  'Only .png, .jpg and .webp files are allowed.': 'Dozwolone są tylko pliki .png, .jpg i .webp.',
  'Empty image file.': 'Pusty plik obrazu.',
  'This file type cannot be downloaded.': 'Ten typ pliku nie może być pobrany.',
  'File does not exist.': 'Plik nie istnieje.',
  'Same output name as {owner} — skipped': 'Ta sama nazwa wynikowa co {owner} — pominięto',
  'Invalid tile metadata.': 'Nieprawidłowe metadane kafelka.',
  'Path does not exist.': 'Ścieżka nie istnieje.',
  'Select a folder': 'Wybierz folder',
  'Map archives (*.zip;*.smap)|*.zip;*.smap|All files (*.*)|*.*':
    'Archiwa Map (*.zip;*.smap)|*.zip;*.smap|Wszystkie pliki (*.*)|*.*',
  'Unknown API endpoint.': 'Nieznany endpoint API.',

  // libraryTools.ts — Clean-up (duplicates, unused sceneries, letter case)
  'Another clean-up operation is running — wait until it finishes.':
    'Trwa inna operacja porządkowania — poczekaj, aż się skończy.',
  'Map {id} has no duplicates — it cannot be moved with this tool.':
    'Mapa {id} nie ma duplikatów — nie można jej przenieść tym narzędziem.',
  'Group {name} would lose its last copy — keep at least one file.':
    'Grupa {name} straciłaby ostatnią kopię — zostaw przynajmniej jeden plik.',
  'File {path} no longer exists — refresh the list.': 'Plik {path} już nie istnieje — odśwież listę.',
  'File {path} has changed since the last scan — refresh the list.':
    'Plik {path} zmienił się od ostatniego skanu — odśwież listę.',
  '{name} no longer has an identical copy that stays — nothing was moved. Refresh the list.':
    'Dla {name} nie ma już identycznej kopii, która zostaje — nic nie przeniesiono. Odśwież listę.',
  'Cannot read the folder {folder}.': 'Nie można odczytać folderu {folder}.',
  'the file is now used by a map or no longer exists': 'plik jest teraz używany przez mapę albo już go nie ma',
  'the name already matches the maps or the file is missing': 'nazwa jest już zgodna z mapami albo pliku nie ma',
  'maps spell this name in several ways': 'mapy zapisują tę nazwę na kilka sposobów',
  'the file is outside the game folder': 'plik jest poza folderem gry',
  'a file with this name already exists in the folder': 'w folderze jest już plik o tej nazwie',
  'the copy has a different size than the original': 'kopia ma inny rozmiar niż oryginał',
  // Restore list (file name and header lines)
  'RESTORE.txt': 'PRZYWRACANIE.txt',
  'Names changed by Soldat Map Studio (letter case only, content unchanged).':
    'Nazwy zmienione przez Soldat Map Studio (tylko wielkość liter, zawartość bez zmian).',
  'To undo, rename the file back to its previous name.': 'Aby cofnąć, zmień nazwę pliku z powrotem na poprzednią.',
  'previous_path<TAB>new_path': 'poprzednia_sciezka<TAB>nowa_sciezka',
  'Files moved by Soldat Map Studio. To restore a file, copy it back to its original path.':
    'Pliki przeniesione przez Soldat Map Studio. Aby przywrócić plik, skopiuj go z powrotem pod pierwotną ścieżkę.',
  'original_path<TAB>copy': 'pierwotna_sciezka<TAB>kopia',

  // packBuilder.ts — map pack warnings and results
  '{file}: packed {packed}, skipped {skipped} ({map})': '{file}: spakowano {packed}, pominięto {skipped} ({map})',
  'No maps selected for packing.': 'Nie wybrano żadnych map do spakowania.',
  by_mode: 'wg_trybu',
  by_prefix: 'wg_prefixu',
  '{name} ({n} .zip pack)|{name} ({n} .zip packs)': [
    '{name} ({n} paczka .zip)',
    '{name} ({n} paczki .zip)',
    '{name} ({n} paczek .zip)',
  ],
  'Maps spell {files} in a different letter case (e.g. {example}) — this folder holds one name per file; for a Linux server, send the ZIP pack, which contains every spelling.':
    '{files} mapy zapisują inną wielkością liter (np. {example}) — ten folder ma jedną nazwę każdego pliku; na serwer Linux wyślij paczkę ZIP, która zawiera wszystkie pisownie.',
  '{file}: not copied ({error})': '{file}: nie skopiowano ({error})',
  '{map}: saved as {file} (duplicate map name)': '{map}: zapisano jako {file} (powtórzona nazwa mapy)',
  '{name} ({n} .smap file)|{name} ({n} .smap files)': [
    '{name} ({n} plik .smap)',
    '{name} ({n} pliki .smap)',
    '{name} ({n} plików .smap)',
  ],
  'File skipped in the pack: {error}': 'Pominięto plik w paczce: {error}',
  '{file}: the file disappeared from disk before packing': '{file}: plik zniknął z dysku przed spakowaniem',
  // CRC32 manifest header
  'Soldat Map Studio v{version} — map checksums for pack "{pack}"':
    'Soldat Map Studio v{version} — sumy kontrolne map paczki "{pack}"',
  'Generated: {date} UTC': 'Wygenerowano: {date} UTC',
  'CRC32 in OpenSoldat format (the same checksum the game uses to compare map versions)':
    'CRC32 w formacie OpenSoldat (ta sama suma, którą gra porównuje wersje map)',
  'map;crc32;size_bytes;file': 'mapa;crc32;rozmiar_bajtow;plik',
  // README_PACK.txt
  'Generated by: Soldat Map Studio v{version} (MPA Pro)': 'Wygenerowano przez: Soldat Map Studio v{version} (MPA Pro)',
  'Date: {date}': 'Data: {date}',
  'Number of maps: {count}': 'Liczba map: {count}',
  'MAP LIST:': 'SPIS MAP:',
  '{name} | Mode: {mode} | Poly: {poly} | Scen: {scen} | Size: {size}':
    '{name} | Tryb: {mode} | Poly: {poly} | Scen: {scen} | Wymiar: {size}',
  'MISSING FILE WARNINGS ({count}):': 'OSTRZEŻENIA O BRAKUJĄCYCH PLIKACH ({count}):',
  '{map}: missing {file}': '{map}: brak {file}',
  'INSTALLATION:': 'INSTALACJA:',
  'Extract the archive contents directly into the main folder of the Soldat / OpenSoldat game or server.':
    'Wypakuj zawartość archiwum bezpośrednio do głównego folderu gry lub serwera Soldat / OpenSoldat.',
  "The pack's map list is in {file} — copy its contents into the server's mapslist.txt":
    'Lista map paczki jest w pliku {file} — skopiuj jej zawartość do mapslist.txt serwera,',
  "if you want to add these maps to the rotation (the server's mapslist.txt is not overwritten).":
    'jeśli chcesz dodać te mapy do rotacji (plik mapslist.txt serwera nie jest nadpisywany).',

  // mapFixerOptimizer.ts — Scenery Fixer (_f) and Layer Optimizer (_o)
  'Map file not found: {id}': 'Nie znaleziono pliku mapy: {id}',
  'Source map not found: {id}': 'Nie znaleziono mapy źródłowej: {id}',
  'Zero / negative size in the PMS (the scenery is invisible or mirrored in game)':
    'Zerowy / ujemny wymiar w PMS (w grze sceneria jest niewidoczna lub odbita)',
  'HD scenery enlarged {factor}× after saving in the old PolyWorks':
    'Powiększona {factor}× sceneria HD po zapisie w starym PolyWorks',
  'Stretched Power-of-Two texture ({from} → {to})': 'Rozciągnięta tekstura Power-of-Two ({from} → {to})',
  'Wrong Power-of-Two size from MapMaker ({from} → {to})': 'Błędny rozmiar Power-of-Two z MapMakera ({from} → {to})',
  'Distorted scenery proportions ({from} → {to})': 'Zniekształcone proporcje scenerii ({from} → {to})',
  'Size differs from the file ({from} → {to})': 'Różnica wymiaru względem pliku ({from} → {to})',
  'probably not the file the map was made with; the game uses the size saved in the map':
    'prawdopodobnie to nie ten plik, z którym powstała mapa; gra używa wymiaru zapisanego w mapie',
  'The output map would have the same name and folder as the source map — saving stopped so the original is not overwritten.':
    'Mapa wynikowa miałaby tę samą nazwę i folder co mapa źródłowa — zapis przerwany, aby nie nadpisać oryginału.',
  'File {file} exists and is not an unchanged Studio output for this map — skipped.':
    'Plik {file} istnieje i nie jest niezmienionym wynikiem Studio dla tej mapy — pominięto.',
  'File {file} already exists in the target folder. Confirm the overwrite to continue.':
    'Plik {file} już istnieje w folderze docelowym. Potwierdź nadpisanie, aby kontynuować.',
  'The optimization session has expired or does not exist.': 'Sesja optymalizacji wygasła lub nie istnieje.',
  'Empty tile PNG file.': 'Pusty plik PNG kafelka.',
  'Invalid layer tile metadata.': 'Nieprawidłowe metadane kafelka warstwy.',
  'The uploaded tile is not a valid PNG file.': 'Przesłany kafelek nie jest prawidłowym plikiem PNG.',
  'The map or its sceneries changed since the plan was prepared — prepare the preview or plan again.':
    'Mapa lub jej scenerie zmieniły się od przygotowania planu — przygotuj podgląd lub plan ponownie.',
  'Tile name {name} collides with the sceneries of the source map.':
    'Nazwa kafelka {name} koliduje ze sceneriami mapy źródłowej.',
  'The result would exceed the Soldat engine limits ({limits}) — the game would not load the map. Enable removal of unused sceneries or reduce the number of tiles (larger tile / lower quality).':
    'Wynik przekroczyłby limity silnika Soldat ({limits}) — gra nie wczytałaby mapy. Włącz czyszczenie nieużywanych scenerii lub zmniejsz liczbę kafelków (większy kafelek / niższa jakość).',
  'Choose a custom target folder or change the save location.':
    'Wybierz własny folder docelowy albo zmień miejsce zapisu.',
  // Engine limit labels (MapLimitViolation.label from shared/pmsParser)
  Polygons: 'Poligony',
  'Sector grid': 'Siatka sektorów',
  'Sceneries (props)': 'Scenerie (propy)',
  'Scenery entries': 'Wpisy scenerii',
  Colliders: 'Collidery',
  'Spawn points': 'Spawny',

  // zipSafety.ts — archive extraction
  'File {file} is encrypted — such archives are not supported.':
    'Plik {file} jest zaszyfrowany — takie archiwa nie są obsługiwane.',
  'File {file} uses an unsupported compression method ({method}) — extract the archive with another program.':
    'Plik {file} używa nieobsługiwanej metody kompresji ({method}) — rozpakuj archiwum innym programem.',
  'Path {path} goes through a symbolic link — extraction stopped.':
    'Ścieżka {path} prowadzi przez dowiązanie symboliczne — wypakowanie przerwane.',
  'Unsafe path in the archive: {path}': 'Niebezpieczna ścieżka w archiwum: {path}',
  'The archive contains overlapping entries ({file}) — it looks crafted.':
    'Archiwum zawiera nakładające się wpisy ({file}) — wygląda na spreparowane.',
  'File {file} in the archive is too large ({size} B).': 'Plik {file} w archiwum jest za duży ({size} B).',
  'The extracted archive contents would exceed the size limit.':
    'Zawartość archiwum po rozpakowaniu przekroczyłaby limit rozmiaru.',
  'The archive ({archiveSize} B) would extract to {totalBytes} B — this looks like a "zip bomb", extraction stopped.':
    'Archiwum ({archiveSize} B) rozpakowałoby się do {totalBytes} B — to wygląda na „zip-bombę”, wypakowanie przerwane.',
  'Corrupted file in the archive: {file}': 'Uszkodzony plik w archiwum: {file}',

  // screenshotAssembler.ts — tiled screenshots
  'Invalid image dimensions.': 'Nieprawidłowe wymiary obrazu.',
  'The {width}×{height} px image exceeds the limit of {limit} px per side — reduce the scale.':
    'Obraz {width}×{height} px przekracza limit {limit} px na bok — zmniejsz skalę.',
  'Tiled render session not found: {id}': 'Nie znaleziono sesji renderowania kafelkowego: {id}',
  'Invalid tile position.': 'Nieprawidłowa pozycja kafelka.',
  'Empty tile.': 'Pusty kafelek.',

  // packPresets.ts
  'Enter a preset name.': 'Podaj nazwę presetu.',
  'You can save at most {max} presets.': 'Można zapisać najwyżej {max} presetów.',

  // platform.ts
  'The picker dialog needs zenity or kdialog (e.g. sudo apt install zenity) — you can also type the path manually.':
    'Okno wyboru wymaga programu zenity albo kdialog (np. sudo apt install zenity) — możesz też wpisać ścieżkę ręcznie.',
};
