const CACHE_NAME = 'korean-app-v9';
const GRAMMAR_JSONS = Array.from(
  { length: 118 },
  (_, i) => `./data/grammar/part-${String(i + 1).padStart(2, '0')}.json`
);
const VOCAB_JSONS = Array.from(
  { length: 30 },
  (_, i) => `./data/vocabulary/part-${String(i + 1).padStart(2, '0')}.json`
);

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/audio.js',
  './js/chat.js',
  './js/dataLoader.js',
  './js/firebase-config.js',
  './js/koreanUtils.js',
  './js/storage.js',
  ...GRAMMAR_JSONS,
  ...VOCAB_JSONS
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log('🧪 正在同步離線文法與單字資料...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          const shouldDynamicCache =
            request.url.includes('.json') || request.url.includes('.mp3') || request.url.includes('/data/');

          if (shouldDynamicCache && networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }

          return networkResponse;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('./offline.html');
          }

          return new Response('', {
            status: 503,
            statusText: 'Offline'
          });
        });
    })
  );
});
