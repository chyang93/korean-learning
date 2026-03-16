// sw.js

// 1. 提升版本號至 v68 (確保瀏覽器重新抓取)
const CACHE_NAME = 'korean-app-v77'; 

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './offline.html',
  './css/style.css',
  './js/main.js',
  './js/audio.js',
  './manifest.json',
  './js/chat.js',
  './js/dataLoader.js',
  './js/firebase-config.js',
  './js/koreanUtils.js',
  './js/storage.js',
  
  // 🟢 修正：移除路徑前方的多餘空白，並指向合併後的檔案
  './data/grammar/all_chapters.json',
  './data/grammar/all_pronunciations.json',
  './data/vocabulary/all_vocabularies.json',
  
  // 🔴 注意：如果你沒建立 manifest.json，請先註解掉下面這行，以免噴紅字
  // './manifest.json' 
];

// 2. 安裝階段 (保持 allSettled 強化版)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('🧪 正在同步合併後的資源...');
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => 
          cache.add(url).catch(err => console.error(`❌ 快取失敗: ${url}`))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 3. 啟動階段：清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => 
      Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

// 4. 攔截請求 (保持不變)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(request).then((networkResponse) => {
        const shouldDynamicCache = request.url.includes('.json') || request.url.includes('.mp3') || request.url.includes('/data/');
        if (shouldDynamicCache && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      }).catch(() => {
        if (request.mode === 'navigate') return caches.match('./offline.html');
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});