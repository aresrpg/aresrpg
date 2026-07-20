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

import { joinRoom, getRelaySockets, defaultRelayUrls } from 'trystero'
import {
  peer_state_of,
  peer_state_by_address,
  subscribe_rejoin,
  subscribe_reannounce,
  PEER_HEARTBEAT_MS,
  LINK_HEALTH_POLL_MS,
  LINK_GRACE_MS,
  REJOIN_JITTER_MS,
} from '@aresrpg/world'

import { context } from '../game/core/game.js'
import { game_log } from '../core/log.js'
import { presence_store, presence_input } from '../world-shell/presence_adapter.js'

const NETWORK = import.meta.env.VITE_NETWORK || 'testnet'
const APP_ID = `aresrpg-world-lobby-${NETWORK}`
// EXPLICIT nostr rendezvous relays (2026-07-15): trystero's baked-in default list included a dead relay
// (chorus.pjv.me → 502 on every handshake, visible console noise + degraded discovery). Peers are
// browser-to-browser WebRTC — relays only broker the handshake, so a diverse public list + redundancy is
// the whole fix; self-hosting one stays a ticketed option if these ever rot too.
const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
  'wss://relay.snort.social',
]
const RELAY_REDUNDANCY = 3
const ROOM_ID = 'world'

// WebRTC ICE — STUN-first (direct P2P when the NAT allows it) + TURN fallback (relayed only when direct fails)
// for peers behind symmetric-NAT / corporate / mobile firewalls where UDP never forms. OWNER CONSTITUTIONAL LAW:
// ZERO hosted infra — free PUBLIC providers ONLY (no self-hosted coturn, ever). Resilience = STACK multiple free
// providers + multiple ports/transports so one provider's outage or a blocked port doesn't kill peer transport.
// Env-swappable (VITE_TURN_URL comma-separated + USER/CRED) to add/replace providers without a code change.
// Passed to BOTH Trystero rooms. (Signaling works over nostr/WSS regardless; TURN only rescues the data channel.)
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
let pos_action = null
let chat_action = null
let state_action = null
let party_invite_action = null
let dungeon_share_action = null
let fight_stream_action = null
let commission_request_action = null
// PARTY chat room (v2): a SECOND Trystero room scoped to the on-chain party id, reusing the SAME
// appId + discovery infra as the lobby (NOT the shared `world` room). Party lines broadcast here reach ONLY
// party members. Lifecycle is PARTY-driven (party_store._publish_state → sync_party_room), independent of the
// world-scene mount, so it survives World-tab remounts and closes only when membership ends (party_id → null).
let party_room = null
let party_chat_action = null
let party_room_id = null
/** @type {Map<string, string>} trystero peer_id → the on-chain character_id it broadcasts as — the one
 * transport-level routing fact that stays OUTSIDE the atom (the core never sees trystero peer ids). */
const peer_characters = new Map()

