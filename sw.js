// Minimal service worker — its only job is to exist and handle 'fetch',
// which is one of Chrome's requirements for a real "Install app" prompt
// (icon + standalone launch) instead of a plain generic-icon shortcut.
// It intentionally does NOT cache anything, so Firebase/Firestore data
// always comes fresh from the network — no stale data risk.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intentionally empty — network requests pass through untouched.
});
