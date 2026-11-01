# Soldat Map Studio

Lokalna aplikacja do przeglądania, naprawiania i pakowania kolekcji map **Soldat / OpenSoldat**. Działa na
Twoim komputerze: mały serwer Node.js czyta folder gry, a interfejs otwiera się w przeglądarce pod adresem
`http://127.0.0.1:4321`. Nic nie jest wysyłane do internetu.

## Co potrafi

- **Biblioteka map** — indeks dziesiątek tysięcy map (SQLite), podział na tryby i prefiksy (CTF, RSCS, Trenchwars,
  Climb, INF, HTF…), własne prefiksy i kategorie, wyszukiwanie z filtrami (`props>300 tex:ananas is:fav -is:dup`),
  ulubione, tagi, wykrywanie brakujących plików, duplikatów CRC32 i map, których gra nie wczyta (limity silnika).
- **Podgląd 1:1 jak w grze** (WebGL2) — scenerie, poligony, krawędzie, tło, spawny, flagi, ścieżki botów, kolizje;
  inspektor obiektu pod kursorem, minimapa, ramka „widok gracza”, porównanie dwóch wersji mapy suwakiem,
  zrzuty całej mapy w 100% (pojedynczo i seryjnie).
- **Warsztat map**
  - `_f` — naprawa wymiarów scenerii rozciągniętych po przejściu na Soldat 1.7.1,
  - `_o` — sklejanie setek scenerii w kilka warstw PNG (mniej obiektów, koniec migotania przezroczystości),
    z podglądem przed zapisem i raportem wierności,
  - `_f_o` — oba kroki naraz, także wsadowo dla wielu map; każdy nadpisywany plik trafia najpierw do kopii.
- **Paczki map dla serwerów** — ZIP, folder albo `.smap`, podział według prefiksu lub trybu, pomijanie plików
  domyślnych gry, lista map dla serwera, manifest CRC32, zapisane presety, poprawka wielkości liter pod Linuksa,
  bezpieczne wypakowywanie pobranych archiwów.
- **Porządki** — duplikaty, nieużywane scenerie, wielkość liter w nazwach plików (Linux). Pliki są przenoszone do
  kopii zapasowej z listą do przywrócenia, nigdy kasowane.

## Wymagania

| | Windows | Linux |
|---|---|---|
| Node.js | **22.13 lub nowszy** (najlepiej aktualne LTS) | **22.13 lub nowszy** |
| Przeglądarka | Edge, Chrome lub Firefox z WebGL2 | Chrome, Chromium lub Firefox z WebGL2 |
| Gra | folder Soldata z podfolderami `maps/`, `scenery-gfx/`, `textures/` | to samo (Steam przez Proton albo OpenSoldat) |
| Dodatkowo | — | `zenity` lub `kdialog` (okna wyboru folderu), `xdg-utils` (otwieranie folderów) |
| Miejsce | ok. 250 MB na biblioteki + miniatury map | to samo |

Node.js 22.13 to pierwsza wersja z wbudowanym modułem `node:sqlite`, na którym działa indeks map. Internet jest
potrzebny tylko raz — przy instalacji bibliotek (`npm install`).

## Windows

