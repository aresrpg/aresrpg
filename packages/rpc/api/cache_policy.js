// Explicit shared/CDN cache allowlist. Every route absent from this map safely
// defaults to no-store; additions require an address-independent response.

export const EDGE_CACHE = Object.freeze({
  '/v1/encyclopedia': 'public, max-age=0, s-maxage=30, must-revalidate',
  '/v1/config': 'public, s-maxage=60, stale-while-revalidate=300',
  '/v1/shop': 'public, max-age=0, s-maxage=15, must-revalidate',
  '/v1/taux': 'public, s-maxage=60, stale-while-revalidate=300',
  '/v1/zones': 'public, s-maxage=10, stale-while-revalidate=30',
  '/v1/listings': 'public, s-maxage=5, stale-while-revalidate=15',
  '/v1/pools': 'public, s-maxage=10, stale-while-revalidate=30',
  '/v1/kolizeum': 'public, s-maxage=10, stale-while-revalidate=30',
  '/v1/status': 'public, s-maxage=3',
  '/v1/rare-links': 'public, s-maxage=30, stale-while-revalidate=120',
})

export const cache_control_for = (pathname) => EDGE_CACHE[pathname] ?? 'no-store'
