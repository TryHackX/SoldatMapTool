# Soldat Map Studio

A local app for browsing, fixing and packing **Soldat / OpenSoldat** map collections. It runs on your own
computer: a small Node.js server reads the game folder and the interface opens in your browser at
`http://127.0.0.1:4321`. Nothing is sent to the internet.

## Features

- **Map library** — an index of tens of thousands of maps (SQLite), grouped by game mode and prefix (CTF, RSCS,
  Trenchwars, Climb, INF, HTF…), custom prefixes and categories, search with filters
  (`props>300 tex:ananas is:fav -is:dup`), favorites, tags, detection of missing files, CRC32 duplicates and maps
  the game won't load (engine limits).
- **Similar maps** — compare selected maps by terrain silhouette and scenery images to find work-in-progress
  copies, renamed versions and near duplicates.
- **Game-accurate 1:1 preview** (WebGL2) — sceneries, polygons, edges, background, spawn points, flags, bot
  waypoints, colliders; object inspector under the cursor, minimap, "player view" frame, side-by-side comparison of
  two map versions with a slider, full-size map screenshots at 100% (one map or a whole batch).
- **Map workshop**
  - `_f` — fixes scenery sizes stretched by the move to Soldat 1.7.1,
  - `_o` — merges hundreds of sceneries into a few PNG layers (fewer objects, no transparency flickering),
    with a preview before saving and a fidelity report,
  - `_f_o` — both steps at once, also in batch mode; every file that gets overwritten is backed up first,
  - `_a` — an archive: layers merged as in `_o`, and every remaining scenery and the polygon texture copied under
    the map's own name, so other packs or game updates can't change how the map looks,
  - **Wall protection** — traces long invisible Deadly strips through solid terrain (by default 1 unit wide with
    2 units of clearance) for the whole map, only painted areas, or along a strip you draw. Paint an area pink to
    exclude it and green to restore it; the preview shows the textured map and the triangle count before a separate
    PMS is exported. Optionally restores collision entries that a legacy wall left out of its sector.
- **Map editor** — edit any map or start one from a template, on the same game-accurate canvas:
  - polygons (triangle, strip, fan, auto-triangulated shape, freehand, and **Shapes** for boxes, outlines, ramps
    and spikes), vertex editing with welding and edge splitting, all 26 polygon types, vertex colours, light baking
    and texture coordinates;
  - sceneries: draw them at any size, colorize (hue / saturation / brightness), gradients, random variation and
    depth haze; spawn points, colliders, bot waypoints and map settings;
  - unlimited undo, symmetry with team swap, prefabs, copy / paste between maps, a live map check with one-click
    fixes, **Poly Fixer** for touching polygon tips, a soldier playtest, the command palette (Ctrl+K);
  - tool keys you can reassign (**F1** or **?**; picking a taken letter swaps the two tools), **F4** hides the side
    panels;
  - **projects** (`.smaproj`) keep the map together with a drawn route, generator settings and the jump profile;
    **Export .pms** writes the playable map;
  - saving checks the engine limits, rebuilds collision data only where the geometry changed, backs up files it
    overwrites and keeps recovery drafts.
- **Map generators and climb tools** — new maps from local example maps, climb tunnels, timed climbs, courses and
  arenas, with a simulated soldier that checks the route from the start to the flag (see below).
- **Server map packs** — ZIP, folder or `.smap`, split by prefix or mode, default game files left out, map list
  for the server, CRC32 manifest, saved presets, letter-case fix for Linux servers, safe extraction of downloaded
  archives.
- **Clean-up** — duplicates, unused sceneries, letter case of file names (Linux). Files are moved to a backup with
  a restore list, never deleted.
- **Clean archive** — writes a verified, portable copy of a whole map collection (for example the SMA archive plus
  the maps installed in the game): assets are resolved in their original package, deduplicated by SHA-256, PMS
  references rewritten, and maps with missing files get a `missing/<map>.txt` report.
  Guide: [clean archive and map comparison](CLEAN-ARCHIVE.md).
- **Two languages** — English (default) and Polish; switch in **Settings** (gear icon) → *Language / Język*.

## Map generators and climb tools

- **New map → Map from examples** builds a separate, editable map from one to eight local PMS maps: the map selected
  in the library, maps added by name or tag, or a sample of the filtered results. **Compose a new layout** matches
  openings, joins sections and carries over scenery and material colours; **Reshape the first map** varies its
  silhouette and keeps its waypoint links. Sky, terrain texture and palette can each come from a different
  reference.
- **New map → Courses and arenas** — platform time trial (Relaxed, Time trial or Expert, with a profile measured on
  your local maps), CTF, Trenchwars and a symmetric arena. The preview draws a simulated run from the Alpha spawn to
  the Bravo flag, with its time at 60 ticks per second.
