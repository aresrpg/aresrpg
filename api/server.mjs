// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One stateless API process: the station sponsor and its routes. Ephemeral social traffic (position, chat,
// presence) is NOT served here and never was meant to be — it rides browser↔browser, docs/REALTIME.md lane 2.

import { require_station_config, sponsor_fetch } from './sponsor.mjs'
import { report_error } from './report.js'

// `server` is Bun.serve's own second fetch argument and the only holder of the socket peer address: the sponsor
// rate-limits on an identity the edge vouched for, and falls back to that peer where there is no edge (localnet).
// Threaded, never re-derived — a router that dropped it would silently hand the sponsor an unverifiable caller.
export async function api_fetch(request, server) {
  return sponsor_fetch(request, server)
}

if (typeof Bun !== 'undefined' && import.meta.main) {
  const network = process.env.VITE_NETWORK || 'testnet'
  const port = Number(process.env.SPONSOR_PORT || 9528)
  require_station_config()
  console.log(`[sponsor] station-only net=${network} :${port}`)
  Bun.serve({
    port,
    fetch: api_fetch,
    error(error) {
      report_error(error, { area: 'fetch' })
      return Response.json({ error: 'internal_error' }, { status: 500 })
    },
  })
}
