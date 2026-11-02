# Changelog

## 2.5.2 — 2026-11-02

### Podgląd `_o`
- Gdy powiększenie w oknie mapy przekracza rozdzielczość podglądanych warstw (np. ponad ok. 230% przy jakości 2×),
  pasek podglądu wyjaśnia, że warstwy są wtedy tylko powiększane i wyglądają miękcej niż scenerie HD, oraz podaje
  skalę gry (przycisk „Skala gry” — 225% przy 1080p). Przykład `tw_Doppleganger`: 83% propów ma tekstury HD
  (co najmniej 3,5 piksela na jednostkę świata), więc przy 424% oryginał pokazuje więcej detali niż warstwa 2×; w skali
  gry ostrość wynosi 97,4% przy 2× i 101,3% przy 3×.
- Pasek podglądu pokazuje jakość, z którą podgląd został zbudowany (wcześniej — aktualnie wybraną w oknie).
- Opis kafelków 4096 px mówi, że zużywają więcej pamięci tekstur: gorzej przycinają puste miejsca, przez co tryb
  Auto może wybrać niższą jakość (`tw_Doppleganger`: 3× przy 2048 px, 2× przy 4096 px).

## 2.5.1 — 2026-11-02

### Naprawione
- **Poprawka 1.7.1 (`_f`, „najpierw napraw, potem sklej”) potrafiła zepsuć mapę**, np. pasy wody w `ctf_tw_hue`
  kurczyły się do wysp, bo `water.png` mierzono domyślnym `water.bmp` 100×100. Wymiar, który nie jest potęgą
  dwójki, pochodzi z pliku, którego naprawdę użył autor, a gra rysuje propy według wymiaru zapisanego w mapie —
  takie różnice są teraz pokazywane z wyjaśnieniem, ale nie są zaznaczane do naprawy. Zalecane zostają klasyczne
  błędy 1.7.1: rozmiary Power-of-Two ze starego MapMakera i powiększenia HD z PolyWorks. Plik 1×1 (zaślepka
  brakującego obrazu) nigdy nie jest celem naprawy. Na całej kolekcji z zaleceń wypadło 77 takich przypadków.
- Ponowna optymalizacja mapy, która już jest wynikiem `_o` (np. `ctf_tw_hue_o` → `ctf_tw_hue_o_f_o`), jest
  zablokowana z wyjaśnieniem — tryb wsadowy już takie mapy pomijał.
- Menu „Compare” nie jest już zasłaniane przez pasek podglądu `_f` / `_o`.

### Testy
- 62 testy automatyczne (1 nowy).

## 2.5.0 — 2026-11-01

Dwa języki interfejsu.

### Języki
- Interfejs po angielsku (domyślnie) i po polsku. Wybór w **Ustawieniach → Language / Język**; jest zapamiętany,
  a zmiana przeładowuje aplikację. Przycisk „Źródła Map” w nagłówku nazywa się teraz „Ustawienia”.
- Komunikaty serwera (błędy, ostrzeżenia, treść plików generowanych w paczkach, listy przywracania) przychodzą
  w języku wybranym w interfejsie.
- Polskie formy liczebników (1 mapa / 2 mapy / 5 map), liczby i daty w formacie wybranego języka.
- Teksty w kodzie są po angielsku, polskie tłumaczenia w słownikach `src/client/i18n/pl/` i `src/server/i18nPl.ts`.
- `README.md` po angielsku, z opisem dodatkowego narzędzia `soldat_map_dots.py` (Python 3.10+, numpy, Pillow);
  skrypty startowe i `soldat_map_dots.py` wypisują komunikaty po angielsku.
- Angielskie nazwy skryptów startowych: `Start Soldat Map Studio.bat` (dawniej `Uruchom Soldat Map Studio.bat`)
  i `start.sh`.

### Testy
- 61 testów automatycznych.

## 2.4.0 — 2026-11-01

Pierwsze wydanie z README, licencją i obsługą Linuksa.

### Ostrość `_o`
- Warstwy są przy wypalaniu lekko wyostrzane, z siłą dobraną pomiarem osobno dla każdej jakości. Gra filtruje
  sklejoną warstwę jeszcze raz przy wyświetlaniu (oryginalne scenerie tylko raz) i to dawało lekkie zmiękczenie.
  Ostrość względem oryginału na `ctf_tw_hue` (ekran 1080p): 3× 96,7% → 99,7%, 4× 95,9% → 99,7%,
  2× 91,9% → 99,1%, 1× 79,1% → 97,1%; średnia różnica kolorów taka sama albo mniejsza. Istniejące pliki `_o`
  warto wygenerować ponownie.

### Linux i macOS
- Skrypt `start.sh`: sprawdza Node.js, instaluje biblioteki, buduje interfejs i otwiera przeglądarkę.
- Otwieranie folderów oraz okna wyboru folderu i pliku działają też na Linuksie (`xdg-open`, `zenity` lub
  `kdialog`) i macOS. Gdy brakuje programu do okien, aplikacja mówi, co doinstalować; ścieżkę można też wpisać.