1. Zainstaluj **Node.js LTS** ze strony [nodejs.org](https://nodejs.org) (instalator `.msi`, domyślne opcje).
2. Pobierz projekt: na GitHubie **Code → Download ZIP** i rozpakuj, albo:
   ```bash
   git clone https://github.com/TryHackX/SoldatMapTool.git
   ```
3. Uruchom dwuklikiem **`Uruchom Soldat Map Studio.bat`**. Za pierwszym razem skrypt zainstaluje biblioteki
   i zbuduje interfejs (kilka minut), potem otworzy aplikację. Okno konsoli musi zostać otwarte — jego zamknięcie
   wyłącza aplikację.
4. Folder gry jest wykrywany sam ze wszystkich bibliotek Steama. Jeśli masz Soldata gdzie indziej, ustaw ścieżkę
   w **Ustawieniach** (ikona zębatki).

## Linux

1. Zainstaluj **Node.js 22.13+**. Wersje z repozytoriów dystrybucji bywają starsze — sprawdź `node --version`.
   Najprościej przez [nvm](https://github.com/nvm-sh/nvm):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   ```
   ```bash
   nvm install 22
   ```
2. Doinstaluj okna wyboru folderów i otwieranie folderów (opcjonalne — ścieżki można też wpisywać ręcznie):
   ```bash
   sudo apt install zenity xdg-utils
   ```
   Fedora: `sudo dnf install zenity xdg-utils`, Arch: `sudo pacman -S zenity xdg-utils`. Na KDE wystarczy `kdialog`.
3. Pobierz projekt i uruchom:
   ```bash
   git clone https://github.com/TryHackX/SoldatMapTool.git
   ```
   ```bash
   cd SoldatMapTool && ./uruchom.sh
   ```
   Skrypt instaluje biblioteki, buduje interfejs i otwiera przeglądarkę. Zamknięcie: `Ctrl+C` w terminalu.
   Jeśli plik nie ma prawa wykonania: `chmod +x uruchom.sh`.
4. Folder gry:
   - **Soldat ze Steama (Proton)** jest wykrywany sam: `~/.local/share/Steam/steamapps/common/Soldat`,
     `~/.steam/steam/…`, Steam z Flatpaka i dodatkowe biblioteki z `libraryfolders.vdf`.
   - **OpenSoldat** — w **Ustawieniach** wskaż folder, w którym są `maps/`, `scenery-gfx/` i `textures/`.
5. Linux rozróżnia wielkość liter w nazwach plików. Mapy, które zapisują nazwę scenerii inaczej niż plik na dysku,
   pokazuje filtr **„Różna wielkość liter (Linux)”**, a **Porządki → Wielkość liter (Linux)** poprawia nazwy plików.
   Paczka z opcją **„Napraw wielkość liter pod serwery Linux”** zawiera każdą pisownię używaną w mapach.

## Uruchomienie ręczne (każdy system)

```bash
npm install
```
```bash
npm run build
```
```bash
npm start
```

Potem otwórz `http://127.0.0.1:4321`. Inny port: zmienna środowiskowa `PORT` (np. `PORT=4400 npm start`).

## Dla programistów

| Polecenie | Co robi |
|---|---|
| `npm run dev` | serwer z automatycznym restartem + interfejs Vite z podmianą na żywo (`http://localhost:5173`) |
| `npm test` | testy automatyczne (`node:test`) |
| `npm run typecheck` | sprawdzenie typów TypeScript |
| `npm run test:pms` | odczyt wszystkich map z folderu gry (test parsera na prawdziwej kolekcji) |

Budowa: serwer `src/server` (Express 5, `node:sqlite`, `sharp`), interfejs `src/client` (React 19, Vite, Tailwind,
WebGL2), wspólny kod `src/shared` (parser `.pms`, typy API). Zgodność z grą jest sprawdzana bezpośrednio ze źródłami
OpenSoldat — szczegóły w [`docs/AUDYT.md`](docs/AUDYT.md).

## Gdzie są dane

- `data/` — ustawienia (`config.json` ze ścieżkami tego komputera), indeks map, miniatury, kopie zapasowe
  (`data/backups/`), dziennik serwera (`data/logs/`).
- `exports/` — paczki, zrzuty map i mapy `_f`/`_o`, jeśli nie są zapisywane do folderu gry.

Oba foldery są lokalne i nie trafiają do repozytorium. Serwer nasłuchuje tylko na `127.0.0.1` i odrzuca zapytania
z obcych stron, więc inne komputery w sieci ani strony internetowe nie mają do niego dostępu.

## Najczęstsze problemy

- **„Nie znaleziono Node.js” / „brak modułu node:sqlite”** — zainstaluj Node.js 22.13 lub nowszy i otwórz nowe
  okno konsoli.
- **Port 4321 zajęty** — aplikacja już działa w innym oknie albo port zajmuje inny program; zamknij go lub ustaw
  `PORT`.
- **Pusty podgląd mapy** — przeglądarka musi obsługiwać WebGL2 (sprawdź na <https://get.webgl.org/webgl2/>).
- **Linux: przycisk „Wybierz folder” nic nie robi** — doinstaluj `zenity` albo `kdialog`, albo wpisz ścieżkę ręcznie.

## Dokumentacja

- [`CHANGELOG.md`](CHANGELOG.md) — historia zmian,
- [`docs/AUDYT.md`](docs/AUDYT.md) — audyt kodu i zgodności z grą,
- [`docs/PLAN_ROZWOJU.md`](docs/PLAN_ROZWOJU.md) — plan rozwoju i jego realizacja.

## Licencja

Możesz używać programu w dowolnym celu, także komercyjnym. Każda zmodyfikowana wersja i każdy projekt, który
korzysta z kodu lub innych części Soldat Map Studio, musi wymieniać **TryHackX** jako współautora wraz z odnośnikiem
do tego repozytorium. Pełna treść: [`LICENSE`](LICENSE).

Soldat i OpenSoldat należą do ich autorów; ten projekt nie jest z nimi oficjalnie związany.

---

**English summary:** Soldat Map Studio is a local web app (Node.js 22.13+ server + browser UI) for browsing, fixing
and packing large Soldat / OpenSoldat map collections: a searchable index, a game-accurate WebGL2 viewer, the `_f`
(1.7.1 scenery size fix) and `_o` (scenery layer merging) map workshop, server map packs and collection clean-up.
Windows: run `Uruchom Soldat Map Studio.bat`. Linux / macOS: run `./uruchom.sh` (install `zenity` or `kdialog` for
folder pickers). Free to use for any purpose; modified versions and works using any part of it must credit
TryHackX as a co-author — see [`LICENSE`](LICENSE).