/** The live session id — read from the atom (the transport's own-echo filter + send guard). */
const my_character_id = () => presence_store.getState().character_id

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
// The edge-only bookkeeping (timers, the first-connect latch, the per-(re)join grace window) is pure scheduling —
// the game/roster state all lives in the reducer.
let rejoin_timer = null
let relays_ever_up = false // latched on the FIRST relay connect of this lobby session; a later drop-to-0 is real death
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
  room = joinRoom(
    { appId: APP_ID, rtcConfig: RTC_CONFIG, relayUrls: RELAY_URLS, relayRedundancy: RELAY_REDUNDANCY },
    ROOM_ID
  )
  pos_action = room.makeAction('pos')
  chat_action = room.makeAction('chat')
  state_action = room.makeAction('state')
  party_invite_action = room.makeAction('pinvite')
  dungeon_share_action = room.makeAction('dshare')
  fight_stream_action = room.makeAction('fstream')
  commission_request_action = room.makeAction('crequest')

  // RECEIVE → typed inputs through the presence door. The plausibility drop + own-echo filtering live in the
  // FOLD (the core knows the session id via the `session` input) — this adapter only routes + maps peer ids.
  pos_action.onMessage = (data, { peerId }) => {
    const { id, x, y, h, yw } = /** @type {{ id: string, x: number, y: number, h?: number, yw?: number }} */ (
      data ?? {}
    )
    if (!id || typeof x !== 'number' || typeof y !== 'number') return
    if (id !== my_character_id()) peer_characters.set(peerId, id)
    // D217: h carries the broadcast WORLD height (0 = old/unknown payload → renderer ground-scans);
    // D222: yw rides too — the remote rig's true facing.
    presence_input({ type: 'peer_pos', id, x, y, h, yw })
  }

  chat_action.onMessage = (data) => {
    const { id, message, name, channel, target } = /** @type {any} */ (data ?? {})
    presence_input({ type: 'chat_received', row: { id, message, address: id, name, channel, target } })
  }

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
    const { dungeon_id, address, kind, target } =
      /** @type {{ dungeon_id: string, address: string, kind: string, target: number }} */ (data ?? {})
    if (!dungeon_id || !address || !kind) return
    context.events.emit('packet/fightStream', { dungeon_id, address, kind, target })
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
  }

  // P1-B: the instant a new peer's WebRTC data channel is ready, hand it our current position + state
  // DIRECTLY (SendOptions.target) instead of waiting for our next move / state change — both read from the
  // ATOM (the join-replay facts live there now). Covers the "both tabs stand still" case.
  room.onPeerJoin = (peerId) => {
    // Diagnostic: a peer's data channel opened → we're in a SHARED room and
    // receiving. A read-only SPECTATOR (feature #19) sends nothing below but STILL sees this count climb.
    game_log('p2p', `peer joined · peers: ${Object.keys(room?.getPeers?.() ?? {}).length}`)
    const { character_id, my_cell } = presence_store.getState()
    if (character_id && my_cell) pos_action?.send({ id: character_id, ...my_cell }, { target: peerId }).catch(() => {})
    if (character_id) _send_state(peerId) // TR-97 — merges the live cosmetic flags too (guards on my_state)
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
    game_log(
      'p2p',
      `joinRoom fired · relays connected: ${connected.length}/${defaultRelayUrls?.length ?? sockets.length}`,
      { errors }
    )
  }, 4000)
}

/** HEARTBEAT — re-broadcast my last cell (reusing `pos`) so a peer that stands still is still provably alive on
 *  the other side's expiry clock. Low-frequency; no-op with no id/cell (spectator or pre-spawn). */
function _heartbeat() {
  const { character_id, my_cell } = presence_store.getState()
  if (character_id && my_cell) pos_action?.send({ id: character_id, ...my_cell }).catch(() => {})
}

/** RE-ANNOUNCE — push my cell + state to the WHOLE room (not one peer) so both sides reconverge after a recovery
 *  without anyone refreshing. The core requests this on rejoin success / a healthy network recovery. */
function _reannounce() {
  const { character_id, my_cell } = presence_store.getState()
  if (character_id && my_cell) pos_action?.send({ id: character_id, ...my_cell }).catch(() => {})
  if (character_id) _send_state()
}

/** REJOIN — tear the DEAD room down cleanly and rebuild it (the atom survives). The core schedules this via a
 *  bounded backoff; this edge adds the jitter. On success the health poll sees relays return and feeds rejoin_ok. */
function _rejoin() {
  room?.leave()
  room = null
  peer_characters.clear() // trystero peer ids are stale after a leave; the character rows persist in the atom
  _build_room()
}

/** LINK HEALTH — 0 connected relays ⇒ the signaling lifeline is dead ⇒ `room_lost` (only after relays have EVER
 *  been up this session, the per-(re)join grace has elapsed, and no rejoin is already scheduled — so the backoff
 *  never inflates faster than its own schedule). Relays back while we were lost ⇒ `rejoin_ok`. */