- Folder gry jest wykrywany ze wszystkich bibliotek Steama (Windows; Linux — także Proton i Flatpak; macOS)
  zamiast ścieżki wpisanej na stałe w kod.

### Projekt
- `README.md` z instrukcją dla Windows i Linuksa, `LICENSE` (dowolne użycie; modyfikacje i wykorzystanie części
  projektu wymagają podania TryHackX jako współautora), porządny `.gitignore`, robocze notatki usunięte
  z repozytorium, w `package.json` licencja, autor i wymagana wersja Node (22.13+).

### Testy
- 59 testów automatycznych (1 nowy), `npm audit`: 0 podatności.

## 2.3.2 — 2026-11-01

Ostrość scenerii, tryb Auto i wielkość liter w nazwach plików.

### Naprawione
- **Scenerie w Studio i w warstwach `_o` były miększe niż w grze** (zgłoszenie: palmy na `ctf_tw_hue`). OpenSoldat
  wybiera mipmapy o pół poziomu ostrzej (`r_mipmapbias` = −0,5), a renderer Studio tego nie robił. Teraz podgląd,
  porównanie, screeny, raport wierności i wypalanie `_o` rysują scenerie tak jak gra. Ostrość `_o` względem oryginału
  na ekranie 1080p: 3× 92,7% → 96,7%, 4× 93,2% → 95,9%. Istniejące pliki `_o` warto wygenerować ponownie.
- **Auto wybierało 1× (w grze rozmyte) dla dużych map**, bo rozmiar warstw liczyło z prostokąta obejmującego całą
  grupę scenerii. Teraz liczy tylko kafelki, w których coś jest — te same, które wypala Studio. Na testowej kolekcji
  (2370 map do sklejenia): 3× dla 2031 map (wcześniej 1494), 1× tylko dla 120 (wcześniej 454). `ctf_tw_hue`: 2× zamiast 1×.
- Wypalanie pomija puste kafelki; warstwa wymagająca ponad 500 kafelków jest odrzucana z komunikatem (taka mapa
  i tak nie wczytałaby się w grze).
- Plan `_o` mapy z propem o błędnych współrzędnych (`ctf_LaaF-Run`, x = −9,2·10¹⁸) zawieszał serwer (brak pamięci).
  Takie propy zostają nietknięte („Poza mapą”).
- Kategorie w panelu bocznym: zwykłe kliknięcie dodawało pozycję do zaznaczenia zamiast ją wybrać (np. tryb RSCS
  i prefiks `tw_` naraz, co dawało pustą listę). Teraz kliknięcie wybiera tylko tę pozycję, Ctrl+klik dodaje kolejne,
  a zaznaczone pozycje z różnych poziomów się sumują.
- Opisy jakości zgodne z pomiarem: 3× najostrzejsze na 1080p, 2× nieco miękkie, 4× dla 1440p i 4K.

### Wielkość liter w nazwach plików (Linux)
- Paczka z opcją „Napraw wielkość liter pod serwery Linux” zawiera plik pod każdą pisownią użytą w mapach
  (np. `fx_P_cloud5.png` i `fx_p_cloud5.png`). Wcześniej trafiała tylko pierwsza, więc część map na serwerze
  linuksowym nie znajdowała scenerii.
- „Porządki” → „Wielkość liter (Linux)”: raport plików, których nazwa różni się wielkością liter od wpisów w mapach,
  i zmiana nazwy tam, gdzie wszystkie mapy zapisują plik tak samo (lista zmian do cofnięcia w `data/backups/`).
  Skrót „Napraw…” przy filtrze w panelu bocznym. Mapy nie są modyfikowane.

### Raport wierności
- Nowa miara „ostrość”. Średnia różnica pikseli prawie nie reaguje na rozmycie drobnych detali, więc raport mógł
  pokazywać „Bardzo wysoka”, choć warstwy były wyraźnie miększe.

### Testy
- 58 testów automatycznych (8 nowych).

## 2.3.1 — 2026-11-01

Domknięcie luk po 2.3.0.

### Bezpieczeństwo
- Zależności bez znanych podatności (`npm audit`: 0): `adm-zip` 0.6.1, `sharp` 0.35.5, `archiver` 8.0.0,
  `minimatch` 11 (przez `overrides`).
- Bezpieczne wypakowywanie paczek map z internetu: walidacja całego archiwum przed zapisem (zip-slip, dowiązania,
  szyfrowanie, nieobsługiwana kompresja, „zip-bomby”), rozpakowanie do folderu tymczasowego.

### Naprawione (przegląd kodu 2.3.0)
- Minimapa po zmianie mapy była pusta albo pokazywała poprzednią mapę.
- Wznowiona seria screenów zaczyna od właściwej mapy i nie zmienia ustawień (wcześniej wymuszała „pomiń istniejące”).
- Gwiazdka w liście z filtrem nie przeładowuje już mapy i nie czyści wierszy.
- „Porządki”: przed przeniesieniem duplikatu sprawdzany jest dysk (kopia, która zostaje, musi istnieć i być identyczna),
  raport nieużywanych scenerii działa na aktualnym indeksie, jedna operacja naraz.
