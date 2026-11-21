// Offline support: cache the app files, serve them cache-first.
// Bump VERSION whenever any app file changes so phones pick up the update
// (Settings → Check for updates, or automatically the next time the app opens with signal).
const VERSION = 'bkb-v5';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/db.js', 'js/calc.js', 'js/ui.js', 'js/pdf.js', 'js/share.js', 'js/contacts.js', 'js/update.js',
  'js/pages/settings.js', 'js/pages/customers.js', 'js/pages/quotes.js', 'js/pages/jobs.js',
  'js/pages/invoices.js', 'js/pages/payments.js', 'js/pages/reports.js', 'js/pages/backup.js',
  'js/vendor/preact.module.js', 'js/vendor/hooks.module.js', 'js/vendor/htm.module.js', 'js/vendor/dexie.mjs',
  'js/vendor/jspdf.umd.min.js', 'js/vendor/jspdf.plugin.autotable.min.js', 'js/vendor/jszip.min.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so an update never mixes new and stale files.
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'version' && e.ports[0]) e.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || fetch(req).catch(() =>
      req.mode === 'navigate' ? caches.open(VERSION).then((c) => c.match('index.html')) : Response.error())),
  );
});
