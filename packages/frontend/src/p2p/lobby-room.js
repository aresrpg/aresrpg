// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Trystero-based serverless presence + chat for the World-tab lobby (final-design plan decision #2:
// "P2P = Trystero (nostr default, torrent fallback) — genuinely serverless"). No signaling server we
// run, no backend WS — Trystero's public nostr relays do peer discovery, then it's straight WebRTC.
//
// D770a W3b — THE TRANSPORT ADAPTER of @aresrpg/world's presence core. The WS-era synthetic `packet/*`
// re-emission shim that fed presence.js/chat.js is DEAD: every received action now dispatches a TYPED INPUT
// through the presence door (`presence_input`), and the send paths read the ATOM (my cell/state/cosmetic —
// the old module-scope side tables `last_seen` / `peer_state` / `my_last_*` dissolved into it). The
// CHEATER-PLAUSIBILITY DROP lives in the core fold now (headless-tested); this file keeps exactly the
// transport facts: the trystero rooms, the send actions, and the peer_id→character routing map.
// Party-invite / dungeon-share / fight-stream nudges remain transport→consumer bus events (party + fight
// domains — outside the presence atom).
//
// board #13 (WS-C wave C3a) — the three low-frequency signals (state / party_invite / dungeon_share) and the
// #49 fight-stream preview all reuse the same `room` — no second Trystero room, no server.
//
// P1-B FIX (two-tab bug): broadcast_position only fires on an ACTUAL cell change, so a peer
// who joins and stands still forever never emits a `pos` packet. Trystero's WebRTC handshake is per-PEER-
// CONNECTION, so `room.onPeerJoin` fires the instant a new peer's data channel opens — we push our LAST-KNOWN
// position + state (read from the presence ATOM) DIRECTLY to that one peer (SendOptions.target) the moment it
// appears, so two stationary tabs see each other within one RTT of the handshake completing.

import { joinRoom, getRelaySockets, pauseRelayReconnection, resumeRelayReconnection } from 'trystero'
import {
  peer_state_of,
  peer_state_by_address,
  peer_states_by_address,
  subscribe_rejoin,
  subscribe_reannounce,
  PEER_HEARTBEAT_MS,
  LINK_HEALTH_POLL_MS,
  LINK_GRACE_MS,
  REJOIN_JITTER_MS,
} from '@aresrpg/world/presence'

import { context } from '../game/core/game.js'
import { game_log } from '../core/log.js'
import { presence_store, presence_input } from '../world-shell/presence_adapter.js'
import { sync_party_room as sync_courier_party_room } from '../courier/world.js'

import { RELAY_URLS } from './relays.js'
import { suppress_periodic_room_announcements, trystero_room_topic } from './relay-signaling.js'

const NETWORK = import.meta.env.VITE_NETWORK || 'testnet'
const APP_ID = `aresrpg-world-lobby-${NETWORK}`
// EXPLICIT nostr rendezvous relays — the list itself lives in ./relays.js (its one home, shared with the
// boot-smoke gate); redundancy 3 of 5 is why a single dead relay is a non-event for discovery.
const RELAY_REDUNDANCY = 3
// Trystero uses every explicit URL and ignores `redundancy` when `urls` is present. Slice here so the configured
// fanout really is three relays instead of five signed copies of every signaling note.
const relay_config = { urls: RELAY_URLS.slice(0, RELAY_REDUNDANCY), redundancy: RELAY_REDUNDANCY }
const ROOM_ID = 'world'

// WebRTC ICE — STUN-first (direct P2P when the NAT allows it) + TURN fallback (relayed only when direct fails)
// for peers behind symmetric-NAT / corporate / mobile firewalls where UDP never forms. OWNER CONSTITUTIONAL LAW:
// ZERO hosted infra — free PUBLIC providers ONLY (no self-hosted coturn, ever). Resilience = STACK multiple free
// providers + multiple ports/transports so one provider's outage or a blocked port doesn't kill peer transport.
// Env-swappable (VITE_TURN_URL comma-separated + USER/CRED) to add/replace providers without a code change.
// Passed to the single Trystero room. (Signaling works over nostr/WSS regardless; TURN only rescues the data channel.)
const TURN_URLS = (
  import.meta.env.VITE_TURN_URL ||
  'turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turn:openrelay.metered.ca:443?transport=tcp,turns:openrelay.metered.ca:443'
)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)
const RTC_CONFIG = {
  iceServers: [
    // Multiple free public STUN servers (Google + Cloudflare) — redundant direct-connectivity discovery.
    {
      urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],
    },
    // Free public TURN — openrelay across ports 80/443 + TCP + TLS. Add a second provider via VITE_TURN_URL.
    {
      urls: TURN_URLS,
      username: import.meta.env.VITE_TURN_USER || 'openrelayproject',
      credential: import.meta.env.VITE_TURN_CRED || 'openrelayproject',
    },
  ],
}

