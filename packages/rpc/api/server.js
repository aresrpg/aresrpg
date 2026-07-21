// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AresRPG RPC — read-only HTTP JSON API (SPEC §14).
//
// Serves preprocessed views of AresRPG on-chain state from the indexer's Redis
// cache. Read-only and keyless by construction: it signs nothing and writes no
// game state — only its own per-IP rate-limit counters. Vanilla Bun.serve, no
// framework, per repo conventions.
//
// Routes:
//   GET /health       — process liveness (never rate-limited)
//   GET /v1/status    — indexer watermark + lag from Redis
//   GET /v1/characters | /v1/owner-items | /v1/listings | /v1/sales-history | /v1/pools | /v1/shop |
//       /v1/zones | /v1/encyclopedia | /v1/config | /v1/kolizeum | /v1/dungeon-runs | /v1/commissions |
//       /v1/fights | /v1/protector-trigger | /v1/fight-results | /v1/pending-outcomes |
//       /v1/pet-claims | /v1/taux | /v1/rare-links
//                     — preprocessed §14 views over the indexer's Redis cache
//   GET /v1/parties?character=<id> — the character's party membership
//   GET /v1/names     — D52 SuiNS reverse resolution (chain-direct GraphQL + Redis TTL
//                       cache, see suins.js — NOT an indexer view)
//   GET /v1/suins?name=<name> — SuiNS forward resolution through the same keyless GraphQL lane
//   GET /v1/sponsor/remaining — per-zkLogin daily sponsor allowance remaining (reads the
//                       shared money-counter api/sponsor.mjs INCRBYs — NOT an indexer view)
//
// Config (env): PORT, REDIS_URL, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC, NETWORK,
//               NAMES_CACHE_TTL_SEC, SENTRY_DSN (error reporting, report.js — absent = no-op).

import { cache_control_for } from './cache_policy.js'
import { check_rate_limit } from './rate_limit.js'
import { init_reporting, report_error } from './report.js'
import { to_response } from './respond.js'
import { ROUTES } from './routes.js'
import { handle_fight_events, handle_health } from './views.js'

init_reporting()

const PORT = Number(process.env.PORT ?? 3000)

// Edge-cache classes (2026-07-15: a player on a VN network measured a ~700ms floor on EVERY /v1 read —
// the origin is EU; without Cache-Control, Cloudflare never edge-caches JSON, so every poll crossed the
// planet). `s-maxage` = shared/CDN TTL only (browsers keep revalidating via the ETag above); catalog
// endpoints are seed-derived and change only on reseed/admin writes, so short TTLs + SWR are honest.
// PERSONAL/LIVE endpoints (player rosters, fights, post-tx reconcile reads) are explicitly `no-store` —
// a cached read there would lie to the predict+reconcile loop.
// Best-effort client IP: a trusted proxy/CDN sets X-Forwarded-For; fall back to
// the socket address.
function client_ip(req, server) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return server.requestIP(req)?.address ?? 'unknown'
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const { pathname, searchParams } = new URL(req.url)

    if (req.method !== 'GET') {
      return to_response({ status: 405, data: { error: 'method_not_allowed' } }, req)
    }

    // Liveness — never rate-limited.
    if (pathname === '/health') return to_response(handle_health(), req)

    // Static exact-match routes + the ONE dynamic route: /v1/fights/{id}/events (the
    // per-fight event journal — a path parameter, so it cannot live in the exact-match map).
    const handler = ROUTES[pathname]
    const journal_match = pathname.match(/^\/v1\/fights\/([^/]+)\/events$/)
    if (!handler && !journal_match) {
      return to_response({ status: 404, data: { error: 'not_found', path: pathname } }, req)
    }

    // Per-IP rate limit, backed by the same Redis.
    const rl = await check_rate_limit(client_ip(req, server))
    const rl_headers = {
      'x-ratelimit-limit': String(rl.limit),
      'x-ratelimit-remaining': String(rl.remaining),
    }
    if (!rl.allowed) {
      return to_response(
        { status: 429, data: { error: 'rate_limited', limit: rl.limit, retry_after_seconds: rl.retry_after } },
        req,
        { ...rl_headers, 'retry-after': String(rl.retry_after) }
      )
    }

    // The journal picks its OWN cache-control per response (immutable past pages are
    // cache-forever; any page touching the live head is no-store), so honour `resp.cache`
    // instead of the static per-route policy — mirroring the edge-cache header block below.
    if (journal_match) {
      const resp = await handle_fight_events(decodeURIComponent(journal_match[1]), searchParams)
      const journal_cache = resp.cache ?? 'no-store'
      return to_response(resp, req, {
        ...rl_headers,
        'cache-control': journal_cache,
        ...(journal_cache !== 'no-store' && { 'access-control-allow-origin': '*' }),
      })
    }

    const cache_control = cache_control_for(pathname)
    return to_response(await handler(searchParams), req, {
      ...rl_headers,
      'cache-control': cache_control,
      // shared-cacheable routes serve ONE variant to everyone — see respond.js's CORS note
      ...(cache_control !== 'no-store' && { 'access-control-allow-origin': '*' }),
    })
  },
  // The one surface fetch()'s own try/catches don't cover: anything thrown OUT of a
  // route handler (a view bug, not a modeled refusal) lands here instead of Bun's
  // default error page. report_error no-ops without SENTRY_DSN — same response either way.
  error(error) {
    report_error(error, { area: 'fetch' })
    return Response.json({ error: 'internal_error' }, { status: 500 })
  },
})

console.log(`aresrpg-rpc-api listening on http://localhost:${server.port}`)
