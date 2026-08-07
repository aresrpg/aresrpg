// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One stateless API process: the station sponsor and its routes. Ephemeral social traffic (position, chat,
// presence) is NOT served here and never was meant to be — it rides browser↔browser, docs/REALTIME.md lane 2.
// The ONE exception is NAT traversal's credential mint (`/turn-credentials`, #1792): it carries no traffic and
// stores nothing — it only spends the coturn secret a browser may never hold, and it lives here because this is
// already the process that holds this domain's server-side secrets.

import {
  CORS,
  UNTRUSTED_IDENTITY_ERROR,
  UNTRUSTED_IDENTITY_REASON,
  client_identity,
  rate_limited,
  require_station_config,
  sponsor_fetch,
} from './sponsor.mjs'
import { ADDR_DAILY_CAP_MIST, publish_addr_daily_cap } from './sponsor_state.mjs'
import { TURN_UNCONFIGURED_ERROR, mint_turn_credentials } from './turn_credentials.mjs'
import { report_error } from './report.js'
import { SPONSOR_NETWORK } from './network.mjs'

const TURN_ROUTES = ['/turn-credentials', '/api/turn-credentials']

// No login gate: a minted pair authorizes exactly one thing — relaying already end-to-end-encrypted bytes
// through coturn, inside its own `user-quota` / `total-quota` / `max-bps` envelope — and gating it on login
// would leave the logged-out backdrop's presence link unreachable behind symmetric NAT. What it is NOT is an
// ANONYMOUS mint: the same edge-vouched identity and the same window the sponsor rations money on ration this
// too, and an identity the edge did not vouch for is refused rather than throttled against a caller-chosen key.
async function turn_credentials_fetch(request, server) {
  const identity = client_identity({
    read_header: (name) => request.headers.get(name),
    peer: server?.requestIP?.(request)?.address,
  })
  if (identity == null)
    return Response.json(
      { error: UNTRUSTED_IDENTITY_ERROR, reason: UNTRUSTED_IDENTITY_REASON },
      { status: 503, headers: CORS }
    )
  if (await rate_limited(identity)) return Response.json({ error: 'rate limited' }, { status: 429, headers: CORS })
  const minted = mint_turn_credentials()
  // An unconfigured relay REFUSES out loud. A pair minted against a missing secret authenticates against
  // nothing, and the client would read the resulting ICE silence as "no peers" — the exact silent degrade
  // #1792 was filed for.
  if (!minted) return Response.json({ error: TURN_UNCONFIGURED_ERROR }, { status: 503, headers: CORS })
  // no-store: the pair is single-caller and expiring; a shared cache would hand one browser's credential to
  // the next and collapse every player onto one `user-quota`.
  return Response.json(minted, { headers: { ...CORS, 'cache-control': 'no-store' } })
}

// `server` is Bun.serve's own second fetch argument and the only holder of the socket peer address: the sponsor
// rate-limits on an identity the edge vouched for, and falls back to that peer where there is no edge (localnet).
// Threaded, never re-derived — a router that dropped it would silently hand the sponsor an unverifiable caller.
export async function api_fetch(request, server) {
  const url = new URL(request.url)
  if (request.method === 'GET' && TURN_ROUTES.includes(url.pathname)) return turn_credentials_fetch(request, server)
  return sponsor_fetch(request, server)
}

if (typeof Bun !== 'undefined' && import.meta.main) {
  const port = Number(process.env.SPONSOR_PORT || 9528)
  require_station_config()
  // #2197 — the enforced cap is published for the read-api's allowance bar BEFORE the first request, so the
  // number a player sees can only ever be the number this process enforces. Awaited: a boot that served
  // requests while the display had no cap to read would answer the very first allowance poll with a refusal.
  await publish_addr_daily_cap()
  console.log(`[sponsor] station-only net=${SPONSOR_NETWORK} :${port} addr-daily-cap=${ADDR_DAILY_CAP_MIST}`)
  Bun.serve({
    port,
    fetch: api_fetch,
    error(error) {
      report_error(error, { area: 'fetch' })
      return Response.json({ error: 'internal_error' }, { status: 500 })
    },
  })
}