let room = null
let state_action = null
let party_invite_action = null
let dungeon_share_action = null
let fight_stream_action = null
let commission_request_action = null
/** @type {Map<string, string>} trystero peer_id → the on-chain character_id it broadcasts as — the one
 * transport-level routing fact that stays OUTSIDE the atom (the core never sees trystero peer ids). */
const peer_characters = new Map()
const relay_root_topic = trystero_room_topic(APP_ID, ROOM_ID)
/** @type {Map<WebSocket, () => void>} */
const relay_announcement_restores = new Map()

/** The live session id — read from the atom (the transport's own-echo filter + send guard). */
const my_character_id = () => presence_store.getState().character_id
const direct_peer_count = () => Object.keys(room?.getPeers?.() ?? {}).length

/** Keep relay subscriptions + targeted SDP signaling live, but suppress Trystero's periodic root-room note once
 * a direct RTCDataChannel exists. New browsers still announce on the root topic; this client receives that note
 * and answers on the peer-specific topic. Re-run on health samples so a replaced relay socket is patched too. */
async function _suppress_relay_announcements() {
  const active_room = room
  const root_topic = await relay_root_topic
  if (!active_room || room !== active_room || direct_peer_count() === 0) return
  const sockets = new Set(Object.values(getRelaySockets?.() ?? {}))
  for (const [socket, restore] of relay_announcement_restores)
    if (!sockets.has(socket)) {
      restore()
      relay_announcement_restores.delete(socket)
    }
  for (const socket of sockets)
    if (!relay_announcement_restores.has(socket))
      relay_announcement_restores.set(socket, suppress_periodic_room_announcements({ relay: socket }, root_topic))
}

function _restore_relay_announcements() {
  for (const restore of relay_announcement_restores.values()) restore()
  relay_announcement_restores.clear()
}

function _clear_room_actions() {
  state_action = null
  party_invite_action = null
  dungeon_share_action = null
  fight_stream_action = null
  commission_request_action = null
}

/** TR-97 — compose + send our `state` off the ATOM (my_state + my_cosmetic merged). ONE send home:
 *  broadcast_state, set_local_cosmetic, and the peer-join replay all route through here. */
function _send_state(target) {
  const { character_id, my_state, my_cosmetic } = presence_store.getState()
  if (!character_id || !my_state) return
  const payload = { id: character_id, ...my_state, ...my_cosmetic }
  state_action?.send(payload, target ? { target } : undefined).catch(() => {})
}

/**
 * Join the serverless World-tab lobby room. Idempotent — a second call while already joined is a no-op.
 * @param {string | null} character_id our own on-chain character id — every broadcast carries it so peers
 *   resolve our real name/class/color through the SAME chain read-model. Pass `null` for read-only SPECTATE
 *   (feature #19): the room is joined as a SILENT LISTENER — with no id the caller never invokes a send
 *   action, so we receive every peer's presence but broadcast nothing.
 * @param {{ x: number, y: number }} [initial_cell] our spawn cell — SEEDS the atom's my_cell so a peer whose
 *   connection activates before we ever MOVE (P1-B) still gets a position the instant onPeerJoin fires.
 */
export function join_lobby(character_id, initial_cell) {
  // A resident A→B swap (or A→null spectate) is a NEW network identity. Leave/rejoin the shared room so peers
  // receive A's transport-level departure before the replacement announces; mutating the atom in place would
  // leave A as a ghost until the freshness timeout. The null→character upgrade below keeps its fast path.
  const active_character_id = my_character_id()
  if (room && active_character_id && character_id !== active_character_id) leave_lobby()
  if (room) {
    // D206 — the #19→session UPGRADE: a silent spectator's room (joined with null id on the logged-out
    // backdrop) RE-IDENTIFIES on login instead of tearing down — same room, no reconnect churn; the
    // first cell change / state change broadcasts under the real id.
    if (character_id && !my_character_id()) {
      presence_input({ type: 'session', character_id })
      if (initial_cell) presence_input({ type: 'my_cell', ...initial_cell })
      // D222: a pre-identify publish parked in the atom flushes the moment we have an id.
      if (presence_store.getState().my_state) {
        game_log(
          'p2p',
          `parked state FLUSHED on upgrade (classe=${presence_store.getState().my_state.classe ?? 'null'})`
        )
        _send_state() // TR-97 — merges the live cosmetic flags too
      }
    }
    return
  }
  presence_input({ type: 'session', character_id: character_id ?? null })
  if (initial_cell) presence_input({ type: 'my_cell', ...initial_cell })
  presence_input({ type: 'link_start' })
  resumeRelayReconnection()
  _build_room()
  _start_watchdogs()
}

