/**
 * Decodes Soldat textures & sceneries with:
 * 1. Automatic server PNG fallback if a legacy 2002 BMP fails native browser decoding
 * 2. Classic Soldat 1.6 (.bmp) vs OpenSoldat HD (.png) preference toggle
 * 3. Exact OpenSoldat #00FF00 lime-green color-keying (for scenery, edges & object sprites)
 * 4. Premultiplied alpha (matching Gfx.pas Premultiply + glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA))
 * 5. Bounded LRU cache (max 500 decoded assets / 384 MB of pixels) so 10,000-map batch runs never leak RAM
 */

export interface ProcessedImageAsset {
  width: number;
  height: number;
  premultipliedData: Uint8ClampedArray;
  /** Non-premultiplied RGBA canvas for 2D Canvas overlay icons (only when requested with `keepCanvas`) */
  canvas?: HTMLCanvasElement;
}

const MAX_ASSET_CACHE_ENTRIES = 500;
const MAX_ASSET_CACHE_BYTES = 384 * 1024 * 1024;
const imageAssetCache = new Map<string, Promise<ProcessedImageAsset | null>>();
const assetBytesByKey = new Map<string, number>();
let totalAssetBytes = 0;

function deleteCacheEntry(key: string): void {
  imageAssetCache.delete(key);
  const bytes = assetBytesByKey.get(key);
  if (bytes !== undefined) {
    totalAssetBytes -= bytes;
    assetBytesByKey.delete(key);
  }
}

function evictAssetsOverBudget(keepKey: string): void {
  for (const key of imageAssetCache.keys()) {
    if (imageAssetCache.size <= MAX_ASSET_CACHE_ENTRIES && totalAssetBytes <= MAX_ASSET_CACHE_BYTES) break;
    if (key === keepKey) continue;
    deleteCacheEntry(key);
  }
}

// In-memory images served instead of the server (e.g. `_o` tiles baked for a preview that is not saved yet)
const virtualAssets = new Map<string, Blob>();

function virtualKey(category: string, name: string): string {
  return `${category}::${name.toLowerCase()}`;
}

function dropDecodedEntries(category: string, lowerName: string): void {
  const prefix = `${category}::${lowerName}::`;
  for (const key of Array.from(imageAssetCache.keys())) {
    if (key.startsWith(prefix)) deleteCacheEntry(key);
  }
}

export function registerVirtualAsset(
  category: string,
  name: string,
  data: Uint8Array<ArrayBuffer>,
  mime = 'image/png'
): void {
  virtualAssets.set(virtualKey(category, name), new Blob([data], { type: mime }));
  dropDecodedEntries(category, name.toLowerCase());
}

/**
 * Forgets every virtual asset whose name starts with `namePrefix` (and their decoded cache entries).
 */
export function clearVirtualAssets(namePrefix: string): void {
  const lowerPrefix = namePrefix.toLowerCase();
  for (const key of Array.from(virtualAssets.keys())) {
    const [category, lowerName] = key.split('::');
    if (lowerName.startsWith(lowerPrefix)) {
      virtualAssets.delete(key);
      dropDecodedEntries(category, lowerName);
    }
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

async function fetchRawDecodedImage(
  url: string
): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return decodeImageBlob(await resp.blob());
}

async function decodeImageBlob(
  blob: Blob
): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Match OpenSoldat Gfx.pas raw texture decoding: ignore PNG gAMA/iCCP/monitor color conversion!
      const bmp = await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
      return {
        source: bmp,
        width: Math.max(1, bmp.width),
        height: Math.max(1, bmp.height),
        close: () => bmp.close(),
      };
    } catch {
      // Fallback to HTMLImageElement if createImageBitmap rejects an uncommon format
    }
  }

  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await loadHtmlImage(objUrl);
    return {
      source: img,
      width: Math.max(1, img.naturalWidth || img.width),
      height: Math.max(1, img.naturalHeight || img.height),
    };
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export function clearSoldatAssetCache(): void {
  imageAssetCache.clear();
  assetBytesByKey.clear();
  totalAssetBytes = 0;
  // Object sprites come from the same folders (a different Soldat path may have different ones)
  cachedObjectSpritesPromise = null;
}

