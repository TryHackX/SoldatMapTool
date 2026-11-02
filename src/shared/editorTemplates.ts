import { compileMapSectors, computeMapBounds, createPolygonFromPoints } from './pmsCompiler';
import { PmsMapData, PmsPolygon, PmsSpawnpoint, soldatCrc32, serializePms } from './pmsParser';
import { RgbaColor } from './soldatConstants';

export type EditorTemplateId = 'empty' | 'arena' | 'ctf_symmetric' | 'climb';

export interface EditorMapTemplateMeta {
  id: EditorTemplateId;
  nameEn: string;
  descriptionEn: string;
  suggestedPrefix: string;
  defaultBaseName: string;
}

export const EDITOR_MAP_TEMPLATES: ReadonlyArray<EditorMapTemplateMeta> = [
  {
    id: 'empty',
    nameEn: 'Blank Map',
    descriptionEn: 'Clean empty canvas with default sky gradient and texture, ready to build from scratch.',
    suggestedPrefix: 'dm_',
    defaultBaseName: 'dm_untitled',
  },
  {
    id: 'arena',
    nameEn: 'Arena / Deathmatch Starter',
    descriptionEn: 'Enclosed starter arena with floor, side walls, central platform, and general spawn points.',
    suggestedPrefix: 'dm_',
    defaultBaseName: 'dm_arena_new',
  },
  {
    id: 'ctf_symmetric',
    nameEn: 'CTF Symmetric Starter',
    descriptionEn: 'Horizontally mirrored Alpha & Bravo bases around X = 0 with both team flags and spawns.',
    suggestedPrefix: 'ctf_',
    defaultBaseName: 'ctf_newmap',
  },
  {
    id: 'climb',
    nameEn: 'Climb / KZ Starter',
    descriptionEn: 'Vertical / horizontal movement starter with normal, ice, and bouncy platforms.',
    suggestedPrefix: 'kz_',
    defaultBaseName: 'kz_climb_new',
  },
];