// ── SELF-HEAL — the presence link survives connection death with NO refresh ────────────────────────────────────
// The transport can silently die (a nostr-relay outage, or a WebRTC channel that freezes without a clean
// onPeerLeave) — and until now nothing detected it, so peer lists froze until a full page refresh on BOTH ends.
// This block is the edge that executes the presence core's self-heal:
//  · a periodic HEARTBEAT re-broadcasts my last cell (reusing `pos`) so a stationary peer stays provably alive,
//    and a periodic `tick` folds out anyone gone silent past the core's PEER_EXPIRY_MS (honest count).
//  · a relay-health poll turns 0-connected-relays into a `room_lost` input and a recovered link into `rejoin_ok`;
//    online / visibility-return feed `network_recover`. Recovery is an EFFECT REQUEST the core makes and this edge
//    performs — a jittered/bounded rejoin, then a full re-announce so both sides reconverge. No callback set()s a
//    store; every branch dispatches a typed INPUT through the presence door.
// The edge-only bookkeeping (timers, in-flight guard, and the per-(re)join grace window) is pure scheduling —
// the game/roster state all lives in the reducer.
let rejoin_timer = null
let rejoin_in_flight = false
let link_grace_until = 0 // after each (re)join, don't judge the link dead until sockets have had time to connect
let watchdog_interval = null
let heartbeat_interval = null
let unsub_rejoin = null
let unsub_reannounce = null
let online_handler = null
let visibility_handler = null
let watchdogs_started = false

/** Build (or REBUILD, on a rejoin) the trystero lobby room + its actions/handlers. The presence ATOM (my facts +
 *  the peer table) SURVIVES a rebuild — only the dead transport is replaced — so the re-announce has facts to send
 *  and peers that truly left expire via the tick. */
