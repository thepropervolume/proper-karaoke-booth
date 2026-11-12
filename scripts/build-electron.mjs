import { build } from 'esbuild';
await Promise.all(['main', 'preload'].map((entry) => build({
  entryPoints: [`src/${entry}/index.ts`],
  outfile: `dist/${entry}/index.cjs`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
})));
await build({ entryPoints: ['src/control/entry.ts'], outfile: 'dist/control/cli.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', sourcemap: true });
