/* Service worker di Ham Toolkit: tutto il sito funziona offline.
 * Strategia stale-while-revalidate: risponde subito dalla cache e aggiorna in
 * background, quindi una modifica pubblicata si vede dalla visita successiva.
 * Cambiare VERSION solo per buttare via le cache vecchie (es. file rimossi). */
const VERSION = 'v1';
const CACHE = `ham-toolkit-${VERSION}`;
const FILES = [
  './', 'manifest.webmanifest', 'pwa.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'spettro/', 'spettro/style.css', 'spettro/app.js', 'spettro/bands.json', 'spettro/favicon.svg',
  'codici-q/', 'dipolo/', 'ruota/',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('ham-toolkit-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // solo GET dello stesso sito: QRZ e i link alle fonti passano dritti in rete
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req)
      .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (req.mode === 'navigate' && await cache.match('./')) || Response.error();
  })());
});