function _build_room() {
  link_grace_until = Date.now() + LINK_GRACE_MS // fresh sockets connect async — grace the death judgment
  room = joinRoom({ appId: APP_ID, rtcConfig: RTC_CONFIG, relayConfig: relay_config }, ROOM_ID)
  state_action = room.makeAction('state')
  party_invite_action = room.makeAction('pinvite')
  dungeon_share_action = room.makeAction('dshare')
  fight_stream_action = room.makeAction('fstream')
  commission_request_action = room.makeAction('crequest')

  state_action.onMessage = (data, { peerId }) => {
    const row = /** @type {any} */ (data ?? {})
    if (!row.id) return
    if (row.id !== my_character_id()) peer_characters.set(peerId, row.id)
    presence_input({ type: 'peer_state', ...row })
    if (row.classe) game_log('p2p', `peer identity received: ${String(row.id).slice(0, 10)} = ${row.classe}`)
  }

  party_invite_action.onMessage = (data) => {
    const { to_address, party_id, invited_character_id, from_name } =
      /** @type {{ to_address: string, party_id: string, invited_character_id: string, from_name?: string }} */ (
        data ?? {}
      )
    context.events.emit('packet/partyInviteNudge', {
      to_address,
      party_id,
      invited_character_id,
      from_name: String(from_name ?? ''),
    })
  }

  dungeon_share_action.onMessage = (data) => {
    const { to_address, dungeon_id, template_id } =
      /** @type {{ to_address: string, dungeon_id: string, template_id: string }} */ (data ?? {})
    context.events.emit('packet/dungeonShare', { to_address, dungeon_id, template_id })
  }

  // board #49: STREAM-PREVIEW — the ACTIVE player's client relays its drafted move/cast targets (PRE-commit) so
  // party peers can render a live preview. Coordination/preview ONLY, NO tx (chain-authorship law): the receiver
  // sim-verifies + renders in fight-stream.js; the chain still authors via commit_turn. Filtered by dungeon_id on
  // the receiving side.
  fight_stream_action.onMessage = (data) => {
    const { dungeon_id, address, kind, target, intent_id, actions } =
      /** @type {{ dungeon_id: string, address: string, kind: string, target?: number, intent_id?: string, actions?: any[] }} */ (
        data ?? {}
      )
    if (!dungeon_id || !address || !kind) return
    context.events.emit('packet/fightStream', { dungeon_id, address, kind, target, intent_id, actions })
  }

  // COMMISSION REQUEST nudge — a customer sent an artisan-commission request; the presence core carries the
  // row (commission stream head) and the world-shell inbox subscribes to it. A whole-room broadcast (Trystero
  // has no targeted send for a non-peer address); the inbox ignores rows whose `to_address` isn't its own.
  commission_request_action.onMessage = (data) => {
    const row = /** @type {any} */ (data ?? {})
    if (!row.to_address) return
    presence_input({ type: 'commission_received', row })
  }

  room.onPeerLeave = (peerId) => {
    const id = peer_characters.get(peerId)
    peer_characters.delete(peerId)
    if (id) presence_input({ type: 'peer_leave', id })
    if (direct_peer_count() === 0) {
      _restore_relay_announcements()
      presence_input({ type: 'peer_disconnected' })
    }
  }

  // The instant a remaining courtesy/presence data channel is ready, hand it our low-frequency state directly.
  // Position replay now comes from the courier registry on the world presence stream.
  room.onPeerJoin = (peerId) => {
    // Diagnostic: a peer's data channel opened → we're in a SHARED room and
    // receiving. A read-only SPECTATOR (feature #19) sends nothing below but STILL sees this count climb.
    game_log('p2p', `peer joined · peers: ${Object.keys(room?.getPeers?.() ?? {}).length}`)
    const { character_id } = presence_store.getState()
    if (character_id) _send_state(peerId) // TR-97 — merges the live cosmetic flags too (guards on my_state)
    presence_input({ type: 'peer_connected' })
    void _suppress_relay_announcements()
  }

  // D222: flush any pre-join parked state now that the actions exist (publish/join order-independence).
  if (my_character_id() && presence_store.getState().my_state) {
    game_log('p2p', `parked state FLUSHED on join (classe=${presence_store.getState().my_state.classe ?? 'null'})`)
    _send_state() // TR-97 — merges the live cosmetic flags too
  }

  // QA diagnostic: sample nostr relay connectivity ONCE, a few seconds
  // after join so the async WebSocket handshakes have settled. relays>0 = p2p is live; one line per mount.
  setTimeout(() => {
    const sockets = Object.values(getRelaySockets?.() ?? {})
    const connected = sockets.filter((/** @type {any} */ s) => s?.readyState === 1)
    const errors = sockets.filter((/** @type {any} */ s) => s?.readyState === 3).map((/** @type {any} */ s) => s?.url)
    game_log('p2p', `joinRoom fired · relays connected: ${connected.length}/${relay_config.urls.length}`, { errors })
  }, 4000)
}

/** Remaining low-frequency presence heartbeat. Live positions are independently refreshed through the courier. */
function _heartbeat() {
  if (my_character_id()) _send_state()
}

/** Re-announce the remaining low-frequency state after a recovery. Position replay belongs to the SSE registry. */
function _reannounce() {
  if (my_character_id()) _send_state()
}

/** REJOIN — await teardown before rebuilding. Trystero keeps a room registered during its async leave delay;
 * rebuilding synchronously would return that same doomed room and turn the recovery schedule into churn. */
async function _rejoin() {
  if (rejoin_in_flight || presence_store.getState().link_status === 'failed') return
  rejoin_in_flight = true
  _restore_relay_announcements()
  const previous_room = room
  room = null
  peer_characters.clear() // trystero peer ids are stale after a leave; the character rows persist in the atom
  try {
    await previous_room?.leave()
  } catch {
    // A dead transport may reject its courtesy leave send. Teardown still proceeds; the finite retry state owns
    // whether another room may be built.
  } finally {
    rejoin_in_flight = false
  }
  if (!watchdogs_started || room || presence_store.getState().link_status === 'failed') return
  _build_room()
}

/** Terminal recovery state: stop room announcements and Trystero's relay-socket retry engine. The presence atom
 * remains mounted so the WorldChat header can render the failure instead of silently disappearing it. */
function _retire_failed_room() {
  pauseRelayReconnection()
  _restore_relay_announcements()
  const failed_room = room
  room = null
  _clear_room_actions()
  peer_characters.clear()
  Promise.resolve(failed_room?.leave()).catch(() => {})
}

