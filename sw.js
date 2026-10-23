/* ========================================================================
   Service Worker · Simulador de Movimiento Vertical (PWA)
   Host: https://tecdea.github.io/lanzavertical/
   -------------------------------------------------------------------
   Este SW está acotado al subdirectorio /lanzavertical/ para NO
   interferir con el service worker ni con el manifest del portal
   principal alojado en la raíz del dominio.

   Medidas de aislamiento:
   1. CACHE_NAME único y específico de la app
      (evita colisionar con la caché del SW del portal).
   2. APP_ASSETS con rutas absolutas a /lanzavertical/*
   3. Verificación de scope en el handler fetch: el SW solo intercepta
      peticiones GET same-origin cuyo pathname empiece por
      "/lanzavertical/". Cualquier otra petición (al portal o a otras
      subrutas) se deja pasar al network o al SW del portal.
   4. No se invoca skipWaiting agresivamente fuera de updates propias.
   ====================================================================== */

const APP_VERSION = 'v1.8';
const CACHE_NAME  = `lanzavertical-pwa-${APP_VERSION}`;
const APP_SCOPE   = '/lanzavertical/';

const APP_ASSETS = [
  '/lanzavertical/',
  '/lanzavertical/index.html',
  '/lanzavertical/manifest.json',
  '/lanzavertical/sw.js',
  '/lanzavertical/icons/favicon.svg',
  '/lanzavertical/icons/favicon-32.png',
  '/lanzavertical/icons/favicon-16.png',
  '/lanzavertical/icons/icon-192.png',
  '/lanzavertical/icons/icon-512.png',
  '/lanzavertical/icons/icon-maskable-512.png',
  '/lanzavertical/icons/apple-touch-icon.png',
  '/lanzavertical/icons/og-image.png'
];

/** Comprueba si una URL pertenece a nuestra app (mismo origen + dentro del scope). */
function isInScope(urlStr){
  try {
    const u = new URL(urlStr);
    if (u.origin !== self.location.origin) return false;
    return u.pathname === APP_SCOPE ||
           u.pathname.startsWith(APP_SCOPE) ||
           u.pathname === '/lanzavertical' ||
           u.pathname.startsWith('/lanzavertical?');
  } catch { return false; }
}

/* ---------- Instalación: precachea solo nuestros assets ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(
        APP_ASSETS.map((url) => cache.add(url).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Activación: limpia versiones anteriores SOLO de nuestra caché ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          // Solo borra cachés que empiezan por nuestro prefijo
          // (no toca las cachés que pueda usar el portal)
          .filter((k) => k.startsWith('lanzavertical-pwa-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- Fetch: cache-first dentro de nuestro scope ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET; el resto se ignora (deja al navegador o al SW del portal)
  if (req.method !== 'GET') return;

  // CRÍTICO: solo interceptamos peticiones dentro de /lanzavertical/
  // Cualquier otra ruta (/, /blog, /otra-app, etc.) se deja libre y
  // la gestiona el navegador o el SW del portal si lo hay.
  if (!isInScope(req.url)) return;

  // Navegación HTML dentro del scope: network-first con fallback a caché
  // (página offline de nuestra app, no la del portal).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() =>
          caches.match(req).then((c) => c || caches.match('/lanzavertical/index.html'))
        )
    );
    return;
  }

  // Resto de recursos dentro de scope: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});

/* ---------- Mensajería: actualización controlada + consulta de versión ---------- */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  // Permite a la página consultar la versión del SW activo
  if (data === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'APP_VERSION', version: APP_VERSION, cache: CACHE_NAME });
  }
});
