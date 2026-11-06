/* POD Management PWA Service Worker
 * Cache เฉพาะไฟล์โปรแกรม ไม่แตะต้อง IndexedDB หรือข้อมูลพัสดุ
 */
const CACHE_PREFIX = 'pod-management-app-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', '/pwa-192.png', '/pwa-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // หน้าเว็บ: ขอเวอร์ชันล่าสุดก่อน หากไม่มีอินเทอร์เน็ตจึงใช้ไฟล์ที่ Cache ไว้
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/index.html', fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/'));
      }
    })());
    return;
  }

  // ไฟล์ JS/CSS/รูปภาพ: ใช้ Cache ก่อนเพื่อเปิดออฟไลน์ และบันทึกไฟล์ใหม่เมื่อออนไลน์
  if (['script', 'style', 'image', 'font'].includes(request.destination) || url.pathname.endsWith('.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        fetch(request).then((response) => {
          if (response && response.ok) cache.put(request, response);
        }).catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response && response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return Response.error();
      }
    })());
  }
});
