/* FaroLocal — service worker de la app del peatón (alcance /app/).
   · Cascarón (HTML/JS/CSS/fuentes/íconos): red primero, caché como respaldo → abre sin conexión y no se queda con código viejo.
   · /api/zona (mapa, dato público): red primero; sin conexión sirve el último mapa guardado (marcado con X-Desde-Cache).
   · Resto de /api (contactos, SOS, rutas, cupones…): NUNCA se guarda en caché (datos personales); sin conexión fallan con mensaje.
   Para publicar cambios de archivos del cascarón, sube VERSION. */
const VERSION = "faro-app-v5";
const CASCARON = [
  "/app/", "/app/app.css", "/app/app.js", "/app/nucleo.js", "/app/acceso.js", "/app/ficha.js", "/app/ruta.js", "/app/cupones.js",
  "/app/contactos.js", "/app/reportes.js", "/app/sos.js", "/app/pwa.js", "/app/manifest.webmanifest",
  "/app/icons/icon-192.png", "/app/icons/icon-512.png", "/app/icons/icon-maskable-512.png", "/app/icons/apple-touch-icon.png", "/assets/linterna.png", "/assets/logo-farolocal.png",
  "/shared/tema.css", "/shared/api.js", "/shared/mapa.js", "/shared/auth.js", "/vendor/qrcode.js",
  "/vendor/fonts/montserrat.woff2", "/vendor/fonts/nunito-sans.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CASCARON)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function redPrimero(req, claveCache) {
  const cache = await caches.open(VERSION);
  try {
    const r = await fetch(req);
    if (r.ok) cache.put(claveCache || req, r.clone());
    return r;
  } catch (_) {
    const g = await cache.match(claveCache || req, { ignoreSearch: !claveCache });
    if (g) return g;
    throw _;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname === "/api/zona") {
    e.respondWith((async () => {
      try {
        const cache = await caches.open(VERSION);
        const r = await fetch(req);
        if (r.ok) cache.put("/api/zona", r.clone());
        return r;
      } catch (_) {
        const g = await (await caches.open(VERSION)).match("/api/zona");
        if (!g) return new Response(JSON.stringify({ error: "Sin conexión y aún no hay un mapa guardado. Conéctate una vez para descargarlo." }), { status: 503, headers: { "Content-Type": "application/json" } });
        const h = new Headers(g.headers); h.set("X-Desde-Cache", "1");
        return new Response(await g.blob(), { status: 200, headers: h });
      }
    })());
    return;
  }
  if (url.pathname.startsWith("/portal")) return;         // el portal nunca se guarda en caché
  if (url.pathname.startsWith("/api/")) return;           // nada de datos personales en caché

  e.respondWith((async () => {
    try { return await redPrimero(req); }
    catch (_) {
      if (req.mode === "navigate") { const p = await caches.match("/app/"); if (p) return p; }
      return new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
