// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LANE 2 of docs/REALTIME.md — ephemeral social, browser↔browser. Trystero over OUR OWN MQTT relay does the
// peer introduction; after the handshake every byte rides the RTCDataChannel and the relay carries nothing.
//
// WHY OURS AND ONLY OURS: this layer shipped against five PUBLIC nostr relays, and they rate-limited us into a
// fight stall on 2026-07-27. The transport was killed for a day and a client→server courier stood in — client
// state writes, which law 2 forbids outright. The convicted party was the third-party relay, never p2p: one
// self-hosted stateless broker turns that failure mode into infrastructure we run. There is exactly ONE relay
// URL and no fallback list — a dead relay must say DOWN, not degrade into a second system. The strategy is one
// import line (`@trystero-p2p/mqtt`); swapping brokers changes nothing else in this file.
//
// FIGHT TRUTH NEVER RIDES THIS. Fight state, receipts and journals stay off the room; the fight journal's
// chain→indexer→SSE path is its only transport. The ONE sanctioned neighbour is the PRESENTATION COURTESY
// overlay (`courtesy_action` below, docs/REALTIME.md "the fight-turn overlay") — a between-commits preview that
// carries no truth, gates no input, and reaches no transaction. This file's half of that fence is mechanical:
// the courtesy action is the only action here that does NOT touch `presence_input`, and it writes no store at
// all — it hands the raw signal to app-lifetime subscribers and nothing else.
//
// THE ROOM IS THE WORLD. `join_room(world_id, …)` keys the trystero room by world id, so JOINING IS THE
// ANNOUNCEMENT and a peer in my room is — by construction, not by a carried field — in my world. That is the
// whole presence registry; there is no server-side one to disagree with (#1698).
//
// THE TRANSPORT ADAPTER of @aresrpg/world's presence core: every received action dispatches a TYPED INPUT
// through the presence door (`presence_input`), and the send paths read the ATOM (my cell / state / cosmetic).
// The cheater-plausibility drop and the liveness expiry live in the FOLD; this file keeps exactly the transport
// facts — the room, the send actions, the peer_id→character routing map, and the link's own health.

