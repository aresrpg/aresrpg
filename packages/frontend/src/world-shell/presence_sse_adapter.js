// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// WORLD-PRESENCE SSE — TRANSPORT ONLY (#1384). Presence stops being a guess: the read layer terminates every
// stream, so an open connection IS presence — no heartbeat protocol, no relay weather, no backgrounding shim
// (the tab dies → the socket closes → the server emits the leave). This module maps frames to the typed
// `stream_current` / `stream_join` / `stream_leave` inputs and hands them to the caller's `input`; set
// ownership, identity and every projection stay in @aresrpg/world's presence fold.
//
// It is also the world's ONE inbound link (#1508): `src/courier/world.js` opens it with the courier's frame
// table merged into the presence one, so peer poses and chat lines arrive on the same connection and fold
// through the same door. Adding a vocabulary means adding rows to `frames`, never a second EventSource.
//
// THE WIRE (packages/rpc/indexer/src/stream.rs, #1382): `GET /v1/stream/presence/{world_id}` with
// `?address=` and/or `?character=` — the route 400s when BOTH are missing (`:422-426`), because the query is
// how this connection registers itself in the world's registry (`:427-431`). Frames are named: `current-set`
// carrying `{ world, presence: [...] }` (`:453-457`), then `join` / `leave` carrying ONE record
// `{ world, address?, character? }` (`:473-484`). A record's identity here is its character id, falling back
// to its wallet address for an address-only (spectating) connection — the same key `stream_leave` removes by.
//
// GIVING UP HONESTLY: an EventSource retries FOREVER by default. Attempts spend REJOIN_MAX_ATTEMPTS — the
// presence link's own budget, one home — and the ceiling closes the source with a `failed` status + reason, in
// the SAME `link_status` / `link_error` vocabulary the world chat's link chip already renders.

import { REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'
import { courier_presence_url } from '@aresrpg/sdk/courier'

import { RPC_URL } from '../env'

/** One server presence record → the row the fold keys. `id` is the character, else the bare wallet. */
const to_row = (record) => {
  const id = record?.character ?? record?.character_id ?? record?.id ?? record?.address ?? null
  return id ? { id: String(id), address: record.address ?? '', world: record.world ?? null } : null
}

/**
 * ONE named presence frame → its typed presence input, or null when the frame carries nothing foldable.
 * @param {{ data?: string }} event
 * @param {'current-set'|'join'|'leave'} type the SSE event name (frames are always named on this topic)
 */
export function presence_stream_message(event, type) {
  let body
  try {
    body = JSON.parse(event?.data ?? '')
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  if (type === 'current-set') return { type: 'stream_current', rows: (body.presence ?? []).map(to_row).filter(Boolean) }
  const row = to_row(body)
  if (!row) return null
  return type === 'join' ? { type: 'stream_join', row } : { type: 'stream_leave', id: row.id }
}

/**
 * THE presence vocabulary as a frame table — one SSE event name → the typed inputs that frame delivers.
 * The courier's own vocabulary (`positions` / `position` / `chat`) rides the SAME connection and joins this
 * table at the call site, so a world has exactly one link and one fold, never a second transport.
 */
export const presence_frames = Object.fromEntries(
  ['current-set', 'join', 'leave'].map((type) => [
    type,
    (event) => [presence_stream_message(event, type)].filter(Boolean),
  ])
)

/**
 * Open ONE world-presence stream. Returns the closer.
 * @param {{
 *   world: string, address?: string|null, character?: string|null,
 *   input: (message:any, now:number) => void, base_url?: string,
 *   frames?: Record<string, (event:{ data?: string }) => any[]>,
 *   event_source_factory?: (url:string) => any, now?: () => number,
 *   set_status?: (status:string, error?:string|null) => void, max_attempts?: number,
 * }} options
 */
export function open_presence_stream({
  world,
  address = null,
  character = null,
  input,
  base_url = RPC_URL,
  frames = presence_frames,
  event_source_factory = (url) => new EventSource(url),
  now = Date.now,
  set_status = () => {},
  max_attempts = REJOIN_MAX_ATTEMPTS,
}) {
  const source = event_source_factory(courier_presence_url(base_url, world, { address, character }))
  let status = 'idle'
  let attempts = 0
  let closed = false

  const announce = (next, error = null) => {
    if (closed || next === status) return
    status = next
    set_status(next, error)
  }

  const receive = (decode) => (event) => {
    attempts = 0
    announce('connected')
    for (const message of decode(event)) input(message, now())
  }

  for (const [type, decode] of Object.entries(frames)) source.addEventListener?.(type, receive(decode))
  source.addEventListener?.('open', () => {
    attempts = 0
    announce('connected')
  })
  source.addEventListener?.('error', () => {
    if (source.readyState === 2 || (attempts += 1) > max_attempts) {
      source.close()
      return announce('failed', `Presence stream unavailable after ${attempts} attempts`)
    }
    announce('reconnecting')
  })
  announce('connecting')

  return () => {
    if (closed) return
    closed = true
    source.close()
  }
}
