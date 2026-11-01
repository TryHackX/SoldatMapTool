/**
 * Pure TypeScript decoder for Windows & OS/2 BMP files (1, 4, 8, 16, 24, 32-bit,
 * uncompressed, RLE4, RLE8, and BITFIELDS).
 * Needed because libvips/sharp does not natively decode .bmp files, and Soldat maps
 * from 2002-2026 rely heavily on .bmp textures, edges, and sceneries.
 */

export interface DecodedBmp {
  width: number;
  height: number;
  rgba: Buffer;
}

function shiftMaskChannel(value: number, mask: number, maxOut = 255): number {
  if (mask === 0) return maxOut;
  const uMask = mask >>> 0;
  let shift = 0;
  while (((uMask >>> shift) & 1) === 0 && shift < 32) {
    shift++;
  }
  let bits = 0;
  while (shift + bits < 32 && ((uMask >>> (shift + bits)) & 1) === 1) {
    bits++;
  }
  if (bits === 0) return 0;
  const raw = (value >>> shift) & ((1 << bits) - 1);
  const maxVal = (1 << bits) - 1;
  return Math.round((raw * maxOut) / maxVal);
}

export function decodeBmpToRgba(buf: Buffer): DecodedBmp {
  if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4d) {
    throw new Error('Not a valid BMP file');
  }

  const pixelOffset = buf.readUInt32LE(10);
  const dibHeaderSize = buf.readUInt32LE(14);

  let width = 0;
  let height = 0;
  let topDown = false;
  let bpp = 0;
  let compression = 0;
  let colorsUsed = 0;
  let isOs2 = false;

  if (dibHeaderSize === 12) {
    // BITMAPCOREHEADER (OS/2 1.x)
    isOs2 = true;
    width = buf.readUInt16LE(18);
    const rawH = buf.readInt16LE(20);
    topDown = rawH < 0;
    height = Math.abs(rawH);
    bpp = buf.readUInt16LE(24);
  } else {
    width = buf.readInt32LE(18);
    const rawH = buf.readInt32LE(22);
    topDown = rawH < 0;
    height = Math.abs(rawH);
    bpp = buf.readUInt16LE(28);
    compression = dibHeaderSize >= 20 ? buf.readUInt32LE(30) : 0;
    colorsUsed = dibHeaderSize >= 36 ? buf.readUInt32LE(46) : 0;
  }

  if (width <= 0 || height <= 0 || width > 32768 || height > 32768) {
    throw new Error(`Invalid BMP dimensions: ${width}x${height}`);
  }

  const rgba = Buffer.alloc(width * height * 4, 255);

  // Palette for <= 8 bpp
  const palette: Array<[number, number, number]> = [];
  if (bpp <= 8) {
    const numColors = colorsUsed > 0 ? colorsUsed : 1 << bpp;
    const entrySize = isOs2 ? 3 : 4;
    let palPos = 14 + dibHeaderSize;
    for (let i = 0; i < numColors && palPos + entrySize <= buf.length; i++) {
      const b = buf[palPos];
      const g = buf[palPos + 1];
      const r = buf[palPos + 2];
      palette.push([r, g, b]);
      palPos += entrySize;
    }
  }

  // Bitfields masks for 16/32 bpp
  let rMask = bpp === 16 ? 0x7c00 : 0x00ff0000;
  let gMask = bpp === 16 ? 0x03e0 : 0x0000ff00;
  let bMask = bpp === 16 ? 0x001f : 0x000000ff;
  let aMask = bpp === 32 ? 0xff000000 : 0;

  if (compression === 3 || compression === 6) {
    // BI_BITFIELDS or BI_ALPHABITFIELDS
    const maskOffset = dibHeaderSize >= 52 ? 54 : 14 + dibHeaderSize;
    if (maskOffset + 12 <= buf.length) {
      rMask = buf.readUInt32LE(maskOffset);
      gMask = buf.readUInt32LE(maskOffset + 4);
      bMask = buf.readUInt32LE(maskOffset + 8);
      if ((compression === 6 || dibHeaderSize >= 56) && maskOffset + 16 <= buf.length) {
        aMask = buf.readUInt32LE(maskOffset + 12);
      } else {
        aMask = 0;
      }
    }
  }

  const setPixel = (x: number, bmpRow: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || x >= width || bmpRow < 0 || bmpRow >= height) return;
    const outY = topDown ? bmpRow : height - 1 - bmpRow;
    const dst = (outY * width + x) * 4;
    rgba[dst] = r;
    rgba[dst + 1] = g;
    rgba[dst + 2] = b;
    rgba[dst + 3] = a;
  };

  if (compression === 1 && bpp === 8) {
    // BI_RLE8
    let pos = pixelOffset;
    let x = 0;
    let y = 0;
    // Initialize transparent/palette[0] background in case of delta jumps
    const bg = palette[0] ?? [0, 0, 0];
    for (let i = 0; i < width * height * 4; i += 4) {
      rgba[i] = bg[0];
      rgba[i + 1] = bg[1];
      rgba[i + 2] = bg[2];
      rgba[i + 3] = 255;
    }

    while (pos + 1 < buf.length && y < height) {
      const count = buf[pos++];
      const val = buf[pos++];
      if (count > 0) {
        const c = palette[val] ?? [0, 0, 0];
        for (let i = 0; i < count; i++) {
          setPixel(x++, y, c[0], c[1], c[2], 255);
        }
      } else {
        if (val === 0) {
          // End of line
          x = 0;
          y++;
        } else if (val === 1) {
          // End of bitmap
          break;
        } else if (val === 2) {
          // Delta jump
          if (pos + 1 >= buf.length) break;
          x += buf[pos++];
          y += buf[pos++];
        } else {
          // Absolute mode
          for (let i = 0; i < val && pos < buf.length; i++) {
            const idx = buf[pos++];
            const c = palette[idx] ?? [0, 0, 0];
            setPixel(x++, y, c[0], c[1], c[2], 255);
          }
          if ((val & 1) === 1) pos++; // Word boundary pad
        }
      }
    }
    return { width, height, rgba };
  }

  if (compression === 2 && bpp === 4) {
    // BI_RLE4
    let pos = pixelOffset;
    let x = 0;
    let y = 0;
    // Same palette[0] background as RLE8 for pixels skipped by delta jumps / early end-of-line
    const bg = palette[0] ?? [0, 0, 0];
    for (let i = 0; i < width * height * 4; i += 4) {
      rgba[i] = bg[0];
      rgba[i + 1] = bg[1];
      rgba[i + 2] = bg[2];
      rgba[i + 3] = 255;
    }
    while (pos + 1 < buf.length && y < height) {
      const count = buf[pos++];
      const val = buf[pos++];
      if (count > 0) {
        const cHigh = palette[(val >> 4) & 0x0f] ?? [0, 0, 0];
        const cLow = palette[val & 0x0f] ?? [0, 0, 0];
        for (let i = 0; i < count; i++) {
          const c = (i & 1) === 0 ? cHigh : cLow;
          setPixel(x++, y, c[0], c[1], c[2], 255);
        }
      } else {
        if (val === 0) {
          x = 0;
          y++;
        } else if (val === 1) {
          break;
        } else if (val === 2) {
          if (pos + 1 >= buf.length) break;
          x += buf[pos++];
          y += buf[pos++];
        } else {
          const byteCount = Math.ceil(val / 2);
          for (let i = 0; i < val; i++) {
            const byteIdx = pos + (i >> 1);
            if (byteIdx >= buf.length) break;
            const nib = (i & 1) === 0 ? (buf[byteIdx] >> 4) & 0x0f : buf[byteIdx] & 0x0f;
            const c = palette[nib] ?? [0, 0, 0];
            setPixel(x++, y, c[0], c[1], c[2], 255);
          }
          pos += byteCount + (byteCount & 1);
        }
      }
    }
    return { width, height, rgba };
  }

  // Uncompressed / BITFIELDS scanlines
  const rowStride = Math.floor((bpp * width + 31) / 32) * 4;
  let hasNonZeroAlpha32 = false;

  for (let y = 0; y < height; y++) {
    const rowStart = pixelOffset + y * rowStride;
    if (rowStart >= buf.length) break;

    if (bpp === 1) {
      for (let x = 0; x < width; x++) {
        const bytePos = rowStart + (x >> 3);
        const bit = bytePos < buf.length ? (buf[bytePos] >> (7 - (x & 7))) & 1 : 0;
        const c = palette[bit] ?? (bit ? [255, 255, 255] : [0, 0, 0]);
        setPixel(x, y, c[0], c[1], c[2], 255);
      }
    } else if (bpp === 4) {
      for (let x = 0; x < width; x++) {
        const bytePos = rowStart + (x >> 1);
        const nib =
          bytePos < buf.length
            ? (x & 1) === 0
              ? (buf[bytePos] >> 4) & 0x0f
              : buf[bytePos] & 0x0f
            : 0;
        const c = palette[nib] ?? [0, 0, 0];
        setPixel(x, y, c[0], c[1], c[2], 255);
      }
    } else if (bpp === 8) {
      for (let x = 0; x < width; x++) {
        const idx = rowStart + x < buf.length ? buf[rowStart + x] : 0;
        const c = palette[idx] ?? [0, 0, 0];
        setPixel(x, y, c[0], c[1], c[2], 255);
      }
    } else if (bpp === 16) {
      for (let x = 0; x < width; x++) {
        const p = rowStart + x * 2;
        if (p + 2 > buf.length) break;
        const word = buf.readUInt16LE(p);
        const r = shiftMaskChannel(word, rMask);
        const g = shiftMaskChannel(word, gMask);
        const b = shiftMaskChannel(word, bMask);
        setPixel(x, y, r, g, b, 255);
      }
    } else if (bpp === 24) {
      for (let x = 0; x < width; x++) {
        const p = rowStart + x * 3;
        if (p + 3 > buf.length) break;
        setPixel(x, y, buf[p + 2], buf[p + 1], buf[p], 255);
      }
    } else if (bpp === 32) {
      for (let x = 0; x < width; x++) {
        const p = rowStart + x * 4;
        if (p + 4 > buf.length) break;
        const dword = buf.readUInt32LE(p);
        const r = shiftMaskChannel(dword, rMask);
        const g = shiftMaskChannel(dword, gMask);
        const b = shiftMaskChannel(dword, bMask);
        const a = aMask !== 0 ? shiftMaskChannel(dword, aMask) : 255;
        if (a > 0) hasNonZeroAlpha32 = true;
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  // Many legacy 32-bit BGRX BMPs leave the 4th byte as 0x00 across the entire image -> treat as opaque!
  if (bpp === 32 && aMask !== 0 && !hasNonZeroAlpha32) {
    for (let i = 3; i < rgba.length; i += 4) {
      rgba[i] = 255;
    }
  }

  return { width, height, rgba };
}
