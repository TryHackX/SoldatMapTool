# Changelog

## 2.8.2 — 2026-11-24

### Built-in prefixes
- **Custom Prefixes** is now **Manage prefixes**, with a new **Built-in prefixes** section: pick a default group, move
  any of its prefixes to another group or turn it off, and restore one group or all of them.
- The changes apply at once to the sidebar, search and the next start. The JSON export of the rules includes them,
  and older rule files still import.
- Maps without a prefix are labelled "(no prefix)"; when that assignment is turned off, they move to Other.

### Fixed
- Saving or deleting a prefab could wipe the whole prefab library when its file was locked for a moment or damaged.
  Now the save stops with an error, and a damaged file is kept aside as a `.broken` copy.
- A recovered editor draft of a project keeps its link to the package graphics (the autosave dropped it).
- Clean archive:
  - storage left by a job that was interrupted by closing the app (a copy of every map and asset, often several GB,
    and half-written export folders) is freed on the next start;
  - a failed write of the job state (full disk, a file held by a scanner) no longer stops the server;
  - artwork libraries with multi-part RAR sets named `.part01.rar` are read instead of skipped;
  - damaged archive dates far in the future no longer win the choice of map version or break the export;
  - a texture whose edge could not be converted goes to `review/unreferenced/` instead of the playable `textures/`.
- Similar maps: the chosen maps always get their scenery images compared, even in very large libraries.
- Server map packs: the map list and the README name each packed map once when two selected maps share a file name.
- A failed write of the map cache (full disk, locked file) no longer stops the library scan.
- Setting up the local administrator works on drives without hard links (FAT32, exFAT).
- Errors from saving prefix rules are translated in the Polish interface.

### Security
- Requests that other websites trigger through images, scripts or links (marked cross-site by the browser) are
  rejected on `/api`.
- A BMP file that claims a huge image is rejected instead of allocating gigabytes of memory.
- Unexpected server errors return a short JSON message instead of an HTML page with the stack trace.

### Tests
- 357 automated tests (4 new).

## 2.8.1 — 2026-11-24

### Documentation and texts in English
- `CHANGELOG.md` is now in English, for every version.
- The clean archive guide is in English and is now called `CLEAN-ARCHIVE.md`.
- `LICENSE` contains only the English text; the terms have not changed.
- Server and browser console messages, code comments and the `package.json` description are in English.

### Clean archive
- The CSV reports (recovery decisions, missing artwork decisions, map versions and dates) and the legend in
  `missing/<map>.txt` are written in English, like `review.csv`.
- `report/wersje-map.csv` is now `report/map-versions.csv`. Clean copies exported by 2.8.0 still offer their
  versions report for download.

## 2.8.0 — 2026-11-24

### Map generators and climb tools (new)
- **New map → Map from examples:** a separate, editable map built from one to eight local PMS maps (the map selected
  in the library, maps added by name or tag, or a sample of the filtered results).
  - **Compose a new layout** matches openings, joins sections and carries over scenery and material colours;
  - **Reshape the first map** changes the silhouette of the first map but keeps its waypoint links;
  - sky, terrain texture and palette can each come from a different reference.
- **New map → Courses and arenas:** a platform time trial (Relaxed, Time trial or Expert, with a jump profile measured
  on your local climb maps), CTF, Trenchwars and a symmetric arena. The preview draws a simulated run from the Alpha
  spawn to the Bravo flag, timed at 60 ticks per second.
- **New map → Climb tunnel:**
  - your own route from the start to the flag, a ready shape (**Spiral**, **Rolling hills**, tested courses) or
    **Automatic route** built from direction, length, difficulty and seed;
  - width, rock palette, surface mix, obstacles and **cave chambers** (alcoves, galleries, shafts, ice, rest areas)
    change in a live preview;
  - **Pilot run** simulates a soldier and shows the path, the time or the place where the soldier stopped.
- **New map → Timed climb:** a course for a target time such as 1:00. Map Studio tests section variants and reports
  the time of a continuous run from the Alpha spawn to the Bravo flag.
- **Tunnel tool (T)** draws a tunnel directly on the map:
  - for each section: move the bend, change the landing height, bounce and local width, check the section or the
    whole route, and rebuild it;
  - **Compare variants** puts two to four variants side by side between the same gates;
  - **All splits** shows the section times of one continuous run, and **Route time planner** moves the route
    towards a target time;
  - every change is one undo step.
