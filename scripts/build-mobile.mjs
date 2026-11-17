import { build } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await build({ configFile: 'vite.mobile.config.mts' });
const root = 'dist/mobile', assets = (await readdir(`${root}/assets`)).map(file => `assets/${file}`);
const shell = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...assets];
const hash = createHash('sha256'); for (const file of shell.filter(f => f !== './')) hash.update(await readFile(`${root}/${file}`));
// Only immutable app assets are cached. Queue replies, credentials, search,
// provider media and guest data always go to the network or fail visibly.
await writeFile(`${root}/service-worker.js`, `const CACHE='tpv-mobile-${hash.digest('hex').slice(0,16)}',FILES=${JSON.stringify(shell)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tpv-mobile-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url),base=new URL('./',self.location.href);if(event.request.method!=='GET'||url.origin!==base.origin||!url.href.startsWith(base.href)||url.search)return;const name=url.href.slice(base.href.length)||'./';if(!FILES.includes(name))return;event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||fetch(event.request)));});
`);
console.log('Mobile web build and shell-only offline cache generated.');
