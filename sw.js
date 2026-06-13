// ============================================================
// HADAR BetAnalytics Pro — Service Worker
// Permet l'installation sur Android et le mode hors-ligne
// ============================================================

const CACHE_NAME = 'hadar-betanalytics-v1';
const ASSETS = [
  './betting-analyzer.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Installation ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installation...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => {
      console.log('[SW] Fichiers mis en cache');
      return self.skipWaiting();
    })
  );
});

// ── Activation ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch — Stratégie Network First ──────────────────────────
// Essaie d'abord le réseau, utilise le cache si hors-ligne
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne pas intercepter les appels API (localhost:3000)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return;
  }

  // Ne pas intercepter les appels Telegram et Anthropic
  if (url.hostname.includes('telegram') || url.hostname.includes('anthropic')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Mettre en cache si succès
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Hors-ligne : servir depuis le cache
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Page de fallback hors-ligne
          if (event.request.destination === 'document') {
            return caches.match('./betting-analyzer.html');
          }
        });
      })
  );
});

// ── Message depuis l'app ─────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
