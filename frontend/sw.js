const CACHE_NAME = 'nofee-music-v2';

// Static assets to cache on install
const PRECACHE_URLS = [
    '/',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/lofi-track.mp3',
    '/icons/icon-32.png',
    '/icons/icon-128.png',
    '/icons/icon-256.png',
    '/icons/icon-512.png',
];

// CDN resources to cache on first use
const CDN_ORIGINS = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://cdnjs.cloudflare.com',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Music files and playlist API: always network-first, no offline fallback needed
    if (url.pathname.startsWith('/music') || url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // CDN resources: cache-first (stale-while-revalidate style)
    if (CDN_ORIGINS.some(origin => event.request.url.startsWith(origin))) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const networkFetch = fetch(event.request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
                return cached || networkFetch;
            })
        );
        return;
    }

    // All other requests (app shell): cache-first, fall back to network
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});
