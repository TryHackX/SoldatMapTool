# Soldat Map Studio

A local app for browsing, fixing and packing **Soldat / OpenSoldat** map collections. It runs on your own
computer: a small Node.js server reads the game folder and the interface opens in your browser at
`http://127.0.0.1:4321`. Nothing is sent to the internet.

## Features

- **Map library** — an index of tens of thousands of maps (SQLite), grouped by game mode and prefix (CTF, RSCS,
  Trenchwars, Climb, INF, HTF…), custom prefixes and categories, search with filters
  (`props>300 tex:ananas is:fav -is:dup`), favorites, tags, detection of missing files, CRC32 duplicates and maps
  the game won't load (engine limits).
- **Game-accurate 1:1 preview** (WebGL2) — sceneries, polygons, edges, background, spawn points, flags, bot
  waypoints, colliders; object inspector under the cursor, minimap, "player view" frame, side-by-side comparison of
  two map versions with a slider, full-size map screenshots at 100% (one map or a whole batch).
- **Map workshop**
  - `_f` — fixes scenery sizes stretched by the move to Soldat 1.7.1,
  - `_o` — merges hundreds of sceneries into a few PNG layers (fewer objects, no transparency flickering),
    with a preview before saving and a fidelity report,
  - `_f_o` — both steps at once, also in batch mode; every file that gets overwritten is backed up first,
  - `_a` — an archive: layers merged as in `_o`, and every remaining scenery and the polygon texture copied under
    the map's own name, so other packs or game updates can't change how the map looks.
- **Map editor** — edit any map or start one from a template, on the same game-accurate canvas:
  - polygons (triangle, strip, fan, auto-triangulated shape, freehand), vertex editing with welding and edge
    splitting, all 26 polygon types, vertex colours, light baking and texture coordinates;
  - sceneries: draw them at any size, colorize (hue / saturation / brightness), gradients, random variation and
    depth haze; spawn points, colliders, bot waypoints and map settings;
  - unlimited undo, symmetry with team swap, prefabs, copy / paste between maps, a live map check with one-click
    fixes, a soldier playtest, the command palette (Ctrl+K) and a shortcut list (?);
  - saving checks the engine limits, rebuilds collision data only where the geometry changed, backs up files it
    overwrites and keeps recovery drafts.
- **Server map packs** — ZIP, folder or `.smap`, split by prefix or mode, default game files left out, map list
  for the server, CRC32 manifest, saved presets, letter-case fix for Linux servers, safe extraction of downloaded
  archives.
- **Clean-up** — duplicates, unused sceneries, letter case of file names (Linux). Files are moved to a backup with
  a restore list, never deleted.
- **Two languages** — English (default) and Polish; switch in **Settings** (gear icon) → *Language / Język*.

## Requirements

| | Windows | Linux |
|---|---|---|
| Node.js | **22.13 or newer** (current LTS recommended) | **22.13 or newer** |
| Browser | Edge, Chrome or Firefox with WebGL2 | Chrome, Chromium or Firefox with WebGL2 |
| Game | a Soldat folder with `maps/`, `scenery-gfx/` and `textures/` | the same (Steam via Proton, or OpenSoldat) |
| Extras | — | `zenity` or `kdialog` (folder pickers), `xdg-utils` (opening folders) |
| Disk space | about 250 MB for libraries + map thumbnails | the same |
| Optional | Python 3.10+ with numpy and Pillow — only for the extra `soldat_map_dots.py` tool | the same |

Node.js 22.13 is the first version with the built-in `node:sqlite` module that the map index uses. An internet
connection is needed only once — to install the libraries (`npm install`).

## Windows

