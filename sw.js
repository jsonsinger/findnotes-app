// FindNotes service worker: keeps the app on the device so it opens with no connection.
//
// Change VERSION whenever you change any file of the app (Settings shows it, by asking this
// worker); `python check.py` tells you when it's due and `--fix` bumps it. Browsers notice
// that sw.js changed, fetch the new files into a fresh cache, and the app offers an "Update"
// button. Notes themselves are in IndexedDB and are never touched here.
const VERSION = '0.0.39';
const CACHE = `find-notes-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'welcome.html',
  'gate.js',
  'styles.css',
  'app.js',
  'theme.js',
  'db.js',
  'editor.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'splash/launch-1125x2436.png',
  'splash/launch-1170x2532.png',
  'splash/launch-1179x2556.png',
  'splash/launch-1206x2622.png',
  'splash/launch-1242x2208.png',
  'splash/launch-1242x2688.png',
  'splash/launch-1260x2736.png',
  'splash/launch-1284x2778.png',
  'splash/launch-1290x2796.png',
  'splash/launch-1320x2868.png',
  'splash/launch-750x1334.png',
  'splash/launch-828x1792.png',
  'fonts/Caveat.woff2',
  'fonts/Karla.woff2',
];

self.addEventListener('install', (event) => {
  // `reload` skips the browser's own cache, so a new version is never built from old files.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // No skipWaiting here: the new version waits until you tap Update, so the app never
  // changes underneath you half way through writing a note.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('find-notes-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'version') event.ports[0]?.postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(request);
      } catch (error) {
        // Offline and not in the cache: opening the app still has to work.
        if (request.mode === 'navigate') return cache.match('index.html');
        throw error;
      }
    }),
  );
});