- **Library style and comparison:** gaps, rise, landing width, rebound, exposed edges and jet fuel of your favourite
  maps, a tag or a source, compared by median and outer percentiles.
- **Climb movement library:** five small practice maps with measured approach, speed and landing ranges. After a
  stalled run, **Test targeted repairs from start** measures alternative local fixes on the whole route.
- **Compare with player runs:** record your own runs (game version, time, finish or stop, split times) for exactly
  this route. JSON export and import move them between browsers.
- **Laser Draw → Stroke mode → Platform route** turns a drawn line into a route with jumps, deadly pits, hurt zones
  and bounce pads, in the proportions of your climb profile.
- The simulation is an estimate for the generated route on the way to the flag. Hand-edited routes, flag returns and
  race times still need a playtest in the game.

### Map editor
- **Shapes (B):** box, free outline, ramp and spike. Drag from the base to the tip or between two corners; the
  direction follows the gesture or is picked from a list.
- **Poly Fixer** finds point contacts in normal terrain (corner on edge, corner to corner), shows each one on the map
  with a close-up and overlaps the tip into the neighbouring triangle by up to 2 map units. Repair one contact or all
  of them, with undo (Ctrl+Z). The map check also reports gaps narrower than the soldier.
- **`.smaproj` projects** keep the map together with the drawn route, the generator settings and the jump profile;
  **Export .pms** writes the playable map. Recovery drafts store the same data.
- **Custom tool keys** (F1 or ?): picking a letter that is already taken swaps the keys of both tools, and one button
  restores the defaults. **F4** hides and shows the side panels.
- **Remove unused scenery entries** tidies the scenery table of the map (with undo).
- **Copy Style to Scenery Stamp**, and Backspace removes the last drawing point.
- Optional Font Awesome Solid icons on the tool rail (the icon pack is installed in local administration); the Lucide
  icons stay the default.
- An operation that would exceed the 5000 polygon limit is blocked with a message.
- Saving can limit the length of the file name (see below).

### Map workshop
- **Wall protection:** transparent Deadly strips inside thick walls (by default 1 unit wide, with 2 units of
  clearance from the surface players can reach):
  - for the whole map, only the painted area, or along a strip you draw (Shift + drag gives a straight strip);
  - the pink brush excludes an area, green brings it back, and where strokes overlap the last one wins;
  - the preview shows the textured map and the polygon count (limit 5000), and the result goes to a separate PMS in
    `exports/guarded-maps/`, also for a whole list of maps;
  - optionally restores missing collision sectors inside walls along a manual strip.
- **File name length limit** before `.pms`: 16 characters (compatibility with older server tools), 24 or 32, with a
  **Suggest a short filename** button. It works in the workshop and when saving in the editor.
- Safer `_o` and `_a` saving: Map Studio waits until every layer is uploaded, checks their number against the
  preview, never overwrites a graphic that belongs to another map or was changed by hand, and reports scenery it
  cannot read.

### Library, clean-up and packs
- **Similar maps:** compare selected maps by terrain silhouette and scenery images. It finds work-in-progress
  versions, renamed copies and near duplicates, also against the rest of the library.
- **Verified duplicates** instead of CRC32 alone: a copy must have matching map and artwork content.
- New search filters: `is:draft` (a draft marker in the map name, such as wip, beta or test) and `is:draft-scenery`
  (scenery with a draft name).
- **Clean archive** (Clean-up → Clean archive, also from the map workshop):
  - a verified, portable copy of a whole collection, for example the SMA archive together with the maps installed in
    the game;
  - assets are resolved in their original packages and deduplicated by SHA-256, and PMS references are rewritten;
  - maps with missing files get a `missing/<map>.txt` report; CSV reports cover maps requiring review, map versions
    and dates, and missing artwork decisions;
  - the result goes to `exports/clean-archives/`, and the guide is in `CLEAN-ARCHIVE.md`.
- **Server map packs:**
  - **Remove unused scenery entries from packed maps** cleans the scenery table in the packed PMS copy and skips
    unused graphics;
  - maps with missing files can go into the pack with a list of what is missing in `missing/<map>.txt`;
  - before packing, Map Studio checks that the map has not changed on disk since the last scan.
- Extracting downloaded archives detects different files that would land under the same name, and restores the
  previous files after an error.

### Local administration and startup
- On the first start the browser opens the local administrator setup (a login and a password of at least
  12 characters). The panel is at `/admin` and in Settings, and Map Studio still runs only on this computer.
