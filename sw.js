/**
 * @fileoverview sw.js — Service Worker
 * Zuständig für: PWA-Caching statischer Assets, Offline-Erkennung.
 * Die Offline-Queue selbst wird in app.js via IndexedDB verwaltet.
 */

'use strict';

const CACHE_NAME = 'editor-v1';
const PRECACHE = [];  // Kein Precaching hinter Basic Auth

// ── INSTALL ────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── ACTIVATE ───────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Alles außer same-origin statische Assets einfach durchlassen —
  // kein respondWith = Browser übernimmt den Request direkt.
  // Verhindert SW-Fehler bei API-Calls, Basic-Auth-Requests und externen URLs.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.php'))       return;

  // Statische Assets: Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});