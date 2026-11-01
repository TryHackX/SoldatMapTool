# Changelog

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