- `npm start` and the start scripts run the server under a supervisor:
  - **Restart Soldat Map Studio.bat** (Windows) and `restart.sh` (Linux) restart a running server, and the interface
    is rebuilt first when its sources changed;
  - `node scripts/restart.mjs --reset-admin` resets a forgotten administrator account and keeps a backup of the old
    account file.
- Download links for packs and map screenshots are signed with a local key.

### Under the hood
- New libraries `clipper-lib` and `earcut` (polygon operations and triangulation).
- Quality scripts `npm run quality:climb`, `quality:courses` and `quality:history`, plus editor frame timing in
  `scripts/editor-frames.html`.
- 353 automated tests.

## 2.7.0 — 2026-11-02

### Map editor (new)
- **Opening:** an "Edit map" button next to any map, or "New map" from a template (empty, arena, symmetric CTF,
  climb). Editing happens on the same WebGL preview as in the browser: textures, edges and scenery layers look as in
  the game.
- **Polygons:**
  - triangle, strip, fan, shape with automatic triangulation, rectangle and "laser" drawing;
  - vertex editing with welding of shared vertices and edge splitting;
  - all 26 types and bounciness;
  - vertex colours (brush, gradient, eyedropper), light baking, draw order;
  - textures: move, scale and rotate UVs, align to the world.
- **Sceneries:**
  - asset browser: each image once, with an HD badge and a count of its uses in the map, an "In this map" filter,
    "select all", "replace image" and recently placed sceneries;
  - dragging while placing draws the scenery at the chosen size;
  - Alt+wheel scales, Alt+Shift+wheel rotates;
  - size in percent with locked proportions, quick rotations, layers and order.
- **Scenery colorize:**
  - hue, saturation and brightness, a hex colour, 12 presets and recently used colours;
  - shifting the colours of many sceneries at once while keeping the differences between them;
  - a colour and opacity gradient across the selection;
  - random variation (size, angle, colour, opacity, flip) with re-roll;
  - depth haze for the whole map by layer.
- **Other objects:** spawns, flags and bonuses (all types), colliders, bot waypoints with connections and actions,
  and map settings (description, texture, background, jet fuel, grenade and medikit packs, weather, steps).
- **Selection and transforms:**
  - click (clicking again picks the object below), rectangle, lasso and a type filter;
  - select similar (Ctrl+Shift+A) and invert selection (Ctrl+I);
  - move, rotate and scale handles, exact X/Y/W/H fields, alignment;
  - snapping to the grid, vertices, edges and angles.
- **Tools:**
  - symmetry with team swap, prefabs, and copy/paste between maps;
  - image to polygons, an island and terrain shell generator, relief shading;
  - a soldier test with jetpack;
  - command palette (Ctrl+K), shortcut list (?), hiding the panels (Tab).
- **History and drafts:** unlimited undo with a history panel (one drag is one step). A draft is saved in the
  background and can be restored after a crash.
- **Live map check:**
  - engine limits, missing files, CTF rules, spawns inside walls;
  - polygons with collision normals pointing outwards, with a one-click fix;
  - hints (degenerate and duplicate triangles, narrow passages) shown separately and collapsed.
- **Saving:**
  - a new file `<map>_e` or any name: into the game folder, into `exports/edited_maps/` or into your own folder;
  - Ctrl+S saves again to the same place, Ctrl+Shift+S is "Save as";
  - overwriting needs confirmation and makes a backup.
- **File fidelity:** a map opened and saved without changes is identical byte for byte (checked on 3880 maps).
  Collision data (normals, sectors) is recalculated only for changed polygons, and a colour change alone does not
  touch it.

### Preview and performance
- GPU texture memory has a limit and frees the least recently used textures. Browsing hundreds of maps and `_o`
  previews no longer clogs the graphics card.
- "Refresh" reloads the textures, and files that failed to load are tried again.
- The editor loads only when it is first opened, so the app starts with a smaller bundle.

## 2.6.0 — 2026-11-02

### Map archive (`_a`)
- A new option in Optimize Sceneries: "Archive the map (`_a`)". Layers are merged as in `_o`, together with the
  default sceneries. Every scenery that stays a separate prop, and the polygon texture (with its edges from
  `textures/edges`), get a copy named after the map, e.g. `<map>_a_s1.png` and `<map>_a.bmp`. Another pack or a game
  update can no longer replace the files the map uses.
