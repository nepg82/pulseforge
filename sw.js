const CACHE_NAME = "pulseforge-shell-v0.6.0";
const TONE_URL = "https://cdnjs.cloudflare.com/ajax/libs/tone/15.1.22/Tone.js";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/audio-engine.js",
  "./js/scheduler-worker.js",
  "./js/playback.js",
  "./js/media-session.js",
  "./app-icons/app-icon-192.png",
  "./app-icons/app-icon-512.png",
  TONE_URL
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response && response.ok && new URL(request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => {
      if (request.mode === "navigate") return caches.match("./index.html");
      throw new Error("Offline resource unavailable");
    });
  }));
});
