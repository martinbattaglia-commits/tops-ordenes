/* TOPS NEXUS — Service Worker
 *
 * Estrategia:
 *  - estáticos (_next/static, fonts, icons): cache-first (versionados por hash → safe)
 *  - HTML / app data: NETWORK-ONLY (sin cachear navegación; previene servir UI vieja
 *    después de un deploy). Fallback al cache solo si totalmente offline.
 *  - El SW no toca POSTs ni /api/auth.
 *
 * Bumpear CACHE name en cada release que rompa caché de assets.
 *   v1 → estado inicial
 *   v2 → fix staleness post-NEXUS deploy 2026-05-28: HTML ya no se cachea
 */
const CACHE = "tops-nexus-v2";

const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/logo-isologo-primary.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => {
        /* sin-conexión durante install — ok, se hidrata en runtime */
      })
    )
  );
  // Toma control inmediato — sin esperar al close-all-tabs habitual.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1. Borra todos los caches que no son el actual (incluye 'tops-orders-v1' viejo).
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      // 2. Reclama todos los clients abiertos para servirles la versión nueva.
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Nunca interceptar auth, API ni navegación con credentials/cookies sensibles.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login")
  ) {
    return;
  }

  // Static assets versionados — cache-first (los hashes garantizan invalidación natural).
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy));
              }
              return res;
            })
            .catch(() => cached)
      )
    );
    return;
  }

  // HTML / app shell — network-only. Si falla red, intenta cache como fallback offline.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((cached) => cached || caches.match("/manifest.webmanifest"))
      )
    );
    return;
  }

  // Otros GETs: dejá pasar a la red (no interceptar).
});

// Mensaje opcional para forzar limpieza desde la app:
//   navigator.serviceWorker.controller?.postMessage({ type: "PURGE" })
self.addEventListener("message", (event) => {
  if (event.data?.type === "PURGE") {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      })()
    );
  }
});