- The copies are byte for byte, so the format, the transparency colour and the HD / classic choice stay unchanged.
- Unused scenery entries are always removed, and missing files are reported in the result.
- With all three layers turned off you get an archive without baking: just the file copies.
- It also works in batch mode for a pack or the current filter, e.g. `tw_`: pick the quality (e.g. 4×) and the tiles
  (2048 px) and you get `*_a.pms` maps.
- A separate folder `exports/archived_maps/` (maps/, scenery-gfx/, textures/). A pack can then be built from the
  `*_a` maps in the Map Pack Builder.
- `_o` and `_a` results are not optimized again, because another bake only blurs them.

### Layer quality
- Auto mode picks 4× when the layers fit in the memory limit (previously at most 3×). The quality descriptions say
  that 4× keeps the most detail of HD sceneries.

### Map view
- **Pinning the player view:** with the tool on, a click leaves a frame on the map.
  - Each frame has a remove button, and the trash button removes them all.
  - Pinned frames and soldiers are remembered separately for each map.
- **"Soldier" tool:** a true-scale figure, about 14 × 24 units, with a skeleton from the OpenSoldat standing
  animation.
  - It also shows the rectangle the soldier uses to collide with polygons: 7 × 14.
  - It stands on the first ground below the cursor; with Shift it stays in the air. A click leaves it on the map.
  - With the player view on, the frame is centred on the soldier, like the camera in the game.
- **Click selection:**
  - Sceneries that are transparent at the clicked point go to the end of the list: empty parts of large images and
    barely visible fog and clouds (below about 16% opacity). A click selects what you actually see.
  - Clicking the same place again, or ↑/↓, picks the object below.
  - The All / Sceneries / Polygons filter decides what a click selects.
  - Polygons no longer drop out of the list when many sceneries lie at the clicked point.

## 2.5.2 — 2026-11-02

### `_o` preview
- When the zoom in the map window exceeds the resolution of the previewed layers (e.g. above about 230% at 2×
  quality), the preview bar explains that the layers are then only magnified and look softer than HD sceneries, and
  gives the game scale ("Game scale" button — 225% at 1080p). Example `tw_Doppleganger`: 83% of the props have HD
  textures (at least 3.5 pixels per world unit), so at 424% the original shows more detail than a 2× layer; at game
  scale the sharpness is 97.4% at 2× and 101.3% at 3×.
- The preview bar shows the quality the preview was built with (previously the one currently selected in the
  window).
- The description of 4096 px tiles says that they use more texture memory: they crop empty space worse, so Auto mode
  may pick a lower quality (`tw_Doppleganger`: 3× with 2048 px tiles, 2× with 4096 px tiles).

## 2.5.1 — 2026-11-02

### Fixed
- **The 1.7.1 fix (`_f`, "fix first, then merge") could break a map**, e.g. the water strips in `ctf_tw_hue` shrank
  into islands, because `water.png` was measured by the default 100×100 `water.bmp`. A size that is not a power of
  two comes from the file the author really used, and the game draws props by the size stored in the map — such
  differences are now shown with an explanation but not marked for repair. The classic 1.7.1 errors stay recommended:
  Power-of-Two sizes from the old MapMaker and HD enlargements from PolyWorks. A 1×1 file (a placeholder for a
  missing image) is never a repair target. Across the whole collection, 77 such cases dropped out of the
  recommendations.
- Optimizing a map that is already an `_o` result again (e.g. `ctf_tw_hue_o` → `ctf_tw_hue_o_f_o`) is blocked with
  an explanation — batch mode already skipped such maps.
- The "Compare" menu is no longer covered by the `_f` / `_o` preview bar.

### Tests
- 62 automated tests (1 new).

## 2.5.0 — 2026-11-01

Two interface languages.

### Languages
- The interface in English (default) and Polish. The choice is in **Settings → Language / Język**; it is remembered,
  and changing it reloads the app. The "Map sources" button in the header is now called "Settings".
- Server messages (errors, warnings, the content of files generated in packs, restore lists) arrive in the language
  chosen in the interface.
- Polish plural forms (1 mapa / 2 mapy / 5 map), and numbers and dates in the format of the chosen language.
- Texts in the code are written in English; the Polish translations live in the dictionaries `src/client/i18n/pl/`
  and `src/server/i18nPl.ts`.
- `README.md` in English, with a description of the extra tool `soldat_map_dots.py` (Python 3.10+, numpy, Pillow);
  the start scripts and `soldat_map_dots.py` print their messages in English.
