# Changelog

## 2.3.0 — 2026-11-01

Druga iteracja planu rozwoju — wszystkie pozostałe pozycje z `docs/PLAN_ROZWOJU.md`.

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

Pełny audyt kodu w dwóch fazach — szczegóły w `docs/AUDYT.md`, plan dalszego rozwoju w `docs/PLAN_ROZWOJU.md`.

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
