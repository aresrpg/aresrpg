// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One browser edge for the stateless courier: a public world presence SSE inbound, zkLogin-authenticated
// position/chat POSTs outbound, and a trailing position coalescer that stays under the shared 2/s hard gate.
//
// PRESENCE IS THE READ LAYER'S (#1641). The inbound link is `/v1/stream/presence/:world` — an open connection
// IS presence, and its `current-set`/`join`/`leave` frames are the one home for who is in this world. This
// module reports that link's own status onto the presence atom (the chip renders the atom, so a live stream
// can never read as an idle one), and it never invents a presence signal of its own.
//
// A REFUSED POST IS NOT A SILENT ONE. `courier_refusal` is the single home for what each refusal means: a 401
// drops the cached signature so the very next send re-signs (the #1640 cascade used to freeze sending for the
// whole 4-minute reuse window, recoverable only by a page refresh), a 400 is our bug and is reported loudly,
// and a refused CHAT send always tells the player their line did not go out.

import { courier_challenge, post_courier_chat, post_courier_position } from '@aresrpg/sdk/courier'

import { COURIER_URL, RPC_URL } from '../env'
import { game_log } from '../core/log.js'
import {
  publish_room_chat,
  publish_room_party_chat,
  publish_room_position,
  publish_room_state,
  set_room_local_cosmetic,
  set_room_party,
} from '../p2p/lobby-room.js'
import { presence_input, presence_store } from '../world-shell/presence_adapter.js'
import { open_presence_stream, presence_frames } from '../world-shell/presence_sse_adapter.js'

const POSITION_MIN_INTERVAL_MS = 500
const AUTH_REUSE_MS = 4 * 60_000
// The stream spends a finite reconnect budget and then closes for good — honest, but permanent: presence stayed
// dead until a page refresh. A failed link re-opens on this slow schedule, and immediately when the browser
// itself says the network is back. Nothing is remembered across the gap: a re-opened stream re-reads the world.
const RELINK_DELAY_MS = 30_000
const GROUP_CHANNEL = 'CHAT_GROUP'
const FIGHT_CHANNEL = 'CHAT_FIGHT'

let close_stream = null
let active_world = null
let active_identity = null
let link_target = null
let relink_timer = null
let courier_link_status = 'idle'
let active_party = null
let auth_cache = null
let auth_in_flight = null
let pending_position = null
let position_timer = null
let position_in_flight = false
let last_position_post_at = Number.NEGATIVE_INFINITY
const fight_stream_listeners = new Set()

/**
 * ONE home for what a refused courier POST MEANS — pure, so the policy is testable and the caller performs
 * the effects. `kind` is the send that was refused ('chat' | 'position').
 * @param {{ status?: number, code?: string }} error a CourierError from the SDK seam
 * @param {'chat'|'position'} kind
 */
export function courier_refusal(error, kind) {
  const status = Number(error?.status) || 0
  return {
    status,
    code: error?.code ?? 'unknown',
    // 401 — the cached challenge/signature is stale or rejected. Drop it: the next send re-signs by itself.
    resign: status === 401,
    // 400 — we sent something the endpoint calls invalid. It never self-heals, so it is reported loudly, once.
    report: status === 400 || status >= 500,
    // A chat line is a player ACT (they must learn it did not go out); a position is machinery, and a toast
    // per refused pose would be a spam cannon.
    toast: kind !== 'chat' ? null : status === 429 ? 'world_chat.send_rate_limited' : 'world_chat.send_failed',
  }
}

/** Execute that one policy. The loud/player-facing legs ride lazy failure-path imports, so the headless
 *  presence tests never pull the toast store or the reporter in merely by importing this module. */
async function courier_refused(kind, error) {
  const refusal = courier_refusal(error, kind)
  game_log('courier', `${kind} POST refused`, refusal.code, error)
  if (refusal.resign) auth_cache = null
  if (refusal.report)
    await import('../core/report.js')
      .then(({ report_error }) => report_error(error, { area: 'courier', kind, code: refusal.code }))
      .catch(() => {})
  if (refusal.toast)
    await Promise.all([import('../toast'), import('../i18n')])
      .then(([{ use_toast }, { default: i18n }]) => use_toast.getState().add(i18n.t(refusal.toast), 'error'))
      .catch(() => {})
}

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
function join_courier_transport(world, character, address) {
  const identity = `${character ?? ''}:${address ?? ''}`
  if (close_stream && active_world === world && active_identity === identity) return
  close_stream?.()
  close_stream = null
  clear_relink()
  active_world = world
  active_identity = identity
  link_target = null
  if (!character && !address)
    return game_log('courier', 'presence link not opened — this session names neither a character nor a wallet')
  link_target = { world, character, address }
  open_link()
}

