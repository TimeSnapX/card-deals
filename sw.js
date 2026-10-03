/*
 * Card Deal Checker service worker: makes the app installable and lets it
 * open offline. Deliberately small:
 * - Only same-origin GET requests inside /card-deals/ are handled. Price APIs
 *   (TCGdex, pokemontcg.io, Scryfall, YGOPRODeck), exchange rates, card images
 *   and fonts are cross-origin, so they are never intercepted or cached.
 * - Network first, so online behaviour is unchanged; the cache is only a
 *   fallback when the network fails (offline).
 * - Never touches localStorage (your watchlist lives there).
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const PREFIX = "card-deals-";
const CACHE = `${PREFIX}${VERSION}`;
const SCOPE = new URL(self.registration.scope);

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "css/app.css?v=1",
  "js/app.js?v=1",
  "js/core.js?v=1",
  "js/sources.js?v=1",
];

function handled(request) {
  if (request.method !== "GET") return false;
  if (request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return false;
  if (!url.pathname.startsWith(SCOPE.pathname)) return false;
  if (url.pathname === `${SCOPE.pathname}sw.js`) return false;
  return true;
}

function isPage(request) {
  return request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
}

function cacheKey(request) {
  const url = new URL(request.url);
  url.hash = "";
  if (isPage(request)) url.search = "";
  return url.href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          SHELL.map((path) =>
            fetch(new Request(new URL(path, SCOPE).href, { cache: "reload" }))
              .then((res) => (res.ok ? cache.put(new URL(path, SCOPE).href, res) : null))
              .catch(() => null),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!handled(request)) return;
  const key = cacheKey(request);
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE);
        const hit = (await cache.match(key)) || (await cache.match(request.url, { ignoreSearch: isPage(request) }));
        if (hit) return hit;
        if (isPage(request)) {
          const shell = (await cache.match(SCOPE.href)) || (await cache.match(new URL("index.html", SCOPE).href));
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
