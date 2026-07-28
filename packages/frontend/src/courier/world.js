// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One browser edge for the stateless courier: a public world presence SSE inbound, zkLogin-authenticated
// position/chat POSTs outbound, and a trailing position coalescer that stays under the shared 2/s hard gate.

import { courier_challenge, post_courier_chat, post_courier_position } from '@aresrpg/sdk/courier'

import { COURIER_URL, RPC_URL } from '../env'
import { game_log } from '../core/log.js'
import { presence_input, presence_store } from '../world-shell/presence_adapter.js'
import { open_presence_stream, presence_frames } from '../world-shell/presence_sse_adapter.js'

const POSITION_MIN_INTERVAL_MS = 500
const AUTH_REUSE_MS = 4 * 60_000
const GROUP_CHANNEL = 'CHAT_GROUP'
const FIGHT_CHANNEL = 'CHAT_FIGHT'

let close_stream = null
let active_world = null
let active_identity = null
let active_party = null
let auth_cache = null
let auth_in_flight = null
let pending_position = null
let position_timer = null
let position_in_flight = false
let last_position_post_at = Number.NEGATIVE_INFINITY
const fight_stream_listeners = new Set()

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

/**
 * ONE courier row → the typed presence inputs it delivers. Pure by design: the transport folds, this decides.
 * A `positions` snapshot is just the many-row case of the same decode. Our OWN chat line comes back down this
 * same wire (the courier publishes to the world channel we are subscribed to) — that round trip IS the sender
 * echo, so there is no second optimistic path to disagree with it.
 */
export function courier_inputs(row, party_id = null) {
  if (Array.isArray(row?.positions)) return row.positions.flatMap((position) => courier_inputs(position, party_id))
  if (row?.type === 'position') {
    const { character: id, x, z, heading } = row
    if (!id || !Number.isFinite(x) || !Number.isFinite(z)) return []
    return [{ type: 'peer_pos', id, x, y: z, yw: Number.isFinite(heading) ? heading : undefined }]
  }
  if (row?.type !== 'chat') return []
  if (row.channel === FIGHT_CHANNEL) return []
  if (row.channel === GROUP_CHANNEL && (!row.party || row.party !== party_id)) return []
  return [
    {
      type: 'chat_received',
      row: {
        id: row.character,
        message: row.text,
        address: row.address,
        name: '',
        channel: row.channel,
        target: row.target ?? '',
      },
    },
  ]
}

/** Deliver one validated courtesy signal to every app-lifetime fight consumer. */
export function deliver_fight_stream(signal) {
  for (const listener of fight_stream_listeners) listener(signal)
}

/** Subscribe the live fight courtesy fold to the courier edge. */
export function subscribe_fight_stream(listener) {
  fight_stream_listeners.add(listener)
  return () => fight_stream_listeners.delete(listener)
}

const decode_fight_stream = (row) => {
  if (row?.type !== 'chat' || row.channel !== FIGHT_CHANNEL) return
  if (row.party && row.party !== active_party) return
  try {
    const signal = JSON.parse(row.text)
    if (
      !signal?.dungeon_id ||
      !signal?.address ||
      signal.address !== row.character ||
      !['placement', 'batch'].includes(signal.kind)
    )
      return
    deliver_fight_stream(signal)
  } catch (error) {
    game_log('courier', 'fight courtesy decode failed', error)
  }
}

const decode_courier_frame = (event) => {
  try {
    const row = JSON.parse(event.data)
    decode_fight_stream(row)
    return courier_inputs(row, active_party)
  } catch (error) {
    game_log('courier', 'presence event decode failed', error)
    return []
  }
}

/** The courier's vocabulary on the shared world link: the join snapshot, live poses, and chat lines. */
const courier_frames = {
  positions: decode_courier_frame,
  position: decode_courier_frame,
  chat: decode_courier_frame,
}

/**
 * Join (or re-identify on) one world's public presence stream — the ONE inbound link, carrying both the
 * read layer's presence vocabulary and the courier's. The route registers this connection by identity, so a
 * link that can name neither a character nor a wallet is refused before framing and is never opened.
 */
export function join_courier(world, character = null, address = null) {
  if (!world || typeof EventSource === 'undefined') return
  const identity = `${character ?? ''}:${address ?? ''}`
  if (close_stream && active_world === world && active_identity === identity) {
    presence_input({ type: 'session', character_id: character })
    return
  }
  close_stream?.()
  close_stream = null
  presence_input({ type: 'reset' })
  presence_input({ type: 'session', character_id: character })
  active_world = world
  active_identity = identity
  if (!character && !address)
    return game_log('courier', 'presence link not opened — this session names neither a character nor a wallet')
  close_stream = open_presence_stream({
    world,
    address,
    character,
    input: presence_input,
    base_url: RPC_URL,
    frames: { ...presence_frames, ...courier_frames },
    set_status: (status, error) => game_log('courier', `presence link ${status}`, error),
  })
}

export function leave_courier() {
  close_stream?.()
  close_stream = null
  active_world = null
  active_identity = null
  active_party = null
  pending_position = null
  if (position_timer) clearTimeout(position_timer)
  position_timer = null
  presence_input({ type: 'reset' })
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

/** Best-effort fight previews share the authenticated chat ingress but never enter visible chat history. */
export function broadcast_fight_stream(signal) {
  if (!signal?.address) return
  void post_chat(signal.address, JSON.stringify(signal), FIGHT_CHANNEL, '', active_party)
}