/**
 * Join only the legacy courier transport. Scene room membership is an independent sibling owned by the scene
 * boundary; courier construction, identity refusal, and reconnect failure never touch room lifecycle/state.
 */
export function join_courier(world, character = null, address = null) {
  if (!world) return
  if (typeof EventSource !== 'undefined') join_courier_transport(world, character, address)
}

/** Open the ONE inbound link for the current target. Re-entrant: a relink closes the dead source first. */
function open_link() {
  if (!link_target) return
  const { world, character, address } = link_target
  close_stream?.()
  close_stream = open_presence_stream({
    world,
    address,
    character,
    input: presence_input,
    base_url: RPC_URL,
    frames: { ...presence_frames, ...courier_frames },
    set_status: on_link_status,
  })
}

/** The link's status is presence STATE, not a log line: it goes on the atom the chip reads (#1641) — and a
 *  link that gave up schedules its own return, so presence recovers without a page refresh. */
function on_link_status(status, error) {
  game_log('courier', `presence link ${status}`, error)
  courier_link_status = status
  if (status === 'failed') arm_relink()
}

const clear_relink = () => {
  if (relink_timer) clearTimeout(relink_timer)
  relink_timer = null
}

function arm_relink(delay = RELINK_DELAY_MS) {
  if (relink_timer || !link_target) return
  const timer = setTimeout(() => {
    relink_timer = null
    open_link()
  }, delay)
  timer.unref?.() // never hold a test/node process open on a pending relink
  relink_timer = timer
}

// The browser's own recovery signal beats any schedule: a laptop waking up relinks now, not in 30 seconds.
if (typeof window !== 'undefined')
  window.addEventListener?.('online', () => {
    if (!link_target || courier_link_status !== 'failed') return
    clear_relink()
    open_link()
  })

export function leave_courier() {
  close_stream?.()
  close_stream = null
  clear_relink()
  link_target = null
  active_world = null
  active_identity = null
  courier_link_status = 'idle'
  active_party = null
  pending_position = null
  if (position_timer) clearTimeout(position_timer)
  position_timer = null
}

export function sync_party_room(party_id) {
  active_party = party_id ?? null
  set_room_party(party_id)
}

/** Publish room-only identity state through the public social-transport home. */
export function broadcast_state(state) {
  publish_room_state(state)
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
    await courier_refused('position', error)
  } finally {
    position_in_flight = false
    if (pending_position && !position_timer) position_timer = setTimeout(flush_position, POSITION_MIN_INTERVAL_MS)
  }
}

/** Coalesce movement to the newest pose and publish at most twice per second. */
export function broadcast_position(world, character, x, z, heading = 0, height = 0) {
  if (!world || !character) return
  presence_input({ type: 'my_cell', x, y: z, yw: heading })
  publish_room_position(character, x, z, height, heading)
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
    await courier_refused('chat', error)
  }
}

export function broadcast_chat(character, name, message, channel, target = '') {
  publish_room_chat(character, name, message, channel, target)
  void post_chat(character, message, channel, target, null)
}

export function broadcast_party_chat(character, name, message, channel, target = '') {
  if (!active_party) return
  publish_room_party_chat(character, name, message, channel, target)
  void post_chat(character, message, channel, target, active_party)
}

/** Publish room-only live cosmetic state through the public social-transport home. */
export function set_local_cosmetic(partial) {
  set_room_local_cosmetic(partial)
}

/** Best-effort fight previews share the authenticated chat ingress but never enter visible chat history. */
export function broadcast_fight_stream(signal) {
  if (!signal?.address) return
  void post_chat(signal.address, JSON.stringify(signal), FIGHT_CHANNEL, '', active_party)
}
