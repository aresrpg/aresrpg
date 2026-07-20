// Forward SuiNS read view. This stays separate from the Redis-backed projection views because its
// upstream is the API's existing keyless Mysten GraphQL lane (suins.js), not an indexer document.

import { fetch_address_from_chain } from './suins.js'

const bad = (message) => ({ status: 400, data: { error: 'bad_request', message } })

// GET /v1/suins?name=<canonical dotted name>
//   found           → 200 { name, address }
//   missing/expired → 404 { found: false }
export async function handle_suins(params, resolve_address = fetch_address_from_chain) {
  const name = params.get('name')?.trim()
  if (!name) return bad('provide ?name=<SuiNS name>')

  try {
    const address = await resolve_address(name)
    if (!address) return { status: 404, data: { found: false } }
    return { status: 200, data: { name, address } }
  } catch (error) {
    console.error(`[suins] forward resolution failed for ${name}:`, error.message)
    return { status: 502, data: { error: 'upstream_unavailable' } }
  }
}