export function loadSoldatAssetImage(
  category: string,
  name: string,
  applyGreenColorKey: boolean,
  preferClassicBmp = false,
  keepCanvas = false
): Promise<ProcessedImageAsset | null> {
  if (!name.trim()) return Promise.resolve(null);
  const cacheKey = `${category}::${name.toLowerCase()}::${applyGreenColorKey ? 'ck' : 'raw'}::${preferClassicBmp ? 'bmp' : 'hd'}${keepCanvas ? '::cv' : ''}`;

  const hit = imageAssetCache.get(cacheKey);
  if (hit) {
    // Refresh LRU order
    imageAssetCache.delete(cacheKey);
    imageAssetCache.set(cacheKey, hit);
    return hit;
  }

  const promise = (async (): Promise<ProcessedImageAsset | null> => {
    const classicParam = preferClassicBmp ? '&classic=1' : '';
    const baseUrl = `/api/assets?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}${classicParam}`;
    let decoded: { source: CanvasImageSource; width: number; height: number; close?: () => void };
    const virtualBlob = virtualAssets.get(virtualKey(category, name));
    try {
      decoded = virtualBlob ? await decodeImageBlob(virtualBlob) : await fetchRawDecodedImage(baseUrl);
    } catch {
      if (virtualBlob) return null;
      try {
        decoded = await fetchRawDecodedImage(`${baseUrl}&convert=png`);
      } catch {
        return null;
      }
    }

    const { width, height } = decoded;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      decoded.close?.();
      return null;
    }

    ctx.drawImage(decoded.source, 0, 0, width, height);
    decoded.close?.();
    const imgData = ctx.getImageData(0, 0, width, height);
    const src = imgData.data;
    const premul = new Uint8ClampedArray(src.length);

    // Checking exact RGB=(0,255,0) & A=255 matches OpenSoldat Gfx.pas color-keying!
    for (let i = 0; i < src.length; i += 4) {
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];
      let a = src[i + 3];

      if (applyGreenColorKey && r === 0 && g === 255 && b === 0 && a === 255) {
        r = 0;
        g = 0;
        b = 0;
        a = 0;
        src[i] = 0;
        src[i + 1] = 0;
        src[i + 2] = 0;
        src[i + 3] = 0;
      }

      if (a === 255) {
        premul[i] = r;
        premul[i + 1] = g;
        premul[i + 2] = b;
        premul[i + 3] = 255;
      } else if (a === 0) {
        premul[i] = 0;
        premul[i + 1] = 0;
        premul[i + 2] = 0;
        premul[i + 3] = 0;
      } else {
        const f = a / 255;
        premul[i] = Math.round(r * f);
        premul[i + 1] = Math.round(g * f);
        premul[i + 2] = Math.round(b * f);
        premul[i + 3] = a;
      }
    }

    if (!keepCanvas) {
      // WebGL only needs the premultiplied pixels: release the canvas backing store right away
      canvas.width = 0;
      canvas.height = 0;
      return { width, height, premultipliedData: premul };
    }

    if (applyGreenColorKey) {
      ctx.putImageData(imgData, 0, 0);
    }

    return {
      width,
      height,
      premultipliedData: premul,
      canvas,
    };
  })();

  imageAssetCache.set(cacheKey, promise);
  evictAssetsOverBudget(cacheKey);
  promise
    .then((asset) => {
      // Account the pixels only while this exact promise is still the cached one
      if (!asset || imageAssetCache.get(cacheKey) !== promise) return;
      const bytes = asset.premultipliedData.byteLength * (asset.canvas ? 2 : 1);
      assetBytesByKey.set(cacheKey, bytes);
      totalAssetBytes += bytes;
      evictAssetsOverBudget(cacheKey);
    })
    .catch(() => {
      if (imageAssetCache.get(cacheKey) === promise) deleteCacheEntry(cacheKey);
    });
  return promise;
}

export interface ObjectSpritesBundle {
  alphaFlag: HTMLCanvasElement | null;
  bravoFlag: HTMLCanvasElement | null;
  yellowFlag: HTMLCanvasElement | null;
  medikit: HTMLCanvasElement | null;
  grenadekit: HTMLCanvasElement | null;
  clusterkit: HTMLCanvasElement | null;
  vestkit: HTMLCanvasElement | null;
  flamerkit: HTMLCanvasElement | null;
  berserkerkit: HTMLCanvasElement | null;
  predatorkit: HTMLCanvasElement | null;
  bow: HTMLCanvasElement | null;
  stationaryGun: HTMLCanvasElement | null;
}

let cachedObjectSpritesPromise: Promise<ObjectSpritesBundle> | null = null;

function tintCanvas(source: HTMLCanvasElement, rMul: number, gMul: number, bMul: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = Math.min(255, Math.round(d[i] * rMul));
    d[i + 1] = Math.min(255, Math.round(d[i + 1] * gMul));
    d[i + 2] = Math.min(255, Math.round(d[i + 2] * bMul));
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

function loadSprite(category: string, name: string): Promise<ProcessedImageAsset | null> {
  return loadSoldatAssetImage(category, name, true, false, true);
}

export function loadSoldatObjectSprites(): Promise<ObjectSpritesBundle> {
  if (cachedObjectSpritesPromise) return cachedObjectSpritesPromise;

  cachedObjectSpritesPromise = (async () => {
    const [
      baseFlag,
      medikit,
      grenadekit,
      clusterkit,
      vestkit,
      flamerkit,
      berserkerkit,
      predatorkit,
      bow,
      stationaryGun,
    ] = await Promise.all([
      loadSprite('objects-gfx', 'flag.png').then((r) => r ?? loadSprite('textures/objects', 'flag.bmp')),
      loadSprite('textures/objects', 'medikit.png'),
      loadSprite('textures/objects', 'grenadekit.png'),
      loadSprite('textures/objects', 'clusterkit.png'),
      loadSprite('textures/objects', 'vestkit.png'),
      loadSprite('textures/objects', 'flamerkit.bmp'),
      loadSprite('textures/objects', 'berserkerkit.bmp'),
      loadSprite('textures/objects', 'predatorkit.bmp'),
      loadSprite('weapons-gfx', 'bow.png'),
      loadSprite('weapons-gfx', 'm2-stat.png'),
    ]);

    const flagCanvas = baseFlag?.canvas;
    return {
      alphaFlag: flagCanvas ? tintCanvas(flagCanvas, 1.0, 0.22, 0.22) : null,
      bravoFlag: flagCanvas ? tintCanvas(flagCanvas, 0.25, 0.55, 1.0) : null,
      yellowFlag: flagCanvas ? tintCanvas(flagCanvas, 1.0, 0.9, 0.2) : null,
      medikit: medikit?.canvas ?? null,
      grenadekit: grenadekit?.canvas ?? null,
      clusterkit: clusterkit?.canvas ?? null,
      vestkit: vestkit?.canvas ?? null,
      flamerkit: flamerkit?.canvas ?? null,
      berserkerkit: berserkerkit?.canvas ?? null,
      predatorkit: predatorkit?.canvas ?? null,
      bow: bow?.canvas ?? null,
      stationaryGun: stationaryGun?.canvas ?? null,
    };
  })();

  return cachedObjectSpritesPromise;
}
