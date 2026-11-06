import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    rollupOptions: { input: {
      host: resolve(root, 'src/renderer/index.html'),
      display: resolve(root, 'src/display/index.html'),
    } },
  },
});
