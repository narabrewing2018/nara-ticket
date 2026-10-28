/*
 * オフライン照合ページを端末に保存する Service Worker（GitHub Pages 版だけで動く）
 * ・ページを開くたびに最新版を取りに行き、3秒で届かなければ保存しておいたページを出す
 * ・Apps Script への問い合わせ（一覧の取り込み・記録の送信）には関わらない
 * ・ページを直したら VERSION を上げる
 */
var VERSION = 'nara-offline-v3';
var PAGE = new URL('Offline.html', self.registration.scope).href;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.add(new Request(PAGE, { cache: 'reload' })); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // Apps Script など外部は素通し
  if (req.mode !== 'navigate' && url.href !== PAGE) return;      // ページ以外（sw.js 等）は素通し
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function fromCache() {
      if (done) return;
      caches.match(PAGE).then(function (hit) {
        if (done) return;
        if (hit) { done = true; resolve(hit); }
      });
    }
    var timer = setTimeout(fromCache, 3000);
    fetch(new Request(PAGE, { cache: 'no-store' })).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(PAGE, copy); });
        if (!done) { done = true; clearTimeout(timer); resolve(res); }
      } else {
        clearTimeout(timer);
        caches.match(PAGE).then(function (hit) { if (!done) { done = true; resolve(hit || res); } });
      }
    }).catch(function () {
      clearTimeout(timer);
      caches.match(PAGE).then(function (hit) {
        if (!done) { done = true; resolve(hit || new Response('オフラインのため開けません。ネットにつながってから開き直してください。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })); }
      });
    });
  }));
});
