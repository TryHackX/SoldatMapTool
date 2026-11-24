# Clean Soldat map archive

## One pack from SMA and the maps installed in the game

1. In the Map Studio settings, check the **Main Soldat / OpenSoldat installation folder**. Then open **Clean-up → Clean archive** and choose the main folder of the SMA archive as the source. Keep **Loose maps and assets**, **Compressed packages**, **Use the SMA collection index when available** and **Append a content hash to asset names** selected.
2. Select **Merge maps from my Soldat installation** and **Include maps with missing artwork and write missing/<map>.txt**. Map Studio also reads the `maps` folder of the installation and, if it exists, `downloads/maps`. Use **Additional artwork libraries** to point to more places with assets.
3. Choose **Analyse archive**. After the analysis, the **Maps for export** count also includes the **Exported maps with a missing file report**. Map Studio removes unused scenery entries, matches file names with the references in the PMS and writes the `.pms` extension. Identical results share a file. Different versions with the same name can get separate names.
4. Choose **Export clean copy → Download game ZIP**. If you still want to fix something in Map Studio, click **Add exported maps to the library** and pick the added folder as a source. When the fixed maps are packed, Map Studio checks their dependencies again. The report keeps the original names of files that are still missing.
5. To replace the library in the game, move the current `maps` and, if present, `downloads/maps` to a backup outside the installation. Extract the ZIP into the folder that contains `soldat.exe`. It should then contain `maps`, `scenery-gfx`, `textures` and, for incomplete maps, `missing`. Other game assets also use the graphics folders, so merge them with the content of the ZIP and keep the existing files.

In the merged library, the plain PMS name goes first to the newest dated version. Map Studio reads the file date in the installation and the entry date in the original ZIPs, nested ones included, once the SHA-256 of the map is confirmed. When the dates are equal, the copy from the game wins, then RSCS. Choose **Map versions and dates (CSV)** to compare variants with the same name. The file `report/map-versions.csv` lists the dates, the names after export and the paths to the source releases. An empty date means there is no confirmed file date. A file date is a hint, especially after maps were copied by hand.

The version is chosen by the dates of the source files before cleaning. The finished PMS keeps the date chosen from its sources. When there is no confirmed date, the report leaves the field empty and the file gets the technical date of 1 January 1980, the earliest date ZIP supports. This way the next merge correctly treats such a file as undated.

Every exported map with missing files has one `missing/<final_map_name>.txt` with `Scenery:`, `Textures:` and `Edges:` sections. An entry `old_name -> new_name` shows the name to look for and the name to save the replacement under. The target folders are `scenery-gfx`, `textures` and `textures/edges`, respectively. Terrain edges are optional. Map Studio reports a problem with a detected edge, e.g. a damaged image. The PMS originals whose structure could not be repaired are in `review/maps` next to the export.

## Finding missing artwork in other packs

In **Clean-up → Clean archive**, choose the source archive. In **Additional artwork libraries**, enter the paths to Soldat installation folders, map folders or single ZIP and RAR packs, one per line. Run the analysis and then **Export clean copy**. The listed libraries provide evidence and the graphics that are needed. Whether the maps from the active installation are added is decided by **Merge maps from my Soldat installation**.

If an author or a server released a set of several maps with shared graphics, point directly to the file of that pack. Map Studio can confirm a missing asset when it finds an identical source PMS in `maps` and the required graphic in the right folder of the same release. It also checks the sizes stored in the map, the available texture edges and conflicting versions.

Map Studio can link an image to a map through the original release that contains the same source PMS. For sceneries it also uses the date written by the author, the real dimensions and the origin of the file. With an old encoding or a short DOS name, it checks the possible full names and content checksums. The report records which file justified the match. When several different images match, the report lists the disputed asset if maps with missing artwork are included; otherwise the map goes to the review queue.

After analysing the same archive again, choose **Missing artwork decisions (CSV)**. The report has one row for each occurrence from the previous release that lacked a texture or a scenery. The **Verification or remaining cause** column also shows partial matches, when another asset is still missing. **Output file** leads to the finished PMS.

