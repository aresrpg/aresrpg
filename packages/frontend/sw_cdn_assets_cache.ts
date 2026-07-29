// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

interface CachedResponseUse {
  request: Request
  cachedResponse?: Response
}

// Workbox cache keys do not include request mode. Never hand a cors consumer an opaque response left by a
// no-cors request. This cache only admits 200 CORS responses now, so any opaque hit is stale/corrupt and can
// be rejected for every consumer; null is the cachedResponseWillBeUsed contract for "miss", so SWR refetches.
export const cdn_assets_cache_guard = {
  cachedResponseWillBeUsed: ({ cachedResponse }: CachedResponseUse): Response | null | undefined =>
    cachedResponse?.type === 'opaque' ? null : cachedResponse,
}

export const cdn_assets_runtime_cache = {
  urlPattern: /^https:\/\/assets\.aresrpg\.world\/.+/,
  handler: 'StaleWhileRevalidate' as const,
  options: {
    // v2 abandons every opaque entry written by the pre-#1598 cache; register_service_worker deletes v1.
    cacheName: 'cdn-assets-v2',
    // The host sends ACAO. Every network fill is therefore reusable by cors and no-cors consumers alike.
    fetchOptions: { mode: 'cors' as const },
    cacheableResponse: { statuses: [200] },
    expiration: { maxEntries: 800, maxAgeSeconds: 86400 },
    plugins: [cdn_assets_cache_guard],
  },
}
