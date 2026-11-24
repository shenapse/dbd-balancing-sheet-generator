import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { DBD_ASSETS_ROOT: process.env.DBD_ASSETS_ROOT ?? path.resolve('../dbd-assets') },
  },
});