- **New map → Climb tunnel** — draw your own route from the start to the flag, start from **Spiral**, **Rolling
  hills** or a tested course, or let **Automatic route** build one from direction, length, difficulty and seed.
  Width, rock palette, surface densities, obstacles and **cave chambers** (alcoves, galleries, shafts, ice, rest
  areas) are adjustable while you watch the preview; **Pilot run** simulates a soldier and shows the path, the
  finish time or where it stopped.
- **New map → Timed climb** builds a course for a target time such as **1:00**, tests section variants and
  reports the time of a continuous run from the Alpha spawn to the Bravo flag.
- **Tunnel (T)** in the editor draws a tunnel directly on a map. For each section you can move its bend, change the
  landing height, bounce and local width, check the section or the whole route, rebuild it, or **compare two to four
  variants** between the same gates. **All splits** shows section times of one continuous run, and **Route time
  planner** moves a route towards a target time. Every change is one undo step.
- **Library style and comparison** — gaps, rise, landing width, rebound, exposed edges and jet fuel of your
  favourites, a tag or a source, compared by median and outer percentiles.
- **Climb movement library** — five small practice maps with measured approach, speed and landing ranges;
  after a stalled run, **Test targeted repairs from start** measures alternative local fixes on the whole route.
- **Compare with player runs** — record your own runs (game version, time, finish or stop, split times) against
  the exact route; JSON export / import moves them between browsers.
- **Polygon: Laser Draw → Stroke mode** turns a drawn line into a platform route with jumps, deadly pits, hurt
  zones and bounce pads weighted by your climb profile.

The simulation is an estimate for the generated route on the way to the flag; edited courses, flag returns and race
times in the game still need a playtest.

## Local administration

On the first start the browser opens the local administrator setup: choose a login and a password of at least
12 characters. Administration is available at `/admin` and from **Settings**; everything still runs only on this
computer (loopback). In **Settings → Local administration** you can install a Font Awesome web ZIP (with
`webfonts/fa-solid-900.woff2`) whose Solid icons are then used by the editor tool rail.

To restart a running server, use **Restart Soldat Map Studio.bat** (Windows) or `bash restart.sh` (Linux) with the
same `PORT`. A lost administrator login can be reset locally with `node scripts/restart.mjs --reset-admin` (type
`RESET` to confirm): the old account file is backed up and the setup address is printed. A restart ends
administrator sessions.

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

Then open `http://127.0.0.1:4321` (on the first start, `http://127.0.0.1:4321/admin` sets up the local
administrator). Another port: set the `PORT` environment variable (e.g. `PORT=4400 npm start`). `npm start` runs the
server under a small supervisor: **Restart Soldat Map Studio** works only with it (not with `npm run dev`), and the
interface is rebuilt before the restart when its sources changed.

## For developers

| Command | What it does |
|---|---|
| `npm run dev` | server with auto-restart + Vite interface with hot reload (`http://localhost:5173`) |
| `npm test` | automated tests (`node:test`) |
| `npm run quality:climb` | six tunnel fixtures, PMS round-trips, geometry, times, pilot traces and splits in `exports/climb-quality.json` |
| `npm run quality:courses` | seeded checks for platform, CTF, trench and symmetric courses |
| `npm run quality:history` | 100 edits, undo and redo at 500, 2500 and 5000 polygons with retained heap and p95 commit time |
| `/scripts/editor-frames.html` on the local Vite dev server | 60 measured frames per size with the WebGL viewport and editor overlay. Keep the tab in the foreground to measure refresh cadence. |
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
  (`data/backups/`), the server log (`data/logs/`), editor recovery drafts (`data/editor-drafts/`), prefabs, the
  local administrator account (`data/admin/`) and short-lived restart tokens (`data/runtime/`).
- `exports/` — packs, map screenshots and `_f`/`_o`/`_a` maps when they are not saved into the game folder;
  `exports/edited_maps/` holds editor saves made there, `exports/guarded-maps/` the wall protection maps and
  `exports/clean-archives/` the clean archives.

Both folders are local and never go into the repository. The server listens only on `127.0.0.1` and rejects
requests from other websites, so other computers on the network and web pages cannot reach it.

## Troubleshooting

- **"Node.js not found" / "no node:sqlite module"** — install Node.js 22.13 or newer and open a new console window.
- **Port 4321 is busy** — the app is already running in another window or another program uses the port; close it
  or set `PORT`.
- **Blank map preview** — the browser must support WebGL2 (check at <https://get.webgl.org/webgl2/>).
- **Linux: "Choose folder" does nothing** — install `zenity` or `kdialog`, or type the path in.

## Changelog

Version history: [`CHANGELOG.md`](CHANGELOG.md).

## License

You may use the program for any purpose, including commercial use. Every modified version and every project that
uses code or other parts of Soldat Map Studio must credit **TryHackX** as a co-author, with a link to this
repository. Full text: [`LICENSE`](LICENSE).

Soldat and OpenSoldat belong to their respective authors; this project is not officially affiliated with them.
