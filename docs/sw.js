/*
 * Service Worker: 一度開いたら、以降はネットワークなしで起動できるようにする。
 *
 *  - アプリ一式を「バージョン名つきキャッシュ」に保存し、キャッシュ優先で配信する
 *  - js/version.js の APP_VERSION を変えると新しいキャッシュが作られ、古いキャッシュは削除される
 *  - 新しいService Workerは待機し、画面側の「更新する」ボタンで切り替える
 *    （プレイ中に勝手に入れ替わらないようにするため）
 */
importScripts('js/version.js');

const CACHE_NAME = `luckybox-${APP_VERSION}`;

const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'css/bingo-bonus-fix.css',
  'css/card-look.css',
  'css/lite.css',
  'js/version.js',
  'js/cards.js',
  'js/engine.js',
  'js/game.js',
  'js/staff.js',
  'js/pwa.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'images/title-logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // HTTPキャッシュを経由せず、必ずサーバーの最新を取得して保存する
      cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // skipWaiting() はここでは呼ばない（画面の「更新する」操作で切り替える）
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('luckybox-') && key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        return await fetch(request);
      } catch (err) {
        // オフラインでページ遷移された場合は、キャッシュ済みのトップページを返す
        if (request.mode === 'navigate') {
          const fallback = await cache.match('index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })
  );
});