## First run

1. In Map Studio, open **Clean-up → Clean archive**. The same panel is available from the map workshop.
2. Choose the main folder of the collection. For SMA, pick the folder that contains both the packs and the extracted `Maps` folder. Select **Loose maps and assets**, **Compressed packages** and **Use the SMA collection index when available**. Click **Analyse archive**. You can close the panel and come back to it.
3. Check the number of finished maps and the number of occurrences that require review. **Maps requiring review (CSV)** contains the causes and the candidates from other packs. An item matched by its name alone needs a look. The full JSON report contains the sources, the output names and the SHA-256 checksums.
4. Click **Export clean copy**. After the verification, Map Studio shows the full path. Each job has its own folder in `exports/clean-archives`. **Add exported maps to the library** registers only the **`maps`** subfolder as an extra source. You can also do that in the settings. Map Studio recognizes the neighbouring `scenery-gfx` and `textures` folders.

By default, a new job appends a hash of the content to asset names. This matters after you move maps into an existing installation, where e.g. `tree.png` can take the place of the archived `tree.bmp`. The name of a texture also takes the identity of its edges into account. For a separate data folder you can turn this option off and keep shorter names. Maps keep readable names either way. When you copy maps into an existing installation by hand, check whether the PMS name is already taken. Adding the folder as a source in Map Studio lets you browse the maps without copying anything into the game.

The game folder in the finished copy consists of `maps/`, `scenery-gfx/` and `textures/`, together with `textures/edges/` if a map has its own edges. `review/maps/` keeps the problematic originals, marked with a checksum. `review/unreferenced/` holds unassigned assets from the game folders. `report/` holds the plan, the CSV files and the list of file origins. Preview folders, text files and files in the older `.pmp` format stay in the source.

## How the copy is made

The target is PMS files and graphics supported by the Soldat 1.7.x line. The move to HD graphics in that version covered sceneries, among other things. That is why both the image bytes and the dimensions stored in the PMS matter when you restore the look of an old map. [Soldat 1.7.1 release notes](https://www.soldat.pl/en/post/soldat-1_7_1-release)

| Stage | What happens | Acceptance condition |
| --- | --- | --- |
| Inventory | Loose files, packs and their contents are read, keeping the original path and spelling. In the SMA index, the same physical graphic can stand for many packs. | Material from the index has a matching size and SHA-256. Missing archive parts, unsupported formats and read limits go into the report. |
| Dependencies | Map Studio looks for the texture, the active sceneries and matching edges in the context of the pack. It takes into account the names stored in the PMS, letter case variants, PNG replacements and the standard files available in the configured installation. | Specific content can be named for every required graphic. An ambiguous choice stays on the review list. |
| Names and fixes | Map Studio assigns portable, short, lowercase names and rewrites the PMS references with the exact spelling. Every map gets the `.pms` extension. Recognized wrong scenery dimensions are fixed, dead definitions are removed and their indexes recalculated. | Identical graphics with different names can share one file in a game folder. Different bytes get separate names. Two textures with the same bytes may need separate names if their edges differ in content. |
| Map deduplication | Map SHA-256 checksums are compared after the right assets are assigned and the references written. The report keeps all occurrences. | Two identical source PMS files with different pack graphics can produce two correct maps. A shared output file requires identical bytes of the final PMS. |
| Verification | The written files are read again, and checksums, header validity and the exact spelling of file references in the export are verified. | The output folder is released once verification passes. File verification does not include a playthrough or starting the game. |

A known modification time helps give the shorter name to one of the versions. The choice of a graphic is decided by its link to the pack of the map. The index of this collection does not contain the original dates of all pack members, so without dates the choice of name is repeatable by path.

The analysis reads PNG, JPEG and GIF image data and checks that the pixel data and the encoding of older BMP and TGA files are complete. For a damaged BMP or PNG it can also find a complete file under another name. Recovery requires one unambiguous content match and agreement of all preserved bytes. If a damaged graphic is used on a map and there is no confirmed copy, the map goes to `review/maps/`.

Collision sectors in a PMS point to polygons numbered from 1. For a reference out of range, Map Studio rebuilds the grid from the geometry of the map, keeps its division and records the repair in the report. This way you can find every map on which the collision lookup changed. [Sector reading in the OpenSoldat engine](https://github.com/opensoldat/opensoldat/blob/develop/shared/PolyMap.pas#L195-L245)

For bot paths, Map Studio clears a reference to a point that does not exist, and keeps its slot in the table and the other connections. If a damaged counter makes a reliable reading of this table impossible, or a scenery in use has an invalid position, rotation or scale, the cause goes into the manual review report.

### When to read the raw packs

The SMA index describes the collection as it was when it was gathered. Map Studio checks the material the index points to and looks through additional files in the source. To examine only the current packs again, choose **Compressed packages** and turn off **Loose maps and assets** and the index. This helps after the content of an old pack changed or when the checksum of a file disagrees with the index.

ZIP and ZIP64 are read without an external extractor. Raw RAR and 7z may need Python 3 and the system libarchive library, and a multi-part RAR also needs UnRAR. A missing reader or archive part shows up in the report. A complete extracted collection with the SMA index lets Map Studio rebuild the origin of files without extracting those packs again.

### How to recover another map from the report

1. Open `report/review.csv`. The **Blocked original** and **Reason for review** columns point to the pack, the map and the problem. **Review copy after export** points to the kept original. One map can have several rows with different candidates.
2. If **Canonical map after export** contains a name, open that map in Map Studio. Check **Candidate basis**. A matching checksum of the original PMS confirms identical bytes of the source map, but the graphics in two packs can still differ. A match by name or size requires comparing the look.
3. If you found the right missing file, copy the PMS and the graphics of that pack into a separate working folder with `maps`, `scenery-gfx` and `textures` subfolders. Add the recovered file to the right subfolder under the name the map requires. Run **Clean archive** on that folder. This way you can check a single repair without processing the whole collection again.

## Finding draft versions and similar maps

In the main library, select maps or choose a prefix or a filter. Open **Find similar to selected**. In the map workshop, the button sits next to the **Wall protection** tab. Choose the scope, the similarity threshold and the criteria you care about. Examples:

- **Different name, similar map.** Turn on **Terrain shape** and turn off **Map names**. Compare the silhouettes of both results. The terrain mask takes the relative layout of the polygons into account, so moving the whole map does not rule out similarity.
- **Replaced or renamed decoration.** Choose **Scenery files** and the **Scenery image appearance** criterion. You get pairs of specific graphics, also inside one selected map. You can compare the names separately. With **Map pairs**, the scenery criterion rates how similar the sets of decorations on two maps are.
- **Copies outside the selected group.** For the selected maps, turn on **Also compare with the rest of the library**. Each result pair will include at least one item from the selection.
- **Draft versions.** In the results you can show all pairs, only pairs with a draft name, or hide them (**Show all pairs**, **Only pairs with a draft marker**, **Hide pairs with a draft marker**). With **Scenery files**, this choice applies to individual graphics. In the library, type `is:draft` for maps or `is:draft-scenery` for maps that use scenery with a draft name. A minus excludes those items, for example `-is:draft -is:draft-scenery`. Markers such as `beta`, `wip` and `v2` are only a hint from the name: the author may have published a final version under such a name.

For large sets, the tool picks candidates before the exact comparison and shows up to 500 of the highest-ranked pairs. With **Map pairs**, the scenery appearance criterion considers at most the 48 most used sceneries of a map. The percentage score is for looking at similar versions. Whether a file is merged during cleaning is decided by its content.

## Removing dead scenery entries

In an open map, choose **Checks → Remove unused scenery entries**. The command shows the number of removed definitions and can be undone. In the Map Pack Builder, turn on **Remove unused scenery entries from packed maps**. The option works when exporting to a folder, ZIP, SMAP and packs split into groups. Only the PMS inside the pack is changed; the original file on disk stays as it was. The CRC manifest covers the bytes that were actually packed.