/** LINK HEALTH — an active RTCDataChannel is the primary truth. Relay loss during that direct session must never
 * tear down the game channel. With no direct peer, relay sockets are the signaling-lifeline fallback. */
function _health_check() {
  if (direct_peer_count() > 0) {
    void _suppress_relay_announcements()
    if (presence_store.getState().rejoin_attempt > 0) {
      if (rejoin_timer) clearTimeout(rejoin_timer)
      rejoin_timer = null
      presence_input({ type: 'rejoin_ok' })
    } else if (presence_store.getState().link_status !== 'connected') presence_input({ type: 'peer_connected' })
    return
  }
  _restore_relay_announcements()
  const sockets = Object.values(getRelaySockets?.() ?? {})
  const connected = sockets.filter((/** @type {any} */ s) => s?.readyState === 1).length
  if (connected > 0) {
    if (presence_store.getState().rejoin_attempt > 0) {
      // recovered (our rejoin OR trystero's own relay reconnect) — cancel any pending teardown so a relay FLAP
      // never rejoins a room that just came back on its own, then reset the backoff + re-announce.
      if (rejoin_timer) clearTimeout(rejoin_timer)
      rejoin_timer = null
      presence_input({ type: 'rejoin_ok' })
    }
    return
  }
  if (
    Date.now() >= link_grace_until &&
    !rejoin_timer &&
    !rejoin_in_flight &&
    presence_store.getState().link_status !== 'failed'
  ) {
    presence_input({ type: 'room_lost' })
    if (presence_store.getState().link_status === 'failed') _retire_failed_room()
  }
}

/** Arm the self-heal watchdogs ONCE per lobby session (idempotent). Cleared by leave_lobby → _stop_watchdogs. */
function _start_watchdogs() {
  if (watchdogs_started) return
  watchdogs_started = true
  unsub_rejoin = subscribe_rejoin(presence_store, ({ delay }) => {
    if (rejoin_timer) clearTimeout(rejoin_timer)
    rejoin_timer = setTimeout(
      () => {
        rejoin_timer = null
        void _rejoin()
      },
      delay + Math.random() * REJOIN_JITTER_MS
    )
  })
  unsub_reannounce = subscribe_reannounce(presence_store, _reannounce)
  watchdog_interval = setInterval(() => {
    _health_check()
    presence_input({ type: 'tick' }) // expire peers gone silent past the core's PEER_EXPIRY_MS
  }, LINK_HEALTH_POLL_MS)
  heartbeat_interval = setInterval(_heartbeat, PEER_HEARTBEAT_MS)
  if (typeof window !== 'undefined') {
    online_handler = () => presence_input({ type: 'network_recover' })
    window.addEventListener('online', online_handler)
  }
  if (typeof document !== 'undefined') {
    visibility_handler = () => {
      if (document.hidden) {
        // #305 — BACKGROUNDING: our own heartbeat setInterval is about to be throttled by the browser, but
        // visibilitychange is an EVENT, not a timer, so it fires un-throttled right now. One last re-announce
        // gives every peer a fresh last_seen at the exact transition instant — real margin on top of the
        // PEER_EXPIRY_MS floor for whatever gap the throttle imposes next.
        _reannounce()
        return
      }
      presence_input({ type: 'network_recover' })
      _health_check() // a link that died while backgrounded is caught the instant we return, even if attempt was 0
    }
    document.addEventListener('visibilitychange', visibility_handler)
  }
}

/** Disarm every watchdog + listener (leave_lobby / scene teardown). Resets the session latch so the next join
 *  gets its own fresh initial-connect grace. */
