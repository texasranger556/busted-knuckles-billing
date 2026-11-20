// Offline support: cache the app files, serve them cache-first.
// Bump VERSION whenever any app file changes so phones pick up the update.
const VERSION = 'bkb-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/db.js', 'js/calc.js', 'js/ui.js', 'js/pdf.js', 'js/share.js',
  'js/pages/settings.js', 'js/pages/customers.js', 'js/pages/quotes.js', 'js/pages/jobs.js',
  'js/pages/invoices.js', 'js/pages/payments.js', 'js/pages/reports.js', 'js/pages/backup.js',
  'js/vendor/preact.module.js', 'js/vendor/hooks.module.js', 'js/vendor/htm.module.js', 'js/vendor/dexie.mjs',
  'js/vendor/jspdf.umd.min.js', 'js/vendor/jspdf.plugin.autotable.min.js', 'js/vendor/jszip.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() =>
      req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
  );
});
