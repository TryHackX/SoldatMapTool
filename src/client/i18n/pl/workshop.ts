import type { PlDictionary } from './types';

// Map Workshop: 1.7.1 scenery fix (_f), Optimize Sceneries (_o), layer baking and batch runs
export const WORKSHOP_PL: PlDictionary = {
  // Header, tabs, name length limit, shared buttons
  'PMS Map Workshop — 1.7.1 Scenery Fix ({f}) and Optimize Sceneries ({o})':
    'Warsztat Map PMS — Naprawa Scenerii 1.7.1 ({f}) i Optimize Sceneries ({o})',
  'Lossless editing of the scenery tables that keeps polygon physics, collision sectors, spawn points and bot waypoints 100% intact':
    'Bezstratna modyfikacja tabel scenerii z 100% zachowaniem fizyki poligonów, sektorów kolizji, spawnów i waypointów',
  'Close workshop': 'Zamknij warsztat',
  '1. Soldat 1.7.1 Scenery Fix (_f.pms)': '1. Naprawa Scenerii Soldat 1.7.1 (_f.pms)',
  '2. Optimize Sceneries — Layer Merging (_o.pms)': '2. Optimize Sceneries — Sklejanie Warstw (_o.pms)',
  'Map name length limit:': 'Limit długości nazwy mapy:',
  'If the name with the _f or _o suffix exceeds this limit, the end of the base name is cut off before the suffix is added':
    'Jeśli nazwa z dopiskiem _f lub _o przekroczy ten limit, końcowe znaki nazwy bazowej zostaną obcięte przed dodaniem sufiksu',
  '16 characters (Soldat 1.6)': '16 znaków (Soldat 1.6)',
  '20 characters': '20 znaków',
  '24 characters (recommended)': '24 znaki (Zalecane)',
  '32 characters (OpenSoldat)': '32 znaki (OpenSoldat)',
  // Placeholder names shown while no map is selected
  map_f: 'mapa_f',
  map_o: 'mapa_o',
  '{n} map|{n} maps': ['{n} mapa', '{n} mapy', '{n} map'],
  'Current map ({name} → {derived}.pms)': 'Aktualna mapa ({name} → {derived}.pms)',
  'Current map ({name})': 'Aktualna mapa ({name})',
  'Batch Scan & Fix ({count} — {source})': 'Skaner i Naprawa Wsadowa ({count} — {source})',
  'Batch ({count} — {source})': 'Wsadowo ({count} — {source})',
  'Custom folder on disk...': 'Własny folder na dysku...',
  'Browse...': 'Przeglądaj...',
  'Show folder': 'Pokaż folder',
  'Open folder': 'Otwórz folder',
  'Open {name}': 'Otwórz {name}',
  Cancel: 'Anuluj',
  'Saving...': 'Zapisywanie...',
  'Select all': 'Zaznacz wszystkie',
  'Select none': 'Odznacz',

  // Tab 1: 1.7.1 scenery fix (_f) — current map
  'Also remove dead (unused) scenery entries from the .pms header':
    'Usuń przy okazji martwe (nieużywane) wpisy scenerii z nagłówka .pms',
  'Where to save the {files} files:': 'Miejsce zapisu plików {files}:',
  'Straight into Soldat/maps/ (visible in the game and Studio right away)':
    'Bezpośrednio do Soldat/maps/ (od razu widoczne w grze i Studio)',
  'Separate project folder: exports/fixed_maps/maps/': 'Osobny katalog projektu: exports/fixed_maps/maps/',
  'Target folder path:': 'Ścieżka docelowego folderu:',
  'Choose a folder...': 'Wybierz katalog...',
  'Choose where to save the _f.pms maps': 'Wybierz folder zapisu map _f.pms',
  'How does the automatic 1.7.1 fix work?': 'Jak działa automatyczna naprawa 1.7.1?',
  "It finds sceneries the old MapMaker stretched to powers of two (e.g. {pot} instead of {a} or {b}) and sceneries enlarged {hd} after saving with HD textures in the old PolyWorks, and restores their exact 1:1 proportions without touching the author's scale.":
    'Wykrywa scenerie rozciągnięte przez stary MapMaker do potęg dwójki (np. {pot} zamiast {a} lub {b}) oraz scenerie powiększone {hd} po zapisie w starym PolyWorks na teksturach HD, przywracając im dokładne proporcje 1:1 bez ruszania skali autora.',
  'Scenery check of map {name}': 'Diagnoza scenerii mapy {name}',
  'analyzing...': 'analizowanie...',
  'Sceneries to fix: {selected} / {total} active • Dead entries: {dead}':
    'Do naprawy: {selected} / {total} aktywnych scenerii • Martwe wpisy: {dead}',
  'Select a map in the browser to analyze its sceneries.': 'Wybierz mapę w przeglądarce, aby przeanalizować jej scenerie.',
  'Could not analyze this map (details below).': 'Nie udało się przeanalizować tej mapy (szczegóły poniżej).',
  'Checking scenery sizes against the Soldat 1.6 table and the files on disk...':
    'Analizowanie wymiarów scenerii względem tabeli Soldat 1.6 oraz plików na dysku...',
  'All sceneries on this map already have correct 1.7.1 sizes!':
    'Wszystkie scenerie na tej mapie mają już prawidłowe wymiary 1.7.1!',
  'No stretched Power-of-Two textures or wrong 4.5× HD scaling found.':
    'Nie wykryto rozciągniętych tekstur Power-of-Two ani błędnego przeskalowania 4.5× HD.',
  'Definite 1.7.1 error': 'Pewny błąd 1.7.1',
  'Optional difference': 'Opcjonalna różnica',
  "author's scale (sample):": 'przykładowa skala autora:',
  // Thumbnails: scenery at the current and at the corrected size
  now: 'teraz',
  after: 'po',
  'Live 1.7.1 fix preview ({n} scenery fixed → {name}.pms)|Live 1.7.1 fix preview ({n} sceneries fixed → {name}.pms)': [
    'Podgląd naprawy 1.7.1 na żywo ({n} naprawiona sceneria → {name}.pms)',
    'Podgląd naprawy 1.7.1 na żywo ({n} naprawione scenerie → {name}.pms)',
    'Podgląd naprawy 1.7.1 na żywo ({n} naprawionych scenerii → {name}.pms)',
  ],
  'Could not check the target file.': 'Błąd sprawdzania pliku docelowego.',
  'Could not save the _f.pms map': 'Błąd zapisywania mapy _f.pms',
  'Saved the fixed map: {file} (sceneries fixed: {fixed}, dead entries removed: {removed})':
    'Zapisano naprawioną mapę: {file} (naprawiono {fixed} scenerii, usunięto {removed} martwych wpisów)',
  'Previous version of the file saved in a backup: {dir}': 'Poprzednia wersja pliku zapisana w kopii: {dir}',
  'Live fix preview in the map view (not saved)': 'Podgląd naprawy na żywo w oknie mapy (bez zapisu)',
  'Fix and save {name}.pms': 'Napraw i zapisz {name}.pms',

  // Tab 1: batch scan & fix
  'Batch scan failed': 'Błąd skanowania wsadowego',
  'Batch fix failed': 'Błąd wsadowej naprawy map',
  'Automatic scanner for broken 1.7.1 sceneries in the collection ({count} — {source})':
    'Automatyczny skaner uszkodzonych scenerii 1.7.1 w kolekcji ({count} — {source})',
  'Searches e.g. all RSCS maps ({cs}, {de}) and Trenchwars ({tw}, {ttw}) and finds stretched sceneries':
    'Przeszukuje np. wszystkie mapy RSCS ({cs}, {de}) oraz Trenchwars ({tw}, {ttw}) i wykrywa rozciągnięte scenerie',
  'Scanning maps...': 'Skanowanie map...',
  'Scan maps for 1.7.1 errors': 'Skanuj mapy pod kątem błędów 1.7.1',
  'Click “{button}” to find every map with stretched sceneries in a few seconds.':
    'Kliknij „{button}”, aby w kilka sekund znaleźć wszystkie mapy z rozciągniętymi sceneriami.',
  'No broken 1.7.1 maps found in the selected set!': 'Nie znaleziono żadnych uszkodzonych map 1.7.1 w wybranym zestawie!',
  'Maps with scenery errors: {count} (selected: {selected})':
    'Wykryto map z błędami scenerii: {count} (zaznaczono: {selected})',
  'Already has an _f file on disk': 'Posiada już plik _f na dysku',
  'Once the names are shortened, both maps would produce the same _f file — change the name length limit':
    'Po skróceniu nazwy obie mapy dałyby ten sam plik _f — zmień limit długości nazwy',
  'Same output name as {name}': 'Ta sama nazwa wynikowa co {name}',
  '{n} scenery to fix|{n} sceneries to fix': ['{n} scen.', '{n} scen.', '{n} scen.'],
  'Created {n} fixed *_f.pms map (sceneries corrected in total: {props})|Created {n} fixed *_f.pms maps (sceneries corrected in total: {props})':
    [
      'Utworzono {n} naprawioną mapę *_f.pms (łącznie poprawiono {props} scenerii)',
      'Utworzono {n} naprawione mapy *_f.pms (łącznie poprawiono {props} scenerii)',
      'Utworzono {n} naprawionych map *_f.pms (łącznie poprawiono {props} scenerii)',
    ],
  'Skipped {n} map whose _f file already existed (tick “Overwrite existing” to recreate it).|Skipped {n} maps whose _f file already existed (tick “Overwrite existing” to recreate them).':
    [
      'Pominięto {n} mapę, której plik _f już istniał (zaznacz „Nadpisuj istniejące”, aby ją odtworzyć).',
      'Pominięto {n} mapy, których plik _f już istniał (zaznacz „Nadpisuj istniejące”, aby je odtworzyć).',
      'Pominięto {n} map, których plik _f już istniał (zaznacz „Nadpisuj istniejące”, aby je odtworzyć).',
    ],
  'Errors: {count} (e.g. {map}: {error})': 'Błędy: {count} (np. {map}: {error})',
  'Overwrite existing {file} files (skipped by default)': 'Nadpisuj istniejące pliki {file} (domyślnie są pomijane)',
  'Fixing the selected maps...': 'Naprawianie zaznaczonych map...',
  'Fix selected maps ({count}) → *_f.pms': 'Napraw zaznaczone mapy ({count}) → *_f.pms',

  // Tab 2: Optimize Sceneries (_o) — settings
  'Layers to merge (like the manual optimization in {map})': 'Warstwy do sklejenia (jak ręczna optymalizacja w {map})',
  'Merges dozens or hundreds of overlapping bricks, shadows, walls and bushes on the same layer into single, perfectly aligned PNG sheets — completely removing alpha flickering and taking load off the game engine.':
    'Łączy dziesiątki/setki nakładających się cegieł, cieni, ścian i krzaków na tej samej warstwie w pojedyncze, idealnie spasowane arkusze PNG — całkowicie eliminując efekt migotania przezroczystości (alpha flickering) i odciążając silnik gry.',
  'Layer 0: Back': 'Warstwa 0: Tył',
  'Behind the player': 'Za graczem (Back)',
  'Layer 1: Middle': 'Warstwa 1: Środek',
  'Behind the polygons': 'Za poligonami (Mid)',
  'Layer 2: Front': 'Warstwa 2: Przód',
  'Hiding spots': 'Kryjówki (Front)',
  'Fix the 1.7.1 scenery sizes first (like {f}), then merge':
    'Najpierw napraw wymiary scenerii 1.7.1 (jak {f}), potem sklej',
  'Merging a map with stretched sceneries would bake the error into the PNG layers. The recommended fixes are applied in memory (no intermediate file) and the result is named {name}.':
    'Sklejanie mapy z rozciągniętymi sceneriami utrwaliłoby błąd w warstwach PNG. Zalecane poprawki są stosowane w pamięci (bez pliku pośredniego), a wynik dostaje nazwę {name}.',
  'This map: {n} scenery will be fixed before merging.|This map: {n} sceneries will be fixed before merging.': [
    'Ta mapa: {n} sceneria zostanie poprawiona przed sklejeniem.',
    'Ta mapa: {n} scenerie zostaną poprawione przed sklejeniem.',
    'Ta mapa: {n} scenerii zostanie poprawionych przed sklejeniem.',
  ],
  'This map needs no fixes — the result will be saved as a plain _o.':
    'Ta mapa nie wymaga poprawek — wynik zostanie zapisany jako zwykłe _o.',
  'PNG layer quality': 'Jakość rasteryzacji warstw PNG',
  'Auto — 3×, less for very large layers (now: {ss}×)': 'Auto — 3×, przy bardzo dużych warstwach mniej (teraz: {ss}×)',
  '1× Economy — blurry in game (thin details fade)': '1× Ekonomiczna — w grze rozmyta (cienkie detale bledną)',
  '2× Medium — slightly soft at 1080p (scale 0.5)': '2× Średnia — na 1080p nieco miększa (scale 0.5)',
  '3× Sharp — best for 1080p (scale 0.333)': '3× Ostra — najlepsza dla 1080p (scale 0.333)',
  '4× Maximum — 1440p and 4K (large files, scale 0.25)': '4× Maksymalna — 1440p i 4K (duże pliki, scale 0.25)',
  'Layer size: up to {mp} MPx (~{mb} MB VRAM, empty areas are cropped). At 1080p the game shows about 2.25 px per world unit: 3× comes out sharpest, 2× a little soft, 1× clearly blurry; 4× pays off from 1440p up.':
    'Rozmiar warstw: do {mp} MPx (~{mb} MB VRAM, puste obszary są przycinane). Na 1080p gra pokazuje ok. 2.25 px na jednostkę świata: 3× wychodzi najostrzej, 2× nieco miękko, 1× wyraźnie rozmyte; 4× przydaje się od 1440p.',
  'Maximum PNG tile size': 'Maksymalny rozmiar kafelka PNG',
  '2048 × 2048 px (100% GPU compatibility)': '2048 × 2048 px (100% kompatybilności GPU)',
  '4096 × 4096 px (fewer files on large maps)': '4096 × 4096 px (mniej plików na dużych mapach)',
  "Author's Intent Protection (Z-Order Safe)": 'Ochrona Zamysłu Autora (Z-Order Safe)',
  'Always keep animated {gif} sceneries separate (fire, water, blinking lamps)':
    'Zawsze zachowuj animowane scenerie {gif} osobno (ogień, woda, migające lampy)',
  'Splits the layer before and after the animation, keeping the order in which objects cover each other 100% intact':
    'Dzieli warstwę przed i za animacją, zachowując w 100% kolejność przykrywania obiektów',
  'Keep huge backgrounds / fog (e.g. {file}) without baking': 'Zachowaj ogromne tła / mgły (np. {file}) bez wypalania',
  'Scenery size threshold in the game world (px)': 'Próg rozmiaru scenerii w świecie gry (px)',
  'Prevents giant empty sky textures from being generated outside the play area':
    'Zapobiega generowaniu gigantycznych pustych tekstur nieba poza obszarem gry',
  "Don't create a new PNG for a single isolated scenery (e.g. the author's signature)":
    'Nie twórz nowego PNG dla pojedynczej odizolowanej scenerii (np. podpis autora)',
  'Use the classic Soldat 1.6 textures ({bmp}) instead of HD ({png}) when merging':
    'Użyj klasycznych tekstur Soldat 1.6 ({bmp}) zamiast HD ({png}) podczas sklejania',
  'Clear old, replaced scenery entries from the {pms} header': 'Oczyść nagłówek {pms} ze starych, zastąpionych wpisów scenerii',
  'Where to save the map {map} and the generated PNGs:': 'Miejsce zapisu mapy {map} i wygenerowanych PNG:',
  'Straight into Soldat (maps/ + scenery-gfx/ — ready for preview and an MPA pack!)':
    'Bezpośrednio do Soldat (maps/ + scenery-gfx/ — gotowe do podglądu i paczki MPA!)',
  'Separate folder: exports/optimized_maps/ (maps/ + scenery-gfx/)':
    'Osobny katalog: exports/optimized_maps/ (maps/ + scenery-gfx/)',
  'Choose the target folder...': 'Wybierz folder docelowy...',
  'Choose a folder for the optimized _o map': 'Wybierz folder dla zoptymalizowanej mapy _o',
  'Soldat/maps (visible in the game right away)': 'Soldat/maps (od razu widoczne w grze)',
  'custom folder (none chosen)': 'własny folder (nie wybrano)',

  // Tab 2: plan, preview and result for the current map
  'Sceneries before': 'Scenerie przed',
  'Estimated after merging': 'Szacowane po sklejeniu',
  'Object reduction': 'Redukcja obiektów',
  'Layer merging plan → {map}': 'Plan sklejania warstw → {map}',
  'recalculating...': 'przeliczanie...',
  'Groups: {groups} • Kept separate: {kept}': 'Grupy: {groups} • Zachowane osobno: {kept}',
  'Select a map in the browser to compute the scenery merging plan.':
    'Wybierz mapę w przeglądarce, aby obliczyć plan łączenia scenerii.',
  'Could not compute the plan for this map (details below).': 'Nie udało się obliczyć planu dla tej mapy (szczegóły poniżej).',
  'Computing layer groups and tile bounds...': 'Obliczanie grup warstw i granic kafelków...',
  'No multi-scenery groups to merge with the current settings.':
    'Brak grup wieloelementowych do sklejenia przy obecnych ustawieniach.',
  'Layer 0 (Back)': 'Warstwa 0 (Tył)',
  'Layer 1 (Middle)': 'Warstwa 1 (Środek)',
  'Layer 2 (Front)': 'Warstwa 2 (Przód)',
  '{layer} — run #{run}': '{layer} — przebieg #{run}',
  'Area: {w} × {h} px • up to {n} PNG sheet (empty tiles are skipped)|Area: {w} × {h} px • up to {n} PNG sheets (empty tiles are skipped)':
    [
      'Obszar: {w} × {h} px • maks. {n} arkusz PNG (puste kafelki są pomijane)',
      'Obszar: {w} × {h} px • maks. {n} arkusze PNG (puste kafelki są pomijane)',
      'Obszar: {w} × {h} px • maks. {n} arkuszy PNG (puste kafelki są pomijane)',
    ],
  'merges {n} scenery|merges {n} sceneries': ['łączy {n} scen.', 'łączy {n} scen.', 'łączy {n} scen.'],
  'Kept separate without baking ({count}):': 'Zachowane osobno bez wypalania ({count}):',
  // Why a scenery stays out of the baked layers
  'Background/Fog': 'Tło/Mgła',
  Isolated: 'Pojedyncza',
  'Size 0': 'Rozmiar 0',
  'Off map': 'Poza mapą',
  'Layer off': 'Wył.',
  'Done! Sceneries reduced: {before} → {after} ({files} • {size})':
    'Gotowe! Scenerie zredukowano z {before} → {after} ({files} • {size})',
  '{n} PNG file|{n} PNG files': ['{n} plik PNG', '{n} pliki PNG', '{n} plików PNG'],
  'Quality: {ss}× • compositing: {mode}': 'Jakość: {ss}× • kompozycja {mode}',
  'floating point (full alpha precision)': 'zmiennoprzecinkowa (pełna precyzja alfy)',
  '8-bit (GPU without float)': '8-bit (GPU bez float)',
  'removed {n} unused PNG left from the previous version|removed {n} unused PNGs left from the previous version': [
    'usunięto {n} nieużywany PNG z poprzedniej wersji',
    'usunięto {n} nieużywane PNG z poprzedniej wersji',
    'usunięto {n} nieużywanych PNG z poprzedniej wersji',
  ],
  'The map still exceeds Soldat limits: {list}': 'Mapa wciąż przekracza limity Soldata: {list}',
  'Previous versions of the overwritten files were saved in a backup: {dir}':
    'Poprzednie wersje nadpisanych plików zapisano w kopii: {dir}',
  'Bakes the layers in memory, compares them with the original at 1080p screen scale and lets you view the result — nothing is saved':
    'Wypala warstwy w pamięci, porównuje z oryginałem w skali ekranu 1080p i pozwala obejrzeć wynik — nic nie jest zapisywane',
  'Building the preview...': 'Tworzenie podglądu...',
  'Preview and fidelity report (not saved)': 'Podgląd i raport wierności (bez zapisu)',
  'Merging layers on the GPU...': 'Sklejanie warstw na GPU...',
  'Save this result as {name}.pms': 'Zapisz ten wynik jako {name}.pms',
  'Optimize sceneries and save {name}.pms': 'Zoptymalizuj scenerie i zapisz {name}.pms',
  'No maps to optimize in the pack selection / current filter.': 'Brak map do optymalizacji w koszyku / bieżącym filtrze.',
  // Banner of the preview shown in the map view
  'Optimize result preview ({name}.pms, {ss}×, not saved)': 'Podgląd wyniku Optimize ({name}.pms, {ss}×, bez zapisu)',
  'sharpness {pct}% of the original, avg. difference {diff}': 'ostrość {pct}% oryginału, śr. różnica {diff}',

  // Fidelity report
  'Low — the layers are clearly softer than the original': 'Niska — warstwy są wyraźnie miększe niż oryginał',
  'Good — colors match, but the layers are slightly softer than the original':
    'Dobra — kolory zgodne, ale warstwy nieco miększe niż oryginał',
  'Very high — the result is practically indistinguishable from the original':
    'Bardzo wysoka — wynik praktycznie nieodróżnialny od oryginału',
  'Good — small sharpness differences (consider a higher quality)':
    'Dobra — drobne różnice ostrości (rozważ wyższą jakość)',
  'Low — visible differences; raise the layer quality': 'Niska — widoczne różnice; zwiększ jakość rasteryzacji',
  'Result preview: {n} PNG tile ({mpx} MPx), quality {ss}×|Result preview: {n} PNG tiles ({mpx} MPx), quality {ss}×': [
    'Podgląd wyniku: {n} kafelek PNG ({mpx} MPx), jakość {ss}×',
    'Podgląd wyniku: {n} kafelki PNG ({mpx} MPx), jakość {ss}×',
    'Podgląd wyniku: {n} kafelków PNG ({mpx} MPx), jakość {ss}×',
  ],
  'Show in map view': 'Pokaż w oknie mapy',
  'Match with the original (rendered at 1080p screen scale): {rating}':
    'Zgodność z oryginałem (render w skali ekranu 1080p): {rating}',
  'sharpness {sharp}% of the original • avg. difference {mean} / 255 • pixels differing by > 8: {over8}% • max {max} • sample {mp} MPx':
    'ostrość {sharp}% oryginału • śr. różnica {mean} / 255 • pikseli z różnicą > 8: {over8}% • maks. {max} • próbka {mp} MPx',
  'worst area x={x}, y={y} (avg. {mean})': 'najgorszy obszar x={x}, y={y} (śr. {mean})',
  'No areas to compare.': 'Brak obszarów do porównania.',
  'The settings changed after the preview was made — saving will bake the layers again with the new settings.':
    'Ustawienia zmieniły się po utworzeniu podglądu — zapis wypali warstwy ponownie z nowymi ustawieniami.',

  // Overwrite confirmation
  'The file {file} already exists in the target folder.': 'Plik {file} już istnieje w folderze docelowym.',
  'This is a previous Soldat Map Studio result (the file has not been changed since).':
    'To poprzedni wynik Soldat Map Studio (plik nie był od tego czasu zmieniany).',
  'WARNING: this file did NOT come from Soldat Map Studio or has been changed (map title: “{title}”) — overwriting it will replace a different map!':
    'UWAGA: ten plik NIE pochodzi z Soldat Map Studio albo był zmieniany (tytuł mapy: „{title}”) — nadpisanie zastąpi inną mapę!',
  'WARNING: this file did NOT come from Soldat Map Studio or has been changed — overwriting it will replace a different map!':
    'UWAGA: ten plik NIE pochodzi z Soldat Map Studio albo był zmieniany — nadpisanie zastąpi inną mapę!',
  '{n} layer PNG file will be replaced as well.|{n} layer PNG files will be replaced as well.': [
    'Zostanie też zastąpiony {n} plik PNG warstw.',
    'Zostaną też zastąpione {n} pliki PNG warstw.',
    'Zostanie też zastąpionych {n} plików PNG warstw.',
  ],
  'The previous versions will go to a backup in {dir}.': 'Poprzednie wersje trafią do kopii zapasowej w {dir}.',
  'Overwrite file': 'Nadpisz plik',

  // Tab 2: batch optimization (_o)
  'Batch optimization: {count} ({source})': 'Wsadowa optymalizacja: {count} ({source})',
  'Maps are merged on the GPU one after another, using the settings from the left column.':
    'Mapy są sklejane na GPU jedna po drugiej, z ustawieniami z lewej kolumny.',
  'Auto quality is chosen separately for each map (the sharpest that fits the memory limit).':
    'Jakość Auto jest dobierana osobno dla każdej mapy (najostrzejsza w limicie pamięci).',
  'Fixed {ss}× quality for all maps.': 'Stała jakość {ss}× dla wszystkich map.',
  'Skipped: maps with no sceneries to merge, maps that already are an {o} result and maps whose output file already exists. Saving to: {dest}.':
    'Pomijane są mapy bez scenerii do sklejenia, mapy będące już wynikiem {o} oraz mapy, których plik wynikowy już istnieje. Zapis: {dest}.',
  'The fidelity report is not computed for every map — check the preview on one map before a large batch.':
    'Raport wierności nie jest liczony dla każdej mapy — przed dużą serią sprawdź podgląd na jednej mapie.',
  'Replace earlier, unchanged Studio results for the same maps (the previous version goes to a backup). Files that Studio did not create are never overwritten.':
    'Zastępuj wcześniejsze, niezmienione wyniki Studio dla tych samych map (poprzednia wersja trafia do kopii zapasowej). Pliki, których Studio nie utworzyło, nigdy nie są nadpisywane.',
  'Map {index} / {total}: {name}': 'Mapa {index} / {total}: {name}',
  'Batch cancelled': 'Przerwano',
  'Batch stopped after 5 errors in a row': 'Zatrzymano po 5 błędach z rzędu',
  'Batch finished': 'Zakończono',
  '{status}: optimized {done} of {n} map|{status}: optimized {done} of {n} maps': [
    '{status}: zoptymalizowano {done} z {n} mapy',
    '{status}: zoptymalizowano {done} z {n} map',
    '{status}: zoptymalizowano {done} z {n} map',
  ],
  'Sceneries: {before} → {after} • PNG layers: {size}': 'Scenerie: {before} → {after} • warstwy PNG: {size}',
  'Skipped: existing {existing} • nothing to merge {nothing} • {o} results {derived} • errors {failed}':
    'Pominięto: istniejące {existing} • bez grup do sklejenia {nothing} • wyniki {o} {derived} • błędy {failed}',
  'not processed {n}': 'nieprzetworzone {n}',
  'Still over the Soldat limits ({count}):': 'Wciąż ponad limitami Soldata ({count}):',
  'Optimizing maps on the GPU...': 'Optymalizowanie map na GPU...',
  'Optimize {n} map → *_o.pms|Optimize {n} maps → *_o.pms': [
    'Zoptymalizuj {n} mapę → *_o.pms',
    'Zoptymalizuj {n} mapy → *_o.pms',
    'Zoptymalizuj {n} map → *_o.pms',
  ],
  // Batch progress and per-map results (renderer/optimizeBatch.ts)
  'Preparing the merging plan...': 'Przygotowanie planu sklejania...',
  'Already an optimization result': 'To już wynik optymalizacji',
  'No scenery groups to merge': 'Brak grup scenerii do sklejenia',
  'Same output name as {name} — skipped': 'Ta sama nazwa wynikowa co {name} — pominięto',
  'The output file already exists': 'Plik wynikowy już istnieje',

  // Layer baking progress and errors (renderer/SceneryLayerBaker.ts)
  'Could not prepare the scenery optimization plan.': 'Błąd przygotowania planu optymalizacji scenerii.',
  'Optimization cancelled.': 'Anulowano optymalizację.',
  'Cancelled.': 'Anulowano.',
  Back: 'Tył',
  Middle: 'Środek',
  Front: 'Przód',
  'Merging the {layer} layer (#{run}, {count}, {ss}×)...': 'Sklejanie warstwy {layer} (#{run}, {count}, {ss}×)...',
  '{n} scenery|{n} sceneries': ['{n} sceneria', '{n} scenerie', '{n} scenerii'],
  'Could not load the sceneries on the GPU (WebGL2 context lost).':
    'Nie udało się załadować scenerii na GPU (utracony kontekst WebGL2).',
  "The {layer} layer #{run} needs more than {max} tiles at {ss}× quality (the map would exceed the game's scenery limit) — choose a lower quality or 4096 px tiles.":
    'Warstwa {layer} #{run} wymaga ponad {max} kafelków przy jakości {ss}× (mapa przekroczyłaby limit scenerii gry) — wybierz niższą jakość albo kafelek 4096 px.',
  'Analyzing the layers and the scenery draw order...': 'Analizowanie warstw i kolejności rysowania scenerii...',
  'Comparing the result with the original (1080p screen scale)...':
    'Porównywanie wyniku z oryginałem (skala ekranu 1080p)...',
  'Preview ready.': 'Podgląd gotowy.',
  'Uploading layer {index} / {total} ({file})...': 'Wysyłanie warstwy {index} / {total} ({file})...',
  'Could not upload layer {file}.': 'Błąd wysyłania warstwy {file}.',
  'Saving {name}.pms and {n} PNG layer...|Saving {name}.pms and {n} PNG layers...': [
    'Zapisywanie {name}.pms oraz {n} warstwy PNG...',
    'Zapisywanie {name}.pms oraz {n} warstw PNG...',
    'Zapisywanie {name}.pms oraz {n} warstw PNG...',
  ],
  'Scenery optimization finished!': 'Zakończono optymalizację scenerii!',
};