import { joinRoom, getRelaySockets } from '@trystero-p2p/mqtt'
import { pauseRelayReconnection, resumeRelayReconnection } from '@trystero-p2p/core'
import { PEER_HEARTBEAT_MS, REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'
import { presence_store, presence_input } from '../world-shell/presence_adapter.js'
import { NETWORK, RELAY_URL, STUN_FALLBACK_URL, STUN_URL, TURN_CRED, TURN_URL, TURN_USER } from '../env'

const APP_ID = `aresrpg-world-lobby-${NETWORK}`
// ONE relay, ours (env.ts RELAY_URL is its single home). trystero reads `relayConfig.urls` — passing the list
// explicitly means the strategy's baked-in PUBLIC broker defaults are never dialled, which is the entire point.
// No `redundancy`: @trystero-p2p/core's getRelays returns `relayConfig.urls` verbatim when present and consults
// redundancy only when slicing its OWN defaults, so a redundancy field here would be inert config pretending to
// mean something. Relay redundancy is pods behind the one hostname, decided in the cluster, not in this bundle.
const relay_config = { urls: [RELAY_URL] }

// WebRTC ICE — public STUN discovers a direct path; TURN would relay the bytes for the minority whose NAT
// never lets one form. TURN stays opt-in via VITE_TURN_URL and its absence is ANNOUNCED at join (below)
// rather than silently degrading a symmetric-NAT player into an empty world.
const RTC_CONFIG = {
  iceServers: [
    { urls: [STUN_URL, ...(STUN_FALLBACK_URL ? [STUN_FALLBACK_URL] : [])] },
    ...(TURN_URL ? [{ urls: [TURN_URL], username: TURN_USER, credential: TURN_CRED }] : []),
  ],
}

// ── THE LINK'S OWN SCHEDULE — edge-local, by the core's own division of labour ────────────────────────────────
// @aresrpg/world's presence fold owns WHAT the link is (`link_status`, one writer, one input) and how long a
// silent peer lives (PEER_EXPIRY_MS, spent by `tick`). The transport owns the socket and the schedule on which
// it comes back — so these three live here, beside the timers that read them, and only the protocol constants
// (heartbeat cadence, retry budget) are imported from the core.
const LINK_HEALTH_POLL_MS = 3_000
const LINK_GRACE_MS = 8_000 // fresh sockets connect async — never judge a link dead inside its own handshake
const REJOIN_JITTER_MS = 1_000 // de-synchronize a whole world's tabs reconnecting off one relay blip

let room = null
let room_world = null
let room_generation = 0
let pos_action = null
let chat_action = null
let party_chat_action = null
let state_action = null
let courtesy_action = null
/** App-lifetime consumers of the fight-turn PRESENTATION overlay. A set, not a store: the transport must not
 *  own presentation state, and a courtesy signal with zero subscribers must cost nothing. */
const courtesy_listeners = new Set()
// Party chat is a distinct ACTION on the existing world-room data channel. `party_room_id` is only the local
// routing scope; it never creates a second Trystero room (and therefore never doubles relay announcements).
let party_room_id = null
/** @type {Map<string, string>} trystero peer_id → the on-chain character_id it broadcasts as — the one
 * transport-level routing fact that stays OUTSIDE the atom (the core never sees trystero peer ids). */
const peer_characters = new Map()
/** Peer ids for which Trystero exchanged signaling/SDP but could not open an RTC channel. `getPeers()` exposes
 * only OPEN channels, so `onJoinError` is the transport's sole honest evidence that an empty room is not an
 * empty population. A new room generation clears the evidence; a successful channel clears its own peer. */
const unreachable_peers = new Set()

/** The live session id — read from the atom (the transport's own-echo filter + send guard). */
const my_character_id = () => presence_store.getState().character_id
const direct_peer_count = () => Object.keys(room?.getPeers?.() ?? {}).length
const connected_relays = () =>
  Object.values(getRelaySockets?.() ?? {}).filter((/** @type {any} */ socket) => socket?.readyState === 1).length

/** THE one link writer. Status is presence STATE, not a log line: the chat chip renders the atom, so a live
 *  room can never read as an idle one and a dead one can never read as connected (#1641). */
const set_link = (status, error = null) => presence_input({ type: 'link', status, error })

/** Compose + send our `state` off the ATOM (my_state + my_cosmetic merged). ONE room primitive:
 *  publish_room_state, set_room_local_cosmetic, and the peer-join replay all route through here. */
function _send_state(target) {
  const { character_id, my_state, my_cosmetic } = presence_store.getState()
  if (!character_id || !my_state) return
  state_action?.send({ id: character_id, ...my_state, ...my_cosmetic }, target ? { target } : undefined).catch(() => {})
}

/**
 * Join (or re-identify on) one world's lobby room. Idempotent — a second call for the same world and identity
 * is a no-op, so React remounts never churn the transport.
 * @param {string | null} world_id the room key: peers in it ARE the players in this world.
 * @param {string | null} character_id our own on-chain character id — every broadcast carries it so peers
 *   resolve our real name/class/color through the SAME chain read-model. Pass `null` for read-only SPECTATE:
 *   the room is joined as a SILENT LISTENER (no id ⇒ every send path guards itself off), so the backdrop sees
 *   the live world and broadcasts nothing.
 * @param {{ x: number, y: number }} [initial_cell] our spawn cell — SEEDS the atom's my_cell so a peer whose
 *   connection activates before we ever MOVE still gets a position the instant onPeerJoin fires.
 */
export function join_room(world_id, character_id = null, initial_cell) {
  if (!world_id) return game_log('p2p', 'lobby not joined — this session names no world')
  const active_character_id = my_character_id()
  // A resident A→B swap (or a world change) is a NEW network identity: leave first so peers receive A's
  // departure before the replacement announces. Mutating the atom in place would leave A as a ghost until the
  // freshness timeout expires it.
  if (room && (room_world !== world_id || (active_character_id && character_id !== active_character_id))) leave_room()
  if (room) {
    // The spectate→session UPGRADE: a silent listener's room (joined with a null id on the logged-out backdrop)
    // RE-IDENTIFIES on login instead of tearing down — same room, no reconnect churn.
    if (character_id && !my_character_id()) {
      presence_input({ type: 'session', character_id })
      if (initial_cell) presence_input({ type: 'my_cell', ...initial_cell })
      // A pre-identify publish parked in the atom flushes the moment we have an id.
      if (presence_store.getState().my_state) _send_state()
    }
    return
  }
  presence_input({ type: 'session', character_id: character_id ?? null })
  if (initial_cell) presence_input({ type: 'my_cell', ...initial_cell })
  set_link('connecting')
  resumeRelayReconnection()
  _build_room(world_id)
  _start_watchdogs()
}

// ── SELF-HEAL — the presence link survives connection death with NO refresh ───────────────────────────────────
// The transport can silently die (a relay outage, or a WebRTC channel that freezes without a clean onPeerLeave)
// and until this block existed nothing detected it, so peer lists froze until a full page refresh on BOTH ends:
//  · a periodic HEARTBEAT re-broadcasts my last cell so a stationary peer stays provably alive, and a periodic
//    `tick` folds out anyone gone silent past the core's PEER_EXPIRY_MS (an honest count over a frozen one);
//  · a health poll spends the core's REJOIN_MAX_ATTEMPTS budget on a dead link and then says `failed` WITH its
//    reason, instead of retrying forever behind a chip that claims everything is fine.
// The bookkeeping here is pure scheduling; every branch reports through the ONE `link` input, and no callback
// ever writes a store directly.
let rejoin_timer = null
let rejoin_attempt = 0
let rejoin_in_flight = false
let link_grace_until = 0
let watchdog_interval = null
let heartbeat_interval = null
let online_handler = null
let visibility_handler = null
let watchdogs_started = false

/** Build (or REBUILD, on a rejoin) the trystero room + its actions/handlers. The presence ATOM (my facts + the
 *  peer table) SURVIVES a rebuild — only the dead transport is replaced — so the re-announce has facts to send
 *  and peers that truly left expire via the tick. */
function _build_room(world_id) {
  const generation = ++room_generation
  link_grace_until = Date.now() + LINK_GRACE_MS
  unreachable_peers.clear()
  room_world = world_id
  // The room id is the world id, and trystero hashes it into the topic (sha1 → base36, no separators), so the
  // broker's single-level topic ACL holds for any world id we ever mint.
  room = joinRoom({ appId: APP_ID, rtcConfig: RTC_CONFIG, relayConfig: relay_config }, world_id, {
    // Trystero emits this only after a remote room member reached signaling but peer setup failed. That is
    // the distinction the relay-up/zero-channel case needs: no callback means connected-and-alone is true.
    onJoinError: ({ peerId }) => {
      if (generation === room_generation && peerId) unreachable_peers.add(peerId)
    },
  })
  pos_action = room.makeAction('pos')
  chat_action = room.makeAction('chat')
  party_chat_action = room.makeAction('pchat')
  state_action = room.makeAction('state')
  courtesy_action = room.makeAction('fstream')

  // RECEIVE → typed inputs through the presence door. The plausibility drop and own-echo filtering live in the
  // FOLD (the core knows the session id via the `session` input); this adapter only routes and maps peer ids.
  pos_action.onMessage = (data, { peerId }) => {
    const { id, x, y, h, yw } = /** @type {any} */ (data ?? {})
    if (!id || typeof x !== 'number' || typeof y !== 'number') return
    if (id !== my_character_id()) peer_characters.set(peerId, id)
    // `h` carries the broadcast WORLD height (0 = unknown → the renderer ground-scans); `yw` is the remote
    // rig's true facing.
    presence_input({ type: 'peer_pos', id, x, y, h, yw })
  }

  chat_action.onMessage = (data) => {
    const { id, message, name, channel, target } = /** @type {any} */ (data ?? {})
    presence_input({ type: 'chat_received', row: { id, message, address: id, name, channel, target } })
  }

  // Party chat shares the same direct data channel as every other action. The exact current party id is carried
  // and receiver-filtered, so a whole-room broadcast never leaks a line into another party's log.
  party_chat_action.onMessage = (data) => {
    const { party_id, id, message, name, channel, target } = /** @type {any} */ (data ?? {})
    if (!party_id || party_id !== party_room_id) return
    presence_input({ type: 'chat_received', row: { id, message, address: id, name, channel, target } })
  }

  state_action.onMessage = (data, { peerId }) => {
    const row = /** @type {any} */ (data ?? {})
    if (!row.id) return
    if (row.id !== my_character_id()) peer_characters.set(peerId, row.id)
    presence_input({ type: 'peer_state', ...row })
  }

  // THE FIGHT-TURN PRESENTATION OVERLAY, and the only action here that folds nothing. Shape is all this seam
  // judges: WHO may act and whether the preview is legal is the fight core's single home (`apply_peer_batch`
  // sim-verifies the broadcaster's own seat, then pre-paints or drops+flags), so a transport-side identity or
  // legality check here would be a second home for a rule that already has one.
  courtesy_action.onMessage = (data) => {
    const signal = /** @type {any} */ (data ?? {})
    if (!signal.dungeon_id || !signal.address) return
    if (signal.kind !== 'placement' && signal.kind !== 'batch') return
    for (const listener of courtesy_listeners) listener(signal)
  }

  room.onPeerLeave = (peerId) => {
    const id = peer_characters.get(peerId)
    peer_characters.delete(peerId)
    if (id) presence_input({ type: 'peer_leave', id })
  }

  // The instant a new peer's data channel is ready, hand it our current position + state DIRECTLY instead of
  // waiting for our next move — both read from the ATOM. Without this, two tabs that both stand still never
  // exchange a packet and each renders an empty world.
  room.onPeerJoin = (peerId) => {
    const { character_id, my_cell } = presence_store.getState()
    unreachable_peers.delete(peerId)
    if (character_id && my_cell) pos_action?.send({ id: character_id, ...my_cell }, { target: peerId }).catch(() => {})
    if (character_id) _send_state(peerId)
    rejoin_attempt = 0
    set_link('connected')
  }

  // Flush any pre-join parked state now that the actions exist (publish/join order-independence).
  if (my_character_id() && presence_store.getState().my_state) _send_state()

  // NO SILENT DEGRADE: without TURN, a player behind a symmetric NAT will reach the relay, complete signaling,
  // and then never form a data channel — an empty world that looks exactly like an empty world. Say so once, at
  // the seam that knows, so the failure is legible instead of inferred.
  if (!TURN_URL)
    game_log(
      'p2p',
      'ICE is STUN-only — TURN credentials are not minted yet, so peers behind a symmetric NAT will fail to connect'
    )
}

/** HEARTBEAT — re-broadcast my last cell so a peer that stands still is still provably alive on the other
 *  side's expiry clock. This is the producer PEER_HEARTBEAT_MS was named for. No-op with no id/cell. */
function _heartbeat() {
  const { character_id, my_cell } = presence_store.getState()
  if (character_id && my_cell) pos_action?.send({ id: character_id, ...my_cell }).catch(() => {})
}

/** RE-ANNOUNCE — push my cell + state to the WHOLE room so both sides reconverge after a recovery without
 *  anyone refreshing. */
function _reannounce() {
  const { character_id, my_cell } = presence_store.getState()
  if (character_id && my_cell) pos_action?.send({ id: character_id, ...my_cell }).catch(() => {})
  if (character_id) _send_state()
}

/** REJOIN — await teardown before rebuilding. Trystero keeps a room registered during its async leave delay;
 *  rebuilding synchronously would return that same doomed room and turn the recovery schedule into churn. */
async function _rejoin() {
  if (rejoin_in_flight || !room_world) return
  rejoin_in_flight = true
  const previous_room = room
  room = null
  peer_characters.clear() // trystero peer ids are stale after a leave; the character rows persist in the atom
  try {
    await previous_room?.leave()
  } catch {
    // A dead transport may reject its courtesy leave send. Teardown proceeds regardless; the retry budget owns
    // whether another room may be built at all.
  } finally {
    rejoin_in_flight = false
  }
  if (!watchdogs_started || room) return
  _build_room(room_world)
  _reannounce()
}

/** Terminal state: stop room announcements and trystero's relay-socket retry engine. The presence atom stays
 *  mounted so the chat header renders the failure instead of silently disappearing it. */
function _retire_failed_room(reason) {
  report_error(new Error(reason), {
    area: 'p2p',
    action: 'lobby_room_watchdog',
    world: room_world,
    reason,
  })
  set_link('failed', reason)
  pauseRelayReconnection()
  const failed_room = room
  room = null
  room_generation += 1
  _clear_room_actions()
  peer_characters.clear()
  unreachable_peers.clear()
  Promise.resolve(failed_room?.leave()).catch(() => {})
}

/** LINK HEALTH — an active RTCDataChannel is the primary truth: relay loss during a live direct session must
 *  never tear down the game channel. With no direct peer, the relay sockets are the signaling lifeline.
 *  Relay-up is connected-and-alone UNLESS Trystero saw another member and failed its channel; after the same
 *  fresh-room grace, that evidence derives `degraded` instead of painting an empty world green (D3a). */
function _health_check() {
  const peer_count = direct_peer_count()
  const relay_count = connected_relays()
  if (peer_count > 0 || relay_count > 0) {
    rejoin_attempt = 0
    if (rejoin_timer) {
      clearTimeout(rejoin_timer)
      rejoin_timer = null
    }
    const status =
      peer_count === 0 && relay_count > 0 && unreachable_peers.size > 0 && Date.now() >= link_grace_until
        ? 'degraded'
        : 'connected'
    if (presence_store.getState().link_status !== status) set_link(status)
    return
  }
  if (Date.now() < link_grace_until || rejoin_timer || rejoin_in_flight) return
  if (presence_store.getState().link_status === 'failed') return
  rejoin_attempt += 1
  if (rejoin_attempt > REJOIN_MAX_ATTEMPTS)
    return _retire_failed_room(`Signaling relay unreachable after ${REJOIN_MAX_ATTEMPTS} attempts`)
  set_link('reconnecting')
  const delay = Math.min(30_000, 2 ** rejoin_attempt * 1_000) + Math.random() * REJOIN_JITTER_MS
  const timer = setTimeout(() => {
    rejoin_timer = null
    void _rejoin()
  }, delay)
  timer.unref?.() // never hold a test/node process open on a pending rejoin
  rejoin_timer = timer
}

/** Arm the self-heal watchdogs ONCE per lobby session (idempotent). Cleared by leave_room. */
function _start_watchdogs() {
  if (watchdogs_started) return
  watchdogs_started = true
  watchdog_interval = setInterval(() => {
    _health_check()
    presence_input({ type: 'tick' }) // expire peers gone silent past the core's PEER_EXPIRY_MS
  }, LINK_HEALTH_POLL_MS)
  watchdog_interval.unref?.()
  heartbeat_interval = setInterval(_heartbeat, PEER_HEARTBEAT_MS)
  heartbeat_interval.unref?.()
  if (typeof window !== 'undefined') {
    // The browser's own recovery signal beats any schedule: a laptop waking up retries now, not in 30 seconds.
    online_handler = () => _recover()
    window.addEventListener('online', online_handler)
  }
  if (typeof document !== 'undefined') {
    visibility_handler = () => {
      // BACKGROUNDING: our heartbeat interval is about to be throttled by the browser, but visibilitychange is
      // an EVENT, not a timer, so it fires un-throttled right now. One last re-announce gives every peer a
      // fresh last_seen at the exact transition instant — real margin on top of the PEER_EXPIRY_MS floor.
      if (document.hidden) return _reannounce()
      _recover()
    }
    document.addEventListener('visibilitychange', visibility_handler)
  }
}

/** A network/visibility return: spend a fresh budget. A link that had already given up gets one honest new
 *  chance here — the alternative is a `failed` chip that outlives the outage until a page refresh. */
function _recover() {
  if (!room_world) return
  rejoin_attempt = 0
  link_grace_until = Date.now() + LINK_GRACE_MS
  if (presence_store.getState().link_status === 'failed') {
    set_link('connecting')
    resumeRelayReconnection()
    void _rejoin()
    return
  }
  _health_check()
  _reannounce()
}

function _clear_room_actions() {
  pos_action = null
  chat_action = null
  party_chat_action = null
  state_action = null
  courtesy_action = null
}

function _stop_watchdogs() {
  watchdogs_started = false
  if (rejoin_timer) clearTimeout(rejoin_timer)
  rejoin_timer = null
  rejoin_attempt = 0
  if (watchdog_interval) clearInterval(watchdog_interval)
  watchdog_interval = null
  if (heartbeat_interval) clearInterval(heartbeat_interval)
  heartbeat_interval = null
  if (online_handler && typeof window !== 'undefined') window.removeEventListener('online', online_handler)
  online_handler = null
  if (visibility_handler && typeof document !== 'undefined')
    document.removeEventListener('visibilitychange', visibility_handler)
  visibility_handler = null
  link_grace_until = 0
}

/** Broadcast our current cell — call ONLY on an actual cell change (the caller throttles). `h` is the WORLD
 *  height (feet y) and `yw` the facing in radians. The atom records it (the peer-join replay reads it back);
 *  the wire send is the effect. */
export function publish_room_position(character_id, x, y, h = 0, yw = 0) {
  presence_input({ type: 'my_cell', x, y, h, yw })
  pos_action?.send({ id: character_id, x, y, h, yw }).catch(() => {})
}

/** Broadcast a chat line to every peer in the lobby room. */
export function publish_room_chat(character_id, name, message, channel, target = '') {
  chat_action?.send({ id: character_id, name, message, channel, target }).catch(() => {})
}

/**
 * Set the PARTY chat routing scope. Party messages use the existing world room's `pchat` action and carry this
 * id for receiver-side filtering, so changing party causes zero signaling joins/leaves.
 * @param {string | null} party_id the on-chain Party object id (null = not in a party)
 */
export function set_room_party(party_id) {
  party_room_id = party_id ?? null
}

/** Broadcast a party-scoped line over the shared direct data channel — no-op while solo. */
export function publish_room_party_chat(character_id, name, message, channel, target = '') {
  if (!party_room_id) return
  party_chat_action?.send({ party_id: party_room_id, id: character_id, name, message, channel, target }).catch(() => {})
}

/**
 * Broadcast our LOW-FREQUENCY presence state (wallet address + avatar colors + current party + current dungeon
 * + the identity peers render before the chain read resolves) — call only when one of these actually changes,
 * never on the position tick. `dungeon_id` (null = overworld) drives the instance render-scope.
 * @param {{ address: string, color_1: number, color_2: number, color_3: number, party_id?: string | null,
 *   dungeon_id?: string | null, classe?: string | null, male?: boolean | null, name?: string | null }} state
 */
export function publish_room_state(state) {
  // Seed the ATOM first — a publish that beats join_room (mount-order race) must SURVIVE to the join/upgrade
  // flush; the atom is the park, the flush reads it back.
  presence_input({ type: 'my_state', state })
  _send_state()
}

/**
 * Set THIS client's live cosmetic session flags (mount ride + veteran aura) and re-broadcast so peers render
 * them within one state RTT. Merged into every `state` send, so toggling a mount never clobbers the party
 * payload. `mounted` is not decoration: it is the speed headroom peers grant me in their plausibility check.
 * @param {{ mounted?: boolean, mount_glb?: string | null, veteran?: boolean }} partial
 */
export function set_room_local_cosmetic(partial) {
  presence_input({ type: 'my_cosmetic', partial })
  _send_state()
}

/**
 * Broadcast one fight-turn PRESENTATION signal (a placement ghost or a drafted batch preview) to the room.
 * LOSS-TOLERANT BY CONSTRUCTION: no room, no peers, or a rejected send are all silent no-ops, because losing a
 * courtesy frame costs latency and never correctness — the chain journal is what actually authors the fight.
 * @param {{ dungeon_id: string, address: string, kind: 'placement'|'batch' }} signal
 */
export function publish_room_courtesy(signal) {
  if (!signal?.address) return
  courtesy_action?.send(signal).catch(() => {})
}

/** Subscribe the fight-turn overlay to inbound courtesy signals. Returns the unsubscribe. */
export function subscribe_room_courtesy(listener) {
  courtesy_listeners.add(listener)
  return () => courtesy_listeners.delete(listener)
}

/** Leave the lobby room (scene teardown) — safe to call even if never joined. The atom resets: every ephemeral
 *  fact expires with the room, which is the freshness law. */
export function leave_room() {
  _stop_watchdogs()
  room?.leave()
  room = null
  room_generation += 1
  room_world = null
  _clear_room_actions()
  peer_characters.clear()
  unreachable_peers.clear()
  presence_input({ type: 'reset' })
}
