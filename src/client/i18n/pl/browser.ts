import type { PlDictionary } from './types';

// Map browser: list / grid, search, category sidebar, prefix studio, error fallback, map data loading
export const BROWSER_PL: PlDictionary = {
  // Search cheat sheet (MapBrowserPanel) — the example tokens stay as they are
  'more than 300 sceneries (also polys, colliders, spawns, w, h, kb)':
    'więcej niż 300 scenerii (także polys, colliders, spawns, w, h, kb)',
  'texture contains “ananas” (scen:, title:, name:, src:, mode:, crc:)':
    'tekstura zawiera „ananas” (scen:, title:, name:, src:, mode:, crc:)',
  'name starts with ctf_cs_': 'nazwa zaczyna się od ctf_cs_',
  'favorites (is:broken, is:dup, is:vanilla, is:custom, is:bad)':
    'ulubione (is:broken, is:dup, is:vanilla, is:custom, is:bad)',
  'maps with your tag': 'mapy z Twoim tagiem',
  'weather: none, rain, sand, snow': 'pogoda: brak, deszcz, piasek, snieg',
  'minus before a filter = exclude': 'minus przed filtrem = wyklucz',
  'Filters (click to add):': 'Filtry (kliknij, aby dodać):',
  'Words without a colon search the name, title, texture and scenery names.':
    'Słowa bez dwukropka szukają w nazwie, tytule, teksturze i nazwach scenerii.',

  // Map list and grid (MapBrowserPanel)
  'Remove from favorites': 'Usuń z ulubionych',
  'Add to favorites': 'Dodaj do ulubionych',
  'No preview': 'Brak podglądu',
  'GPU rendering...': 'Render GPU...',
  'Remove from pack (Shift+click = range)': 'Usuń z paczki (Shift+Klik = zakres)',
  'Add to pack (Shift+click = range)': 'Dodaj do paczki (Shift+Klik = zakres)',
  'Missing graphics files: {n}': 'Brakuje {n} plików graficznych!',
  'Missing assets: {n}': 'Brakuje {n} assetów',
  'Found {n} maps with an identical CRC32 checksum': 'Wykryto {n} map o identycznej sumie CRC32',
  "The map exceeds Soldat engine limits (e.g. > 500 sceneries) and won't load in game":
    'Mapa przekracza limity silnika Soldat (np. > 500 scenerii) i nie wczyta się w grze',
  'The PMS file is partially damaged': 'Plik PMS jest częściowo uszkodzony',
  'Custom files to pack: {n}': '{n} niestandardowych plików do spakowania',
  'Search (e.g. ctf_cs props>300 tex:ananas)': 'Szukaj (np. ctf_cs props>300 tex:ananas)',
  'Search syntax': 'Składnia wyszukiwania',
  'Search syntax (filters props>300, tex:, is:fav…)': 'Składnia wyszukiwania (filtry props>300, tex:, is:fav…)',
  'Clear search': 'Wyczyść wyszukiwanie',
  'Recognized search filters': 'Rozpoznane filtry wyszukiwania',
  'Sort:': 'Sortuj:',
  'Name (A–Z)': 'Nazwa (A–Z)',
  'Polygons (descending)': 'Poligony (malejąco)',
  'Sceneries (descending)': 'Scenerie (malejąco)',
  'Width (descending)': 'Szerokość (malejąco)',
  'Height (descending)': 'Wysokość (malejąco)',
  'File size': 'Rozmiar pliku',
  'Recently modified': 'Ostatnio zmienione',
  'Virtual list view (60 FPS for 50k+ maps)': 'Widok wirtualnej listy (60 FPS dla 50k+ map)',
  'Virtual grid with GPU thumbnails': 'Wirtualna siatka z miniaturkami GPU',
  'Index query time: {ms} ms': 'Czas zapytania indeksu: {ms} ms',
  'Results:': 'Wyniki:',
  'Add all currently filtered maps to the pack': 'Dodaj wszystkie aktualnie przefiltrowane mapy do paczki',
  '+All': '+Wszystkie',
  'Remove the filtered maps from the pack': 'Usuń widoczne w filtrze mapy z paczki',
  'Generate 100% screenshots in bulk (Batch)': 'Wsadowe generowanie screenów 100% (Batch)',
  'Could not load the map list: {error}': 'Nie udało się pobrać listy map: {error}',
  'Try again': 'Spróbuj ponownie',
  'No maps match the selected filters.': 'Brak map spełniających wybrane kryteria filtrowania.',

  // Map categories, tags and sources (PrefixSidebar)
  'Map categories': 'Kategorie Map',
  'All maps': 'Wszystkie mapy',
  'Custom maps': 'Mapy Customowe',
  'Default (vanilla)': 'Domyślne (Vanilla)',
  'Missing files': 'Brakujące pliki',
  'CRC32 duplicates': 'Duplikaty CRC32',
  "Won't load in game": 'Nie wczytają się w grze',
  Favorites: 'Ulubione',
  'Selected for pack': 'Wybrane do paczki',
  'Your tags ({n})': 'Twoje tagi ({n})',
  'Show maps tagged “{tag}” (adds tag:{tag} to the search)': 'Pokaż mapy z tagiem „{tag}” (dodaje tag:{tag} do wyszukiwania)',
  'Map sources ({n})': 'Źródła Map ({n})',

  // Classification: modes / prefixes / series (PrefixSidebar)
  Classification: 'Klasyfikacja',
  'Clear ({n})': 'Wyczyść ({n})',
  'Add custom prefixes, clan categories or RSCS / Trenchwars rules':
    'Dodaj własne prefixy, kategorie klanowe lub reguły RSCS / Trenchwars',
  '+ Custom prefix': '+ Własny Prefix',
  'Modes ({n})': 'Tryby ({n})',
  'Prefixes ({n})': 'Prefixy ({n})',
  'Series ({n})': 'Serie ({n})',
  'Automatically detected two-part series (e.g. ctf_ns_, ctf_vir_)':
    'Automatycznie wykryte serie dwuczłonowe (np. ctf_ns_, ctf_vir_)',
  'Search (RSCS, tw_, ctf_cs_, kz_...)': 'Szukaj (RSCS, tw_, ctf_cs_, kz_...)',
  'Clear prefix search': 'Wyczyść wyszukiwanie prefixów',
  'Click to filter • {ctrl}+click for several': 'Kliknij aby filtrować • {ctrl}+Klik wiele',
  'Collapse {name}': 'Zwiń {name}',
  'Expand {name}': 'Rozwiń {name}',
  'no prefix': 'brak',
  'Add all maps of mode "{name}" ({count}) to the pack': 'Dodaj wszystkie mapy trybu "{name}" ({count}) do paczki',
  'Add all "{label}" maps ({count}) to the pack': 'Dodaj wszystkie mapy "{label}" ({count}) do paczki',
  '{n} map|{n} maps': ['{n} mapa', '{n} mapy', '{n} map'],
  'No two-part sub-series detected for the current query.':
    'Brak wykrytych pod-serii dwuczłonowych dla bieżącego zapytania.',
  'series in {prefix}': 'seria w {prefix}',
  'Turn this series into a permanent custom prefix / category': 'Wydziel tę serię jako stały własny prefix / kategorię',

  // Technical filters (PrefixSidebar)
  'Technical filters': 'Filtry Techniczne',
  'Weather:': 'Pogoda:',
  'Any weather': 'Dowolna',
  'No weather': 'Brak pogody',
  Rain: 'Deszcz',
  Sandstorm: 'Burza piaskowa',
  Snow: 'Śnieg',
  'Has colliders': 'Posiada Colidery',
  'Has bot waypoints': 'Posiada ścieżki Botów',
  'Letter case mismatch (Linux)': 'Różna wielkość liter (Linux)',
  'Show files whose letter case differs from the maps and fix their names':
    'Pokaż pliki z inną wielkością liter niż w mapach i popraw ich nazwy',
  'Fix…': 'Napraw…',

  // Prefix studio (PrefixStudioModal)
  'Soldat Prefix & Mode Studio (RSCS / Trenchwars / Custom)':
    'Studio Prefixów i Trybów Soldat (RSCS / Trenchwars / Custom)',
  'Create custom categories, multi-part prefixes (e.g. {first}, {second}) and wildcard / regex rules':
    'Twórz własne kategorie, prefixy wieloczłonowe (np. {first}, {second}) oraz reguły Wildcard / Regex',
  'Export custom prefixes to a JSON file': 'Eksportuj własne prefixy do pliku JSON',
  'Export JSON': 'Eksport JSON',
  'Close the prefix studio': 'Zamknij studio prefixów',
  'Edit prefix rule': 'Edycja reguły prefixu',
  'Add custom prefix / category': 'Dodaj własny prefix / kategorię',
  'Cancel editing': 'Anuluj edycję',
  'Category or rule name': 'Nazwa kategorii lub reguły',
  'e.g. SCTFL League, NS Clan Maps, Fixed (_f)': 'np. Liga SCTFL, Mapy Klanu NS, Poprawione (_f)',
  'Prefixes (separated by commas or spaces)': 'Prefixy (oddzielone przecinkiem lub spacją)',
  'e.g. ctf_ns_, sctfl_, ctf_cup_': 'np. ctf_ns_, sctfl_, ctf_cup_',
  'Longer prefixes (e.g. {long}) automatically take priority over the general {short}.':
    'Dłuższe prefixy (np. {long}) mają automatycznie wyższy priorytet niż ogólne {short}.',
  'Wildcard or regex pattern {optional}': 'Wzorzec Wildcard lub Regex {optional}',
  '(optional)': '(opcjonalnie)',
  'e.g. *_f, *arena* or /^ctf_[0-9]+_/i': 'np. *_f, *arena* lub /^ctf_[0-9]+_/i',
  'Assign to a sidebar group': 'Przypisz do grupy na pasku bocznym',
  '★ Create a separate custom category in the Modes list': '★ Utwórz osobną własną kategorię na liście Trybów',
  'Attach to existing mode: {name}': 'Podepnij pod istniejący tryb: {name}',
  'Badge color': 'Kolor plakietki',
  'Pick any HEX color': 'Wybierz dowolny kolor HEX',
  'Update the rule in the list': 'Zaktualizuj regułę na liście',
  'Add the rule to the list': 'Dodaj regułę do listy',
  'Two-part series detected in your collection': 'Wykryte serie 2-członowe w Twojej kolekcji',
  'Click a series to fill in the form quickly and turn it into a separate prefix:':
    'Kliknij serię, aby szybko wypełnić formularz i wydzielić ją jako osobny prefix:',
  'Series {tag}': 'Seria {tag}',
  'Live classifier tester (type any map name):': 'Tester klasyfikatora na żywo (wpisz dowolną nazwę mapy):',
  'e.g. ctf_cs_747, ctf_ttw_bunker, tw_cathedral...': 'np. ctf_cs_747, ctf_ttw_bunker, tw_cathedral...',
  'Series: {subprefix}': 'Seria: {subprefix}',
  'Your custom rules and prefixes ({n})': 'Twoje Własne Reguły i Prefixy ({n})',
  'Custom rules take precedence over built-in ones': 'Własne reguły mają pierwszeństwo przed wbudowanymi',
  'No custom rules defined. Built-in modes (RSCS, Trenchwars, CTF, Climb, INF, HTF...) work automatically — you can add your own clan, league or custom prefixes here!':
    'Brak zdefiniowanych własnych reguł. Wbudowane tryby (RSCS, Trenchwars, CTF, Climb, INF, HTF...) działają automatycznie — poniżej możesz dodać własne prefixy klanowe, ligowe lub niestandardowe!',
  '→ attached to: {group}': '→ podpięte do: {group}',
  'pattern: {pattern}': 'wzór: {pattern}',
  'Higher priority': 'Wyższy priorytet',
  'Lower priority': 'Niższy priorytet',
  Edit: 'Edytuj',
  'Delete rule': 'Usuń regułę',
  'Built-in compound modes (always active automatically)': 'Wbudowane Tryby Złożone (aktywne zawsze automatycznie)',
  '(no prefix)': '(brak)',
  'Saving the rules instantly reclassifies every map in memory (even 50,000+ maps, without re-reading the disk).':
    'Zapisanie reguł natychmiast przeklasyfikuje wszystkie mapy w pamięci (nawet 50 000+ map bez ponownego czytania dysku).',
  Cancel: 'Anuluj',
  'Saving...': 'Zapisywanie...',
  'Save and apply prefixes': 'Zapisz i Zastosuj Prefixy',
  // Rule validation and JSON import
  'Enter a name for the rule or custom category (e.g. "NS Clan Maps" or "RSCS Extra").':
    'Podaj nazwę reguły lub własnej kategorii (np. "Mapy Klanu NS" albo "RSCS Extra").',
  'Enter at least one prefix (e.g. ctf_ns_) or a wildcard/regex pattern (e.g. *_fix).':
    'Podaj przynajmniej jeden prefix (np. ctf_ns_) lub wzorzec Wildcard/Regex (np. *_fix).',
  'The JSON file must contain an array of rules.': 'Plik JSON musi zawierać tablicę reguł.',
  'The file contains no valid rule (a name and a prefix or pattern are required).':
    'Plik nie zawiera żadnej poprawnej reguły (wymagana nazwa oraz prefix lub wzorzec).',
  'Imported {valid} of {total} rules — invalid entries were skipped.':
    'Zaimportowano {valid} z {total} reguł — pominięto niepoprawne wpisy.',
  'Invalid JSON file.': 'Nieprawidłowy plik JSON.',

  // Render error fallback (ErrorBoundary)
  'This view failed to render': 'Wystąpił błąd renderowania widoku',
  'Unknown UI error': 'Nieznany wyjątek środowiska UI',
  'Reload page': 'Odśwież stronę',
  'Restore view': 'Przywróć widok',

  // Loading map data (utils/mapCache) — "({status})" must stay last: App.tsx looks for "(404)"
  'Could not load the map file {id} ({status})': 'Nie udało się wczytać pliku mapy {id} ({status})',
  'Could not load the details of map {id} ({status})': 'Nie udało się pobrać szczegółów mapy {id} ({status})',
  'Could not save favorites / tags (HTTP {status})': 'Nie udało się zapisać ulubionych / tagów (HTTP {status})',
  'Could not load the map list (HTTP {status})': 'Nie udało się pobrać listy map (HTTP {status})',
};