function makeQuadPolys(
  left: number,
  top: number,
  right: number,
  bottom: number,
  options?: {
    polyType?: number;
    bounciness?: number;
    topColor?: RgbaColor;
    bottomColor?: RgbaColor;
  }
): [PmsPolygon, PmsPolygon] {
  const tc = options?.topColor ?? { r: 215, g: 222, b: 230, a: 255 };
  const bc = options?.bottomColor ?? { r: 115, g: 125, b: 140, a: 255 };
  const p1 = createPolygonFromPoints(
    [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
    ],
    { polyType: options?.polyType ?? 0, bounciness: options?.bounciness ?? 1, color: tc }
  );
  p1.vertices[0].color = { ...tc };
  p1.vertices[1].color = { ...tc };
  p1.vertices[2].color = { ...bc };

  const p2 = createPolygonFromPoints(
    [
      { x: left, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    { polyType: options?.polyType ?? 0, bounciness: options?.bounciness ?? 1, color: bc }
  );
  p2.vertices[0].color = { ...tc };
  p2.vertices[1].color = { ...bc };
  p2.vertices[2].color = { ...bc };

  return [p1, p2];
}

export function createMapFromTemplate(
  templateId: EditorTemplateId,
  options?: { title?: string; texture?: string }
): PmsMapData {
  const title = (options?.title ?? 'Created in Soldat Map Studio').slice(0, 38);
  const texture = (options?.texture ?? 'default.bmp').slice(0, 24);

  const polygons: PmsPolygon[] = [];
  const spawnpoints: PmsSpawnpoint[] = [];
  let bgColorTop: RgbaColor = { r: 24, g: 38, b: 64, a: 255 };
  let bgColorBtm: RgbaColor = { r: 86, g: 118, b: 158, a: 255 };
  let startJet = 120;

  const pushSpawn = (x: number, y: number, team: number) => {
    spawnpoints.push({
      index: spawnpoints.length,
      active: true,
      x: Math.round(x),
      y: Math.round(y),
      team,
    });
  };

  if (templateId === 'arena') {
    polygons.push(...makeQuadPolys(-384, 96, 384, 160));
    polygons.push(...makeQuadPolys(-448, -192, -384, 160));
    polygons.push(...makeQuadPolys(384, -192, 448, 160));
    polygons.push(...makeQuadPolys(-128, -16, 128, 16));
    pushSpawn(-240, 64, 0);
    pushSpawn(240, 64, 0);
    pushSpawn(0, -48, 0);
    pushSpawn(0, 64, 7); // Grenade kit
    pushSpawn(0, -48, 8); // Medikit
  } else if (templateId === 'ctf_symmetric') {
    bgColorTop = { r: 22, g: 30, b: 46, a: 255 };
    bgColorBtm = { r: 74, g: 98, b: 132, a: 255 };
    startJet = 140;
    // Center bridge + lower mid
    polygons.push(...makeQuadPolys(-160, 32, 160, 64));
    polygons.push(...makeQuadPolys(-640, 128, 640, 192));
    // Alpha (left) & Bravo (right) bases — symmetric around X = 0
    polygons.push(
      ...makeQuadPolys(-640, 32, -320, 128, {
        topColor: { r: 235, g: 195, b: 195, a: 255 },
        bottomColor: { r: 140, g: 95, b: 95, a: 255 },
      })
    );
    polygons.push(
      ...makeQuadPolys(320, 32, 640, 128, {
        topColor: { r: 195, g: 210, b: 240, a: 255 },
        bottomColor: { r: 95, g: 115, b: 150, a: 255 },
      })
    );
    // Outer walls
    polygons.push(...makeQuadPolys(-704, -224, -640, 192));
    polygons.push(...makeQuadPolys(640, -224, 704, 192));

    // Flags (5 = Alpha Red, 6 = Bravo Blue)
    pushSpawn(-480, 16, 5);
    pushSpawn(480, 16, 6);
    // Team spawns (1 = Alpha, 2 = Bravo)
    pushSpawn(-560, 16, 1);
    pushSpawn(-400, 16, 1);
    pushSpawn(560, 16, 2);
    pushSpawn(400, 16, 2);
    // Mid kits
    pushSpawn(-96, 112, 8);
    pushSpawn(96, 112, 8);
    pushSpawn(0, 16, 7);
  } else if (templateId === 'climb') {
    bgColorTop = { r: 16, g: 36, b: 44, a: 255 };
    bgColorBtm = { r: 48, g: 96, b: 112, a: 255 };
    startJet = 60;
    // Start platform
    polygons.push(...makeQuadPolys(-384, 96, -192, 144));
    // Ice slide platform (polyType = 4)
    polygons.push(
      ...makeQuadPolys(-96, 64, 96, 96, {
        polyType: 4,
        topColor: { r: 180, g: 245, b: 255, a: 255 },
        bottomColor: { r: 90, g: 170, b: 200, a: 255 },
      })
    );
    // Bouncy pad (polyType = 18, bounciness = 1.6)
    polygons.push(
      ...makeQuadPolys(160, 96, 256, 128, {
        polyType: 18,
        bounciness: 1.6,
        topColor: { r: 250, g: 160, b: 215, a: 255 },
        bottomColor: { r: 180, g: 80, b: 140, a: 255 },
      })
    );
    // Upper finish ledge
    polygons.push(...makeQuadPolys(320, -64, 512, -16));
    // Deadly pit floor below (polyType = 5)
    polygons.push(
      ...makeQuadPolys(-448, 256, 576, 288, {
        polyType: 5,
        topColor: { r: 220, g: 60, b: 60, a: 255 },
        bottomColor: { r: 110, g: 20, b: 20, a: 255 },
      })
    );
    pushSpawn(-288, 72, 1);
    pushSpawn(416, -80, 6);
  }

  const sectorInfo = compileMapSectors(polygons, { sectorsNum: 25 });
  const bounds = computeMapBounds({ polygons, props: [], scenery: [], spawnpoints });

  const baseMap: PmsMapData = {
    version: 11,
    mapName: title,
    texture,
    bgColorTop,
    bgColorBtm,
    startJet,
    startJetGame: Math.floor((119 * startJet) / 100),
    grenadePacks: 2,
    medikits: 2,
    weather: 0,
    steps: 0,
    randomId: Math.floor(Math.random() * 0x7fffffff),
    sectorsDivision: sectorInfo.sectorsDivision,
    sectorsNum: sectorInfo.sectorsNum,
    sectorsPolys: sectorInfo.sectorsPolys,
    polygons,
    props: [],
    scenery: [],
    colliders: [],
    spawnpoints,
    waypoints: [],
    polyBounds: bounds.polyBounds,
    fullBounds: bounds.fullBounds,
    crc32: 0,
    parseWarnings: [],
  };

  baseMap.crc32 = soldatCrc32(serializePms(baseMap));
  return baseMap;
}
