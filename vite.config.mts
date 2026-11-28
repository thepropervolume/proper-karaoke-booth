import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopDocumentation } from './scripts/desktop-documentation.mjs';
const root = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  base: './',
  plugins: [desktopDocumentation(root)],
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: {
      host: resolve(root, 'src/renderer/index.html'),
      display: resolve(root, 'src/display/index.html'),
      singer: resolve(root, 'src/remote/index.html'),
      documentation: resolve(root, 'src/help/index.html'),
      splash: resolve(root, 'src/splash/index.html'),
    } },
  },
});
