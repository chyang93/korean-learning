// sw.js

// 1. 提升版本號：確保瀏覽器偵測到 sw.js 變動並重新下載資源
const CACHE_NAME = 'korean-app-v18'; 

// 2. 生成 118 課文法 JSON 路徑
const GRAMMAR_JSONS = Array.from(
  { length: 118 },
  (_, i) => `./data/grammar/part-${String(i + 1).padStart(2, '0')}.json`
);

// 3. 生成 30 個單字分章 JSON 路徑
const VOCAB_JSONS = Array.from(
  { length: 30 },
  (_, i) => `./data/vocabulary/part-${String(i + 1).padStart(2, '0')}.json`
);

// 🟢 4. 新增：生成 11 個發音庫 JSON 路徑
const PRONUNCIATION_JSONS = Array.from(
  { length: 11 },
  (_, i) => `./data/grammar/pronunciation-${String(i + 1).padStart(2, '0')}.json`
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
  ...VOCAB_JSONS,
  ...PRONUNCIATION_JSONS // 🟢 將發音路徑加入快取清單
];

// 5. 安裝階段：將清單內所有資源存入 Cache Storage
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log('🧪 正在同步離線文法、單字與發音資料...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// 6. 啟動階段：清理舊版本的快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// 7. 攔截請求：優先從快取讀取，若無則從網路下載並動態存入
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request)
        .then((networkResponse) => {
          // 動態快取：若請求是 JSON、音檔或 data 資料夾內容則存入
          const shouldDynamicCache =
            request.url.includes('.json') || request.url.includes('.mp3') || request.url.includes('/data/');

          if (shouldDynamicCache && networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // 斷網且無法存取頁面時顯示離線備援頁面
          if (request.mode === 'navigate') return caches.match('./offline.html');
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});