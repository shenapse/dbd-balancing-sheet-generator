import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

/** dbd-assets as pinned in dbd-assets.ref; golden images in test/golden are rendered against it. */
const PINNED_ASSETS_URL = 'https://github.com/shenapse/dbd-assets.git';
const PINNED_ASSETS_REF = fs.readFileSync('dbd-assets.ref', 'utf8').trim();

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Rendering the golden cases fetches assets on first run and decodes large PNGs.
    testTimeout: 60_000,
    env: {
      DBD_ASSETS_ROOT: process.env.DBD_ASSETS_ROOT ?? PINNED_ASSETS_URL,
      DBD_ASSETS_REF: process.env.DBD_ASSETS_REF ?? PINNED_ASSETS_REF,
    },
  },
});
