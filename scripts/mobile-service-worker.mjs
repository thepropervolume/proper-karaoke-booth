export function mobileServiceWorker(cacheName, files) {
  return `const CACHE = ${JSON.stringify(cacheName)};
const FILES = ${JSON.stringify(files)};
const BASE = new URL('./', self.location.href);
const cached = request => caches.open(CACHE).then(cache => cache.match(request));

// Activate only after the new shell and its assets are ready. Existing tabs
// keep their state and load the current shell on their next navigation.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim().then(async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('tpv-mobile-') && key !== CACHE).map(key => caches.delete(key)));
  }));
});

async function shell(request) {
  let response;
  try { response = await fetch(request, { cache: 'no-store' }); }
  catch (error) {
    const offline = await cached(request);
    if (offline) return offline;
    throw error;
  }
  return response.status >= 500 ? (await cached(request)) || response : response;
}

// Only the public shell is cached. Search, room requests and account data
// bypass the worker, as do URLs with a query including email links.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.href.startsWith(BASE.href) || url.search) return;
  const name = url.href.slice(BASE.href.length) || './';
  if (!FILES.includes(name)) return;
  event.respondWith(name === './' || name === 'index.html'
    ? shell(request)
    : cached(request).then(hit => hit || fetch(request)));
});
`;
}