- Nazwa `_f_o` dla długich nazw map nie gubi już `_f` i nigdy nie powtarza nazwy źródła; zapis `_o` jest odrzucany,
  gdy mapa zmieniła się od przygotowania planu.
- Manifest CRC32 zgodny z zawartością paczki, dziennik serwera zapisuje się natychmiast, uszkodzone pliki ustawień
  nie są nadpisywane, poprawki w tagach, wyszukiwaniu, menu „Porównaj” i obsłudze błędów okien.
- Renderer nie usuwa już obiektów utraconego kontekstu WebGL (ostrzeżenia po resecie karty graficznej).

### Testy
- 50 testów automatycznych (18 nowych).

## 2.3.0 — 2026-11-01

Druga iteracja planu rozwoju.

### Warsztat map
- „Najpierw napraw wymiary scenerii 1.7.1, potem sklej” — `_f` i `_o` jednym kliknięciem (wynik `<mapa>_f_o`),
  również w trybie wsadowym.
- Miniatury „teraz / po” w tabeli diagnozy `_f`.
- Okno potwierdzenia nadpisania informuje o kopii zapasowej (wcześniej błędnie straszyło „bezpowrotnym” usunięciem).

### Podgląd map
- Obrysy scenerii z problemami 1.7.1 na mapie (przycisk „Problemy 1.7.1”).
- Ramka „Widok gracza” (480 jednostek wysokości, wybór proporcji ekranu).
- Minimapa z prostokątem widoku — kliknięcie przesuwa kamerę.
- Porównanie dwóch wersji mapy suwakiem (oryginał / `_f` / `_o` / podgląd zmian).

### Biblioteka
- Wyszukiwanie z filtrami: `props>300 tex:ananas prefix:ctf_cs_ is:fav -is:dup tag:turniej`.
- Ulubione mapy i własne tagi.
- „Porządki”: menedżer duplikatów CRC32 i raport nieużywanych scenerii — pliki trafiają do kopii zapasowej,
  nigdy nie są kasowane.

### Paczki i zrzuty
- Presety opcji paczek.
- Manifest sum CRC32 map w paczce.
- Wznawianie przerwanej serii screenów.

### Inżynieria
- Lokalne fonty (działa offline, bez Google Fonts).
- Dziennik serwera w `data/logs/`.
- Okna ładowane przy pierwszym otwarciu — mniejsza paczka startowa.
- 32 testy automatyczne.

## 2.2.0 — 2026-11-01

Pełny audyt kodu w dwóch fazach.

### Naprawione — najważniejsze
- **Rozmyte, bledsze scenerie w `_o`** (sople na `ctf_cs_office2`): warstwy były wypalane w 1 tekselu na jednostkę
  świata, a gra pokazuje ~2,25 px/jednostkę. Nowa domyślna jakość „Auto” (do 3×), kompozycja w RGBA16F,
  bezszwowe łączenie kafelków. Istniejące stare pliki `_o` warto wygenerować ponownie.
- Naprawa mapy kończącej się na `_f` mogła **nadpisać oryginał**; `_f`/`_o` nadpisywały istniejące pliki bez pytania.
- Zabezpieczenie przed stronami internetowymi odwołującymi się do lokalnego serwera (DNS rebinding).
- Kodowanie cp1250 nazw scenerii było niepełne — znaki spoza polskiego alfabetu ginęły przy zapisie.
- Skan indeksu potrafił „zawiesić się” na małych kolekcjach; nowe mapy `_f`/`_o` nie trafiały do listy.
- Warsztat mógł zastosować poprawki `_f` poprzedniej mapy do nowo wybranej.
- Rozpakowanie paczki nadpisywało `mapslist.txt` serwera (teraz `mapslist_<paczka>.txt`).
- Pusty screen po utracie kontekstu WebGL, ciche błędy w trybach wsadowych i przy dodawaniu do paczki.

### Nowe funkcje
- Podgląd wyniku `_o` w oknie mapy przed zapisem + raport wierności w skali ekranu 1080p.
- Wsadowa optymalizacja `_o` dla koszyka / filtra.
- Kopie zapasowe każdego nadpisywanego pliku w `data/backups/`.
- Inspektor obiektów pod kursorem (scenerie, poligony).
- Wykrywanie map przekraczających limity silnika (500 propów, 5000 poligonów…) i nieczytelnych plików — kategoria
  „Nie wczytają się w grze”.
- Zapamiętywanie filtrów, widoku, warstw, paneli i koszyka między uruchomieniami; zwijane panele boczne.

### Wydajność
- Budżet pamięci dekodowanych tekstur (384 MB), bez zbędnych kopii w `<canvas>`.
- Szybszy test trafienia pod kursorem, mniej renderów listy, strumieniowy odczyt cache SQLite.
- Cache konwertowanych obrazów na serwerze, asynchroniczne kopiowanie paczek, skaner `_f` nie blokuje serwera.

### Inżynieria
- `npm test` (22 testy) i `npm run typecheck`.
- Skrypt startowy sprawdza wersję Node i sam przebudowuje interfejs po aktualizacji.
- Jedna wersja aplikacji: 2.2.0.