- English names of the start scripts: `Start Soldat Map Studio.bat` (formerly `Uruchom Soldat Map Studio.bat`) and
  `start.sh`.

### Tests
- 61 automated tests.

## 2.4.0 — 2026-11-01

The first release with a README, a license and Linux support.

### `_o` sharpness
- Layers are slightly sharpened when they are baked, with a strength measured separately for each quality. The game
  filters the merged layer once more when it displays it (original sceneries only once), and that caused a slight
  softening. Sharpness relative to the original on `ctf_tw_hue` (1080p screen): 3× 96.7% → 99.7%,
  4× 95.9% → 99.7%, 2× 91.9% → 99.1%, 1× 79.1% → 97.1%; the average colour difference is the same or smaller.
  Existing `_o` files are worth regenerating.

### Linux and macOS
- The `start.sh` script checks Node.js, installs the libraries, builds the interface and opens the browser.
- Opening folders and the folder and file pickers also work on Linux (`xdg-open`, `zenity` or `kdialog`) and macOS.
  When the dialog program is missing, the app says what to install; the path can also be typed in.
- The game folder is detected from all Steam libraries (Windows; Linux, including Proton and Flatpak; macOS) instead
  of a path written into the code.

### Project
- `README.md` with instructions for Windows and Linux, `LICENSE` (any use; modified versions and projects that use
  parts of the code must credit TryHackX as a co-author), and the license, the author and the required Node version
  (22.13+) in `package.json`.

### Tests
- 59 automated tests (1 new), `npm audit`: 0 vulnerabilities.

## 2.3.2 — 2026-11-01

Scenery sharpness, Auto mode and letter case in file names.

### Fixed
- **Sceneries in Map Studio and in `_o` layers were softer than in the game** (report: the palms on `ctf_tw_hue`).
  OpenSoldat picks mipmaps half a level sharper (`r_mipmapbias` = −0.5), and the Map Studio renderer did not. Now the
  preview, the comparison, screenshots, the fidelity report and `_o` baking draw sceneries the way the game does.
  `_o` sharpness relative to the original on a 1080p screen: 3× 92.7% → 96.7%, 4× 93.2% → 95.9%. Existing `_o`
  files are worth regenerating.
- **Auto picked 1× (blurry in the game) for large maps**, because it computed the layer size from the rectangle
  around the whole scenery group. Now it counts only the tiles that contain something — the same ones Map Studio
  bakes. On the test collection (2370 maps to merge): 3× for 2031 maps (previously 1494), 1× for only 120
  (previously 454). `ctf_tw_hue`: 2× instead of 1×.
- Baking skips empty tiles; a layer that needs more than 500 tiles is rejected with a message (such a map would not
  load in the game anyway).
- The `_o` plan of a map with a prop at invalid coordinates (`ctf_LaaF-Run`, x = −9.2·10¹⁸) hung the server (out of
  memory). Such props are left untouched ("Outside the map").
- Categories in the sidebar: a plain click added an item to the selection instead of selecting it (e.g. the RSCS mode
  and the `tw_` prefix at once, which gave an empty list). Now a click selects only that item, Ctrl+click adds more,
  and selected items from different levels add up.
- The quality descriptions match the measurements: 3× is the sharpest at 1080p, 2× is slightly soft, 4× is for
  1440p and 4K.

### Letter case in file names (Linux)
- A pack built with "Fix letter case for Linux servers" contains a file under every spelling the maps use (e.g.
  `fx_P_cloud5.png` and `fx_p_cloud5.png`). Previously only the first one went in, so some maps on a Linux server
  did not find their scenery.
- "Clean-up" → "Letter case (Linux)": a report of files whose names differ in letter case from the entries in the
  maps, and renaming where all maps spell the file the same way (the list of changes for undoing them is in
  `data/backups/`). A "Fix…" shortcut next to the filter in the sidebar. Maps are not modified.

### Fidelity report
- A new "sharpness" measure. The average pixel difference barely reacts to blurred fine detail, so the report could
  show "Very high" even though the layers were clearly softer.

### Tests
- 58 automated tests (8 new).

## 2.3.1 — 2026-11-01

Closing the gaps left after 2.3.0.

### Security
- Dependencies without known vulnerabilities (`npm audit`: 0): `adm-zip` 0.6.1, `sharp` 0.35.5, `archiver` 8.0.0,
  `minimatch` 11 (through `overrides`).
