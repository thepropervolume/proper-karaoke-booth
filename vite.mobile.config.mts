import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve('src/mobile'), publicDir: resolve('mobile/web-public'), base: './',
  build: { outDir: resolve('dist/mobile'), emptyOutDir: true, manifest: true }, server: { host: '127.0.0.1', port: 5174 } });
