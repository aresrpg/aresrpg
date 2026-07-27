// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One browser edge for the stateless courier: a public world presence SSE inbound, zkLogin-authenticated
// position/chat POSTs outbound, and a trailing position coalescer that stays under the shared 2/s hard gate.

import { courier_challenge, courier_presence_url, post_courier_chat, post_courier_position } from '@aresrpg/sdk/courier'

import { COURIER_URL, RPC_URL } from '../env'
import { game_log } from '../core/log.js'
import { presence_input } from '../world-shell/presence_adapter.js'

const POSITION_MIN_INTERVAL_MS = 500
const AUTH_REUSE_MS = 4 * 60_000
const GROUP_CHANNEL = 'CHAT_GROUP'

let stream = null
let active_world = null
let active_party = null
let auth_cache = null
let auth_in_flight = null
let pending_position = null
let position_timer = null
let position_in_flight = false
let last_position_post_at = Number.NEGATIVE_INFINITY

async function courier_auth() {
  // Auth owns browser-only Enoki registration, so keep it behind the actual POST edge. Stream decode and every
  // headless presence test remain browser-free and never instantiate a wallet merely by importing this module.
  const { current_session, is_zklogin_session, SUI_CHAIN } = await import('../auth')
  const session = current_session()
  if (!session || !is_zklogin_session()) throw new Error('courier requires an active zkLogin session')
  const now = Date.now()
  if (auth_cache?.address === session.address && auth_cache.expires_at > now) return auth_cache
  if (auth_in_flight) return auth_in_flight
  auth_in_flight = (async () => {
    const signer = session.wallet.features['sui:signPersonalMessage']
    if (!signer?.signPersonalMessage) throw new Error('wallet does not support signPersonalMessage')
    const challenge = courier_challenge(session.address, now)
    const { signature } = await signer.signPersonalMessage({
      account: session.account,
      message: new TextEncoder().encode(challenge),
      chain: SUI_CHAIN,
    })
    auth_cache = {
      sender: session.address,
      challenge,
      signature,
      address: session.address,
      expires_at: now + AUTH_REUSE_MS,
    }
    return auth_cache
  })()
  try {
    return await auth_in_flight
  } finally {
    auth_in_flight = null
  }
}

/** Fold one courier row through the existing presence door. Exported for the wire-contract unit test. */
export function ingest_courier_event(row, input = presence_input, party_id) {
  const current_party = party_id === undefined ? active_party : party_id
  if (Array.isArray(row?.positions)) {
    row.positions.forEach((position) => ingest_courier_event(position, input, current_party))
    return
  }
  if (row?.type === 'position') {
    const { character: id, x, z, heading } = row
    if (!id || !Number.isFinite(x) || !Number.isFinite(z)) return
    input({ type: 'peer_pos', id, x, y: z, yw: Number.isFinite(heading) ? heading : undefined })
    return
  }
  if (row?.type !== 'chat') return
  if (row.channel === GROUP_CHANNEL && (!row.party || row.party !== current_party)) return
  input({
    type: 'chat_received',
    row: {
      id: row.character,
      message: row.text,
      address: row.address,
      name: '',
      channel: row.channel,
      target: row.target ?? '',
    },
  })
}

function receive(event) {
  try {
    ingest_courier_event(JSON.parse(event.data))
  } catch (error) {
    game_log('courier', 'presence event decode failed', error)
  }
}

/** Join (or re-identify on) one world's public presence stream. */
export function join_courier(world) {
  if (!world || typeof EventSource === 'undefined') return
  if (stream && active_world === world) return
  stream?.close()
  active_world = world
  stream = new EventSource(courier_presence_url(RPC_URL, world))
  stream.onmessage = receive
  stream.addEventListener('position', receive)
  stream.addEventListener('chat', receive)
  stream.addEventListener('positions', receive)
  stream.onerror = (error) => game_log('courier', 'presence stream interrupted — EventSource will retry', error)
}

export function leave_courier() {
  stream?.close()
  stream = null
  active_world = null
  active_party = null
  pending_position = null
  if (position_timer) clearTimeout(position_timer)
  position_timer = null
}

export function sync_party_room(party_id) {
  active_party = party_id ?? null
}

async function flush_position() {
  position_timer = null
  if (position_in_flight || !pending_position) return
  const wait = Math.max(0, POSITION_MIN_INTERVAL_MS - (Date.now() - last_position_post_at))
  if (wait > 0) {
    position_timer = setTimeout(flush_position, wait)
    return
  }
  const position = pending_position
  pending_position = null
  position_in_flight = true
  last_position_post_at = Date.now()
  try {
    const auth = await courier_auth()
    await post_courier_position({ base_url: COURIER_URL, ...position, ...auth })
  } catch (error) {
    game_log('courier', 'position POST refused', error)
  } finally {
    position_in_flight = false
    if (pending_position && !position_timer) position_timer = setTimeout(flush_position, POSITION_MIN_INTERVAL_MS)
  }
}

/** Coalesce movement to the newest pose and publish at most twice per second. */
export function broadcast_position(world, character, x, z, heading = 0) {
  if (!world || !character) return
  presence_input({ type: 'my_cell', x, y: z, yw: heading })
  pending_position = { world, character, x, z, heading }
  void flush_position()
}

async function post_chat(character, text, channel, target, party) {
  if (!active_world || !character || !text) return
  try {
    const auth = await courier_auth()
    await post_courier_chat({
      base_url: COURIER_URL,
      world: active_world,
      character,
      text,
      channel,
      target,
      party,
      ...auth,
    })
  } catch (error) {
    game_log('courier', 'chat POST refused', error)
  }
}

export function broadcast_chat(character, _name, message, channel, target = '') {
  void post_chat(character, message, channel, target, null)
}

export function broadcast_party_chat(character, _name, message, channel, target = '') {
  if (!active_party) return
  void post_chat(character, message, channel, target, active_party)
}
