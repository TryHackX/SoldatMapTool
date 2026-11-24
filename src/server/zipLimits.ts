/**
 * Limits for archives from the internet (map packs). A crafted ZIP can declare absurd sizes (memory
 * exhaustion), point many entries at the same compressed data ("zip bomb"), escape the target folder
 * (zip-slip) or carry symbolic links that later writes would follow.
 */
export const ZIP_LIMITS = {
  maxEntries: 100_000,
  maxEntryBytes: 512 * 1024 * 1024, // one file inside the archive
  maxTotalBytes: 8 * 1024 * 1024 * 1024, // all files together
  maxCompressionRatio: 200, // unpacked size vs archive size (map packs compress ~3-20x)
  ratioFloorBytes: 64 * 1024 * 1024, // small archives may unpack to this much regardless of the ratio
  maxPmsPreviewBytes: 32 * 1024 * 1024, // one .pms parsed for the archive preview (real maps are < 5 MB)
  maxPreviewTotalBytes: 256 * 1024 * 1024, // all .pms parsed for one preview
};

export type ZipLimits = typeof ZIP_LIMITS;