function _health_check() {
  const sockets = Object.values(getRelaySockets?.() ?? {})
  const connected = sockets.filter((/** @type {any} */ s) => s?.readyState === 1).length
  if (connected > 0) {
    relays_ever_up = true
    if (presence_store.getState().rejoin_attempt > 0) {
      // recovered (our rejoin OR trystero's own relay reconnect) — cancel any pending teardown so a relay FLAP
      // never rejoins a room that just came back on its own, then reset the backoff + re-announce.
      if (rejoin_timer) clearTimeout(rejoin_timer)
      rejoin_timer = null
      presence_input({ type: 'rejoin_ok' })
    }
    return
  }
  if (relays_ever_up && Date.now() >= link_grace_until && !rejoin_timer) presence_input({ type: 'room_lost' })
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
        _rejoin()
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
      if (document.hidden) return
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
  relays_ever_up = false
  link_grace_until = 0
}

/** Broadcast our current cell — call ONLY on an actual cell change (already throttled by the caller).
 *  D217: `h` = the WORLD height (feet y); D222: `yw` = facing_yaw (radians). The atom records it (the
 *  peer-join replay reads it back); the wire send is the effect. */
export function broadcast_position(character_id, x, y, h = 0, yw = 0) {
  presence_input({ type: 'my_cell', x, y, h, yw })
  pos_action?.send({ id: character_id, x, y, h, yw }).catch(() => {})
}

/** Broadcast a chat line to every peer in the lobby room. */
export function broadcast_chat(character_id, name, message, channel, target = '') {
  chat_action?.send({ id: character_id, name, message, channel, target }).catch(() => {})
}

/**
 * Join / leave the PARTY chat room (v2) — a dedicated Trystero room scoped to the on-chain party id, so
 * PARTY lines reach ONLY party members instead of the whole `world` lobby. Reuses the SAME appId + nostr
 * discovery infra (a sibling room, no new dep / no rebuild). Idempotent per id; call whenever the party_id
 * changes (party_store._publish_state). `null` id → leave (solo). Lifecycle is party-driven, NOT tied to the
 * world-scene mount, so party chat survives World-tab remounts and closes only when membership ends.
 * @param {string | null} party_id the on-chain Party object id (null = not in a party)
 */
export function sync_party_room(party_id) {
  if (party_id === party_room_id) return
  party_room?.leave()
  party_room = null
  party_chat_action = null
  party_room_id = party_id ?? null
  if (!party_id) return
  party_room = joinRoom(
    { appId: APP_ID, rtcConfig: RTC_CONFIG, relayUrls: RELAY_URLS, relayRedundancy: RELAY_REDUNDANCY },
    `party-${party_id}`
  )
  party_chat_action = party_room.makeAction('chat')
  party_chat_action.onMessage = (data) => {
    const { id, message, name, channel, target } = /** @type {any} */ (data ?? {})
    presence_input({ type: 'chat_received', row: { id, message, address: id, name, channel, target } })
  }
}

/** Broadcast a chat line to the PARTY room only (party members) — no-op if not in a party. See sync_party_room. */
export function broadcast_party_chat(character_id, name, message, channel, target = '') {
  party_chat_action?.send({ id: character_id, name, message, channel, target }).catch(() => {})
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

/** Broadcast the active player's drafted fight action as a PREVIEW (board #49) — coordination only, no tx.
 * @param {{ dungeon_id: string, address: string, kind: 'move' | 'cast', target: number }} action */
export function broadcast_fight_stream({ dungeon_id, address, kind, target }) {
  fight_stream_action?.send({ dungeon_id, address, kind, target }).catch(() => {})
}

/** Leave the lobby room (scene teardown) — safe to call even if never joined. The atom resets (freshness
 *  law: every ephemeral fact expires with the room). */
export function leave_lobby() {
  _stop_watchdogs()
  room?.leave()
  room = null
  pos_action = null
  chat_action = null
  state_action = null
  party_invite_action = null
  dungeon_share_action = null
  fight_stream_action = null
  commission_request_action = null
  peer_characters.clear()
  presence_input({ type: 'reset' })
}