- Safe extraction of map packs from the internet: the whole archive is validated before anything is written
  (zip-slip, links, encryption, unsupported compression, zip bombs), and it is extracted into a temporary folder.

### Fixed (code review of 2.3.0)
- After switching maps, the minimap was empty or showed the previous map.
- A resumed screenshot series starts from the right map and does not change the settings (previously it forced
  "skip existing").
- The star in a filtered list no longer reloads the map or clears the rows.
- "Clean-up": before a duplicate is moved, the disk is checked (the copy that stays must exist and be identical), the
  unused sceneries report works on the current index, and only one operation runs at a time.
- The `_f_o` name of long map names no longer loses `_f` and never repeats the source name; saving `_o` is rejected
  when the map changed after the plan was prepared.
- The CRC32 manifest matches the pack content, the server log is written immediately, damaged settings files are
  not overwritten, plus fixes in tags, search, the "Compare" menu and the error handling of dialogs.
- The renderer no longer deletes objects of a lost WebGL context (warnings after a graphics card reset).

### Tests
- 50 automated tests (18 new).

## 2.3.0 — 2026-11-01

The second round of improvements.

### Map workshop
- "Fix the 1.7.1 scenery sizes first, then merge": `_f` and `_o` in one click (result `<map>_f_o`), also in batch
  mode.
- "Now / after" thumbnails in the `_f` diagnosis table.
- The overwrite confirmation mentions the backup (previously it wrongly warned of a "permanent" deletion).

### Map preview
- Outlines of sceneries with 1.7.1 problems on the map (the "1.7.1 issues" button).
- A "Player view" frame (480 units high, with a choice of screen aspect ratio).
- A minimap with the view rectangle — a click moves the camera.
- Comparison of two versions of a map with a slider (original / `_f` / `_o` / change preview).

### Library
- Search with filters: `props>300 tex:ananas prefix:ctf_cs_ is:fav -is:dup tag:tournament`.
- Favorite maps and custom tags.
- "Clean-up": a CRC32 duplicate manager and an unused sceneries report — files are moved to a backup, never deleted.

### Packs and screenshots
- Presets for pack options.
- A manifest with the CRC32 checksums of the maps in the pack.
- Resuming an interrupted screenshot series.

### Engineering
- Local fonts (works offline, without Google Fonts).
- A server log in `data/logs/`.
- Dialogs load when they are first opened, so the startup bundle is smaller.
- 32 automated tests.

## 2.2.0 — 2026-11-01

A full code audit in two phases.

### Fixed — the most important
- **Blurry, paler sceneries in `_o`** (the icicles on `ctf_cs_office2`): layers were baked at 1 texel per world unit,
  while the game shows about 2.25 px per unit. A new default quality "Auto" (up to 3×), composition in RGBA16F and
  seamless joins between tiles. Existing old `_o` files are worth regenerating.
- Fixing a map whose name ends in `_f` could **overwrite the original**; `_f`/`_o` overwrote existing files without
  asking.
- Protection against websites that reach the local server (DNS rebinding).
- The cp1250 encoding of scenery names was incomplete — characters outside the Polish alphabet were lost on saving.
- The index scan could "hang" on small collections; new `_f`/`_o` maps did not appear in the list.
- The workshop could apply the `_f` fixes of the previous map to the newly selected one.
- Extracting a pack overwrote the server's `mapslist.txt` (now `mapslist_<pack>.txt`).
- An empty screenshot after a lost WebGL context, and silent errors in batch modes and when adding to a pack.

### New features
- A preview of the `_o` result in the map window before saving, plus a fidelity report at 1080p screen scale.
- Batch `_o` optimization for the basket or the filter.
- Backups of every overwritten file in `data/backups/`.
- An object inspector under the cursor (sceneries, polygons).
- Detection of maps that exceed the engine limits (500 props, 5000 polygons…) and of unreadable files — the "Won't
  load in game" category.
- Filters, view, layers, panels and the basket are remembered between runs; collapsible side panels.

### Performance
- A memory budget for decoded textures (384 MB), without needless copies in `<canvas>`.
- Faster hit testing under the cursor, fewer list renders, streamed reading of the SQLite cache.
- A cache of converted images on the server, asynchronous pack copying, and the `_f` scanner no longer blocks the
  server.

### Engineering
- `npm test` (22 tests) and `npm run typecheck`.
- The start script checks the Node version and rebuilds the interface by itself after an update.
- A single app version: 2.2.0.
