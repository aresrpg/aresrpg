// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One stateless API process: the station sponsor keeps its established routes while its courier sibling owns
// ephemeral position/chat ingress. The presence-stream sibling can add its /v1/stream route at this router seam.

import { courier_fetch } from './courier.mjs'
import { require_station_config, sponsor_fetch } from './sponsor.mjs'
import { report_error } from './report.js'

export async function api_fetch(request) {
  const { pathname } = new URL(request.url)
  if (pathname === '/v1/courier/position' || pathname === '/v1/courier/chat') return courier_fetch(request)
  return sponsor_fetch(request)
}

if (typeof Bun !== 'undefined' && import.meta.main) {
  const network = process.env.VITE_NETWORK || 'testnet'
  const port = Number(process.env.SPONSOR_PORT || 9528)
  require_station_config()
  // Preserve the image-smoke contract while naming the newly shared process on the next line.
  console.log(`[sponsor] station-only net=${network} :${port}`)
  console.log(`[courier] position/chat routes mounted on :${port}`)
  Bun.serve({
    port,
    fetch: api_fetch,
    error(error) {
      report_error(error, { area: 'fetch' })
      return Response.json({ error: 'internal_error' }, { status: 500 })
    },
  })
}
