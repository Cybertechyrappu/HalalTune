const CACHE_NAME  = 'halaltune-cache-v3';
const DL_CACHE    = 'halaltune-downloads-v1';

const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/icon.png',
    '/appicon.png',
    '/appleicon.png'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME && k !== DL_CACHE)
                    .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Audio files — check downloads cache first (offline playback)
    if (url.hostname.includes('cloudinary') ||
        url.hostname.includes('res.cloudinary') ||
        event.request.destination === 'audio') {
        event.respondWith(
            caches.open(DL_CACHE).then(cache =>
                cache.match(event.request).then(cached =>
                    cached || fetch(event.request)
                )
            )
        );
        return;
    }

    // App shell — cache first
    event.respondWith(
        caches.match(event.request).then(cached =>
            cached || fetch(event.request)
        )
    );
});