function _stop_watchdogs() {
  watchdogs_started = false
  _restore_relay_announcements()
  unsub_rejoin?.()
  unsub_rejoin = null
  unsub_reannounce?.()
  unsub_reannounce = null
  if (rejoin_timer) clearTimeout(rejoin_timer)
  rejoin_timer = null
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

/**
 * Set the courier PARTY chat routing scope. Kept as a compatibility export until the sibling presence migration
 * deletes this module; no peer chat action survives here.
 * @param {string | null} party_id the on-chain Party object id (null = not in a party)
 */
export function sync_party_room(party_id) {
  sync_courier_party_room(party_id)
}

/**
 * Broadcast our LOW-FREQUENCY presence state (sui address + avatar colors + current party + current dungeon) —
 * call only when one of these fields actually changes, never on the position tick. `dungeon_id` (null =
 * overworld) drives the D237 instance render-scope: peers in a different dungeon than mine are dropped.
 * @param {{ address: string, color_1: number, color_2: number, color_3: number, party_id?: string | null, dungeon_id?: string | null }} state
 */
export function broadcast_state(state) {
  // D222-reopen: seed the ATOM first — a publish that beats join_lobby (mount-order race) must SURVIVE to the
  // join/upgrade flush; the atom is the park, the flush reads it back.
  presence_input({ type: 'my_state', state })
  _send_state() // TR-97 — one send home (merges the live cosmetic flags); guards on id itself
}

/**
 * TR-97 — set THIS client's live cosmetic session flags (mount ride + veteran-title aura) and re-broadcast so
 * peers render our mount + aura within one state RTT. Merged into every `state` send (orthogonal to the
 * party/dungeon payload), so toggling a mount never needs — and never clobbers — the party state.
 * @param {{ mounted?: boolean, mount_glb?: string | null, veteran?: boolean }} partial
 */
export function set_local_cosmetic(partial) {
  presence_input({ type: 'my_cosmetic', partial })
  _send_state()
}

/** The last-known peer state (address/colors/party/dungeon/cosmetic/identity) for a character id — a CORE
 *  projection now (the old module side-table dissolved into the presence atom). */
export function get_peer_state(character_id) {
  return peer_state_of(presence_store.getState(), character_id)
}

/** The same self-declared identity home, looked up by wallet address for friend/presence surfaces. */
export function get_peer_state_by_address(address) {
  return peer_state_by_address(presence_store.getState(), address)
}

/** Every live peer character for an address; friend travel selects the freshest accepted cell at action time. */
export function get_peer_states_by_address(address) {
  return peer_states_by_address(presence_store.getState(), address)
}

/**
 * Nudge a specific peer (by their sui address) that a party invite is waiting for them — fire-and-forget UX
 * sugar on top of the real on-chain `party::invite` tx (party_actions.js). The recipient's wallet address routes the packet;
 * `invited_character_id` identifies the exact pending character. Broadcast to the whole room (Trystero has no
 * targeted send here); every listener rejects it unless both owner and selected character match.
 */
export function nudge_party_invite(to_address, party_id, invited_character_id, from_name = '') {
  // from_name rides along so the invitee's consent prompt can say who invited the exact character.
  party_invite_action?.send({ to_address, party_id, invited_character_id, from_name }).catch(() => {})
}

/** Broadcast a freshly-created dungeon id to the party (leader → members) — see nudge_party_invite. */
export function share_dungeon(to_address, dungeon_id, template_id) {
  dungeon_share_action?.send({ to_address, dungeon_id, template_id }).catch(() => {})
}

/**
 * Nudge a specific ARTISAN (by their sui address) that a customer has requested a commission — fire-and-forget
 * UX sugar on top of the request itself; the artisan's session lands a live toast + chime + an inbox row NOW
 * instead of waiting for a poll. Broadcast to the whole room; every listener ignores it unless `to_address`
 * matches their own. See nudge_party_invite.
 * @param {string} to_address the named artisan's wallet address
 * @param {{ from_address?: string, from_name?: string, recipe_id?: string, recipe_name?: string, recipe_icon?: string, recipe_category?: string, payment_mist?: number }} [payload]
 */
export function nudge_commission_request(to_address, payload = {}) {
  commission_request_action?.send({ to_address, ...payload }).catch(() => {})
}

/** Broadcast one drafted fight signal to peers — coordination only, no tx (board #49 / courtesy channel #334).
 *  `placement` carries a `target` cell; a courtesy `batch` carries `{ intent_id, actions }` (the drafted turn in
 *  the receipt vocabulary). The receiver (fight-stream.js) sim-verifies through the fight core before painting.
 * @param {{ dungeon_id: string, address: string, kind: string, target?: number, intent_id?: string, actions?: any[] }} signal */
export function broadcast_fight_stream({ dungeon_id, address, kind, target = null, intent_id = null, actions = null }) {
  fight_stream_action?.send({ dungeon_id, address, kind, target, intent_id, actions }).catch(() => {})
}

/** Leave the lobby room (scene teardown) — safe to call even if never joined. The atom resets (freshness
 *  law: every ephemeral fact expires with the room). */
export function leave_lobby() {
  _stop_watchdogs()
  room?.leave()
  room = null
  _clear_room_actions()
  peer_characters.clear()
  presence_input({ type: 'reset' })
}
