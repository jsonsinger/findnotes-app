// FindNotes service worker: keeps the app on the device so it opens with no connection.
//
// Change VERSION whenever you change any file of the app (Settings shows it, by asking this
// worker). Browsers notice that sw.js changed, fetch the new files into a fresh cache, and the
// app offers an "Update" button. Notes themselves are in IndexedDB and are never touched here.
const VERSION = '0.1.10';
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
  'fonts/caveat.woff2',
  'fonts/karla.woff2',
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