1. Install **Node.js LTS** from [nodejs.org](https://nodejs.org) (the `.msi` installer with default options).
2. Get the project: on GitHub **Code → Download ZIP** and unpack it, or:
   ```bash
   git clone https://github.com/TryHackX/SoldatMapTool.git
   ```
3. Double-click **`Start Soldat Map Studio.bat`**. The first run installs the
   libraries and builds the interface (a few minutes), then opens the app. Keep the console window open — closing
   it stops the app.
4. The game folder is detected automatically from all your Steam libraries. If Soldat lives somewhere else, set the
   path in **Settings** (gear icon).

## Linux

1. Install **Node.js 22.13+**. Distribution packages are often older — check `node --version`. The easiest way is
   [nvm](https://github.com/nvm-sh/nvm):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   ```
   ```bash
   nvm install 22
   ```
2. Install the folder pickers and the folder opener (optional — paths can also be typed in):
   ```bash
   sudo apt install zenity xdg-utils
   ```
   Fedora: `sudo dnf install zenity xdg-utils`, Arch: `sudo pacman -S zenity xdg-utils`. On KDE, `kdialog` is
   enough.
3. Get the project and start it:
   ```bash
   git clone https://github.com/TryHackX/SoldatMapTool.git
   ```
   ```bash
   cd SoldatMapTool && ./start.sh
   ```
   The script installs the libraries, builds the interface and opens your browser. Stop it with `Ctrl+C` in the
   terminal. If the file is not executable: `chmod +x start.sh`.
4. Game folder:
   - **Soldat from Steam (Proton)** is detected automatically: `~/.local/share/Steam/steamapps/common/Soldat`,
     `~/.steam/steam/…`, Flatpak Steam and extra libraries listed in `libraryfolders.vdf`.
   - **OpenSoldat** — in **Settings**, choose the folder that contains `maps/`, `scenery-gfx/` and `textures/`.
5. Linux file names are case-sensitive. Maps that spell a scenery name differently from the file on disk are shown
   by the **"Letter case mismatch (Linux)"** filter, and **Clean-up → Letter case (Linux)** renames the files.
   A pack built with **"Fix letter case for Linux servers"** contains every spelling the maps use.

## Manual start (any system)

```bash
npm install
```
```bash
npm run build
```
```bash
npm start
```

Then open `http://127.0.0.1:4321`. Another port: set the `PORT` environment variable (e.g. `PORT=4400 npm start`).

## For developers

| Command | What it does |
|---|---|
| `npm run dev` | server with auto-restart + Vite interface with hot reload (`http://localhost:5173`) |
| `npm test` | automated tests (`node:test`) |
| `npm run typecheck` | TypeScript type check |
| `npm run test:pms` | reads every map in the game folder (parser test on a real collection) |

Layout: server in `src/server` (Express 5, `node:sqlite`, `sharp`), interface in `src/client` (React 19, Vite,
Tailwind, WebGL2), shared code in `src/shared` (`.pms` parser, API types). Texts are written in English in the code;
Polish translations live in `src/client/i18n/pl/` and `src/server/i18nPl.ts`. Compatibility with the game is checked
directly against the OpenSoldat sources.

## Extra tool: CTF reachability template (optional, Python)

`soldat_map_dots.py` is a separate command-line script — the app does not need it. It renders a `.pms` map as a
clean template image and marks with dots the places players can reach from the Alpha spawns (red), the Bravo spawns
(blue) or both (purple), taking gravity, platforms and the map's jet amount into account. Handy for planning and
checking CTF maps.

It needs Python 3.10 or newer and two libraries:

```bash
pip install numpy pillow
```

Usage:

```bash
python soldat_map_dots.py path/to/ctf_Ash.pms -o ctf_Ash_dots.png
```

Options: `--step` (dot spacing in px, default 5), `--width` (image width, default 1920), `--dot-radius`,
`--clearance` (distance from walls) and `--no-dots` (template only); `--help` lists them all. On Linux use
`python3`; if `pip` refuses to install into the system Python, install `python3-numpy` and `python3-pil` from your
distribution or use a virtual environment.

## Where the data lives

- `data/` — settings (`config.json` with this computer's paths), the map index, thumbnails, backups
  (`data/backups/`), the server log (`data/logs/`), editor recovery drafts (`data/editor-drafts/`) and prefabs.
- `exports/` — packs, map screenshots and `_f`/`_o`/`_a` maps when they are not saved into the game folder;
  `exports/edited_maps/` holds editor saves made there.

Both folders are local and never go into the repository. The server listens only on `127.0.0.1` and rejects
requests from other websites, so other computers on the network and web pages cannot reach it.

## Troubleshooting

- **"Node.js not found" / "no node:sqlite module"** — install Node.js 22.13 or newer and open a new console window.
- **Port 4321 is busy** — the app is already running in another window or another program uses the port; close it
  or set `PORT`.
- **Blank map preview** — the browser must support WebGL2 (check at <https://get.webgl.org/webgl2/>).
- **Linux: "Choose folder" does nothing** — install `zenity` or `kdialog`, or type the path in.

## Changelog

Version history: [`CHANGELOG.md`](CHANGELOG.md) (in Polish).

## License

You may use the program for any purpose, including commercial use. Every modified version and every project that
uses code or other parts of Soldat Map Studio must credit **TryHackX** as a co-author, with a link to this
repository. Full text: [`LICENSE`](LICENSE).

Soldat and OpenSoldat belong to their respective authors; this project is not officially affiliated with them.
