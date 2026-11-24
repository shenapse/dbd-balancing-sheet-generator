import type { Image } from '@napi-rs/canvas';
import { loadImageCached } from '../assets/images.js';

/** Loads images through the shared cache and reports each missing file exactly once. */
export interface ImageLoader {
  /**
   * Load one image.
   * @param filePath  image file; also the de-duplication key for missing reports
   * @param message   text handed to `onMissing` the first time this file turns out to be missing
   * @returns the image, or null when missing / undecodable
   */
  load(filePath: string, message: string): Promise<Image | null>;
  /**
   * Load several images concurrently (missing ones are reported afterwards, in input order).
   * @returns map from `key(item)` to the image or null; duplicate keys load once
   */
  loadMap<T>(
    items: readonly T[],
    key: (item: T) => string,
    source: (item: T) => { filePath: string; message: string },
  ): Promise<Map<string, Image | null>>;
}

/** @param onMissing receives the message of every distinct missing file, once per loader */
export function createImageLoader(onMissing: (message: string) => void): ImageLoader {
  const seen = new Set<string>();
  const report = (filePath: string, message: string): void => {
    if (seen.has(filePath)) return;
    seen.add(filePath);
    onMissing(message);
  };
  return {
    async load(filePath, message) {
      const img = await loadImageCached(filePath);
      if (!img) report(filePath, message);
      return img;
    },
    async loadMap(items, key, source) {
      const uniq = [...new Map(items.map((it) => [key(it), it])).values()];
      const srcs = uniq.map(source);
      const imgs = await Promise.all(srcs.map((s) => loadImageCached(s.filePath)));
      const map = new Map<string, Image | null>();
      uniq.forEach((it, i) => {
        const img = imgs[i] ?? null;
        if (!img) report(srcs[i]!.filePath, srcs[i]!.message);
        map.set(key(it), img);
      });
      return map;
    },
  };
}
