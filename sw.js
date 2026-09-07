/* ─────────────────────────────────────────────────────────────────
   SERVICE WORKER — offline app shell

   Deliberately conservative. The single biggest failure mode of a
   service worker on a live app is *stale code*: a user pinned to a
   months-old bundle because the SW served cache before network. So
   the policy here is network-first for everything we handle, with
   the cache acting purely as an offline fallback:

     · navigations        → network, fall back to cached index.html
     · same-origin GET    → network (and refresh the cache), fall
                            back to cache when the network fails
     · /api/*             → never touched. The AI endpoints and any
                            future serverless route always go
                            straight to the network; a cached answer
                            to a financial question is worse than no
                            answer.
     · cross-origin       → not intercepted, EXCEPT Google Fonts,
                            whose URLs are content-addressed and
                            immutable, so cache-first is safe there
                            and buys us correct typography offline.
                            Supabase traffic is never intercepted —
                            it carries auth and must not be cached.

   Because every response is revalidated against the network while
   online, bumping CACHE_VERSION is only needed when we want to
   actively evict old entries — not to ship new code.
───────────────────────────────────────────────────────────────── */

const CACHE_VERSION = 'v1';
const SHELL_CACHE   = `finance-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `finance-runtime-${CACHE_VERSION}`;
const FONT_CACHE    = `finance-fonts-${CACHE_VERSION}`;
const ALL_CACHES    = [SHELL_CACHE, RUNTIME_CACHE, FONT_CACHE];

// The minimum set that has to be present for a cold offline boot to
// paint something coherent. The JS module graph is intentionally NOT
// listed — it's large, it changes often, and runtime caching picks it
// up on the first online visit anyway. Keeping the precache list
// small also keeps install from failing on a single bad entry.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/variables.css',
  '/css/reset.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/pages.css',
  '/css/mobile.css',
  '/css/ux-v2.css',
  '/css/mobile-shell.css',
  '/manifest.webmanifest',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Add entries individually: cache.addAll() rejects the whole
    // install if any single request 404s, which would leave the app
    // with no service worker at all over one renamed file.
    await Promise.all(SHELL_ASSETS.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    // Take over immediately rather than waiting for every tab to
    // close — combined with network-first, a new worker can never
    // serve staler content than the old one would have.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('finance-') && !ALL_CACHES.includes(n))
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// Lets the page ask a waiting worker to activate at once (used by the
// update prompt in js/app.js).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // Everything else cross-origin (Supabase, stock quotes, FX) is left
  // entirely to the browser — no interception, no caching.
  if (url.origin !== self.location.origin) return;

  // Serverless routes always hit the network.
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(navigationHandler(req));
    return;
  }

  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

async function navigationHandler(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('/index.html', fresh.clone());
    return fresh;
  } catch (_) {
    // Offline: any navigation resolves to the cached shell. The app is
    // a single-page client, so the shell can render every screen once
    // its modules come out of the runtime cache.
    const cached = await caches.match('/index.html') || await caches.match('/');
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(req, cacheName) {
  try {
    const fresh = await fetch(req);
    // Only store real, complete responses. Opaque and error responses
    // would poison the cache with something we can't serve later.
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && (fresh.ok || fresh.type === 'opaque')) {
    const cache = await caches.open(cacheName);
    cache.put(req, fresh.clone());
  }
  return fresh;
}
