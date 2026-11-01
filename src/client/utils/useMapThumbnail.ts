import { useEffect, useState } from 'react';
import { generateAndCacheThumbnail } from '../renderer/FullSizeExporter';
import { fetchAndParseMap } from './mapCache';

interface ThumbJob {
  isCancelled: () => boolean;
  run: () => Promise<void>;
}

// LIFO bounded stack so scrolling across 50,000 maps always renders currently visible cards first!
const MAX_PENDING_JOBS = 28;
const thumbStack: ThumbJob[] = [];
// Jobs pushed out of the full stack. A card that is still mounted (e.g. a big screen showing more than
// MAX_PENDING_JOBS cards) gets its job back once the stack drains, instead of waiting forever.
let deferredJobs: ThumbJob[] = [];
let running = false;
const resolvedUrls = new Map<number, string>();

function enqueueJob(job: ThumbJob) {
  if (thumbStack.length >= MAX_PENDING_JOBS) {
    const dropped = thumbStack.shift(); // Oldest (most likely off-screen) job
    if (dropped && !dropped.isCancelled()) deferredJobs.push(dropped);
    if (deferredJobs.length > 512) deferredJobs = deferredJobs.filter((j) => !j.isCancelled());
  }
  thumbStack.push(job);
}

async function drainStack() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      if (thumbStack.length === 0) {
        const revived = deferredJobs.filter((j) => !j.isCancelled());
        deferredJobs = [];
        if (revived.length === 0) break;
        for (const j of revived) enqueueJob(j);
      }
      // Pop most recently visible card (LIFO)
      const job = thumbStack.pop();
      if (!job || job.isCancelled()) continue;
      try {
        await job.run();
      } catch {
        // A single broken map must not stop the queue; its card keeps the placeholder
      }
      // Yield frame so UI scrolling stays locked at 60 FPS
      await new Promise((r) => setTimeout(r, 14));
    }
  } finally {
    running = false;
  }
}

export interface MapThumbnailState {
  url: string | null;
  failed: boolean;
}

export function useMapThumbnail(
  mapId: string,
  crc32: number,
  hasThumbnailOnDisk: boolean,
  enabled: boolean
): MapThumbnailState {
  const unsignedCrc = crc32 >>> 0;
  const serverUrl = `/api/thumbnails/${unsignedCrc.toString(16)}`;

  const [url, setUrl] = useState<string | null>(() => {
    if (hasThumbnailOnDisk) return serverUrl;
    return resolvedUrls.get(unsignedCrc) ?? null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setFailed(false);

    if (hasThumbnailOnDisk) {
      resolvedUrls.set(unsignedCrc, serverUrl);
      setUrl(serverUrl);
      return;
    }

    const cached = resolvedUrls.get(unsignedCrc);
    if (cached) {
      setUrl(cached);
      return;
    }

    setUrl(null);
    let cancelled = false;

    const job: ThumbJob = {
      isCancelled: () => cancelled,
      run: async () => {
        if (cancelled) return;
        const already = resolvedUrls.get(unsignedCrc);
        if (already) {
          if (!cancelled) setUrl(already);
          return;
        }
        try {
          const parsed = await fetchAndParseMap(mapId);
          if (cancelled) return;
          const generatedUrl = await generateAndCacheThumbnail(parsed, unsignedCrc);
          if (generatedUrl) {
            resolvedUrls.set(unsignedCrc, generatedUrl);
            if (!cancelled) setUrl(generatedUrl);
          } else if (!cancelled) {
            setFailed(true);
          }
        } catch (err) {
          if (!cancelled) setFailed(true);
          throw err;
        }
      },
    };

    enqueueJob(job);
    drainStack();

    return () => {
      cancelled = true;
    };
  }, [mapId, unsignedCrc, hasThumbnailOnDisk, enabled, serverUrl]);

  return { url, failed };
}
