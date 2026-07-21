// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRESENCE — the core: who/what is around me NOW. Ephemera under the freshness law — peer facts
// arrive as realtime p2p ticks, expire on peer_leave, and NOTHING here feeds claimability (claimability =
// checkpoint zone + proximity + row liveness, spawns-internal — the seams law). ONE atom behind ONE
// `input(msg, now)` door: the peer table (position + self-declared identity/state + chain-resolved identity),
// MY broadcastable facts (cell / state / cosmetic — dissolved out of the transport's module-scope side
// tables so the peer-join replay reads the atom), the nearby-fight MARKERS fold (absorbing the pure
// nearby_fights rules), and the chat/commission stream heads.
//
// The CHEATER-PLAUSIBILITY DROP — formerly buried in the transport's receive callbacks — is a pure rule in
// the fold now (headless-testable): a peer update implying an impossible speed (teleport / speed-hack) is
// silently DROPPED, never applied; a broadcast-declared MOUNT earns exactly its legit speed headroom.
// Effects live at the edges: the trystero transport dispatches typed inputs and reads the atom to send;
// identity resolution is an effect REQUEST (the adapter reads the chain and answers through the door).

import { createStore } from 'zustand/vanilla'

import { to_fight_marker, to_dungeon_fight, participant_ids, in_range } from './nearby_fights.js'

// Normal roam SPEED is 4 tiles/sec. A throttled p2p update can legitimately batch several cells if the
// network stalls (the sender fell behind, not sped up) — this cap only trips on a REAL speed/teleport
// violation, generous enough to absorb jitter.
export const MAX_PLAUSIBLE_TILES_PER_SEC = 15
// TR-97 MOUNT WHITELIST — mounted peers stay visible in multiplayer, never dropped as cheaters: a mounted peer
// legitimately roams ×1.5 (mount_speed MOUNT_SPEED_MULTIPLIER); the raised cap means any future faster gallop
// can't false-drop the rider. Read off the peer's self-declared `state` — a spoofed flag only grants a bit
// more speed slack, never anything else.
export const MOUNTED_SPEED_HEADROOM = 1.8
// A FIRST sighting has no prior cell to speed-check against (passes_speed_check intentionally lets it spawn),
// so an absurd-but-finite coordinate (NaN/Infinity are already caught by Number.isFinite below) would otherwise
// sail straight through. SPEC §4's designed world is 500,000×500,000 blocks (half = 250,000 from origin) — this
// bound is ~8× that, a pure sanity net against garbage, never a tight gameplay boundary.
export const MAX_PLAUSIBLE_WORLD_COORD = 2_000_000

// ── SELF-HEAL timing — the ONE home for the presence link's liveness + recovery constants ──────────────────────
// The p2p link (trystero over public nostr relays → WebRTC) can silently die — a relay outage or a frozen data
// channel that never fires a clean onPeerLeave — and NOTHING detected it, so peer lists froze until a full page
// refresh on BOTH ends. These constants make the link self-heal, all as INPUTS
// to the pure fold (never a timer that set()s state):
//  · every client re-emits its cell as a low-frequency HEARTBEAT (the edge reuses the `pos` send), so a peer that
//    stands still is still PROVABLY alive; a peer silent past PEER_EXPIRY_MS folds out on the next `tick` — an
//    honest count over a frozen one.
//  · a dead room (0 relays / online / visibility-return) is a `room_lost` / `network_recover` input; recovery is
//    an EFFECT REQUEST (rejoin / re-announce) the edge executes with bounded, jittered backoff.
// INVARIANT (#305 fix): PEER_EXPIRY_MS must clear the BROWSER'S BACKGROUND-TAB TIMER THROTTLE floor, not just
// be "a comfortable multiple" of PEER_HEARTBEAT_MS — a backgrounded tab's heartbeat TIMER is clamped by
// the browser regardless of its requested period (Chrome intensively throttles a hidden tab's timers to ~1/min),
// so a peer whose OWN tab is backgrounded still sends, just at a >60s cadence, while a still-focused peer's local
// tick runs on schedule and must not mistake that slow-but-alive cadence for a dead link (the old 22s TTL did:
// two live tabs decayed from 2 online to 1, restored only by a refresh's fresh join handshake). 90s clears that
// ~60s worst-case floor with real margin while still bounding how long a TRULY dead peer (frozen channel, no
// clean onPeerLeave) lingers as a ghost. They live together HERE so the relationship is one read, never two
// scattered magic numbers.
export const PEER_HEARTBEAT_MS = 7_000 // I re-broadcast my last cell this often (liveness ping; reuses `pos`) — the FOREGROUND cadence; a backgrounded tab's actual send gap is bounded by the browser's throttle floor, not this number
export const PEER_EXPIRY_MS = 90_000 // silent this long ⇒ the peer folds out on the next tick — sized above the background-throttle floor (#305), not the heartbeat cadence
export const LINK_HEALTH_POLL_MS = 5_000 // the edge samples relay-socket health this often
export const LINK_GRACE_MS = 12_000 // after each (re)join, suppress death judgment this long (sockets connect async)
export const REJOIN_JITTER_MS = 600 // the edge adds up to this much random jitter per retry (thundering-herd guard)
const REJOIN_BASE_MS = 1_000 // backoff base: attempt 1 waits ~1s
const REJOIN_MAX_MS = 30_000 // backoff ceiling — bounded, never an unbounded grow

/** The DETERMINISTIC rejoin backoff for a consecutive-failure attempt (1-based): exponential, capped at
 *  REJOIN_MAX_MS. The edge adds REJOIN_JITTER_MS of randomness at schedule time — jitter is an effect, kept OUT
 *  of the pure fold so the schedule stays testable. */
export function rejoin_backoff_ms(attempt) {
  return Math.min(REJOIN_BASE_MS * 2 ** Math.max(0, attempt - 1), REJOIN_MAX_MS)
}

/** @typedef {{ x:number, y:number, h?:number, yw?:number }} PeerCell */
/**
 * @typedef {{
 *   id: string,
 *   cell: { x:number, y:number, ts:number },
 *   position: { x:number, y:number, z:number },
 *   target_yaw: number|undefined,
 *   address: string, color_1: number, color_2: number, color_3: number,
 *   party_id: string|null, dungeon_id: string|null,
 *   mounted: boolean, mount_glb: string|null, veteran: boolean,
 *   classe: string|null, male: boolean|null, name: string|null,
 *   chain: { name?:string, classe?:string, male?:boolean, color_1?:number }|null,
 *   last_seen: number,
 * }} PeerEntry
 */

const blank_peer = (id) => ({
  id,
  cell: { x: 0, y: 0, ts: 0 },
  position: { x: 0, y: 0, z: 0 },
  target_yaw: undefined,
  last_seen: 0,
  address: '',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  party_id: null,
  dungeon_id: null,
  mounted: false,
  mount_glb: null,
  veteran: false,
  classe: null,
  male: null,
  name: null,
  chain: null,
})

/**
 * @typedef {{
 *   character_id: string|null,
 *   my_cell: PeerCell|null,
 *   my_state: { address:string, color_1:number, color_2:number, color_3:number, party_id:string|null, dungeon_id:string|null, classe?:string|null, male?:boolean|null, name?:string|null }|null,
 *   my_cosmetic: { mounted:boolean, mount_glb:string|null, veteran:boolean },
 *   peers: Map<string, PeerEntry>,
 *   roster_seq: number,
 *   identity_requests: { seq:number, ids:string[] }|null, identity_seq: number,
 *   chat: { seq:number, row:any }|null, chat_seq: number,
 *   commission: { seq:number, row:any }|null, commission_seq: number,
 *   fight_markers: Map<string, any>,
 *   dungeon_fight_rows: Map<string, any>,
 *   rejoin_attempt: number,
 *   rejoin: { seq:number, attempt:number, delay:number }|null, rejoin_seq: number,
 *   reannounce: { seq:number }|null, reannounce_seq: number,
 *   input: (input:any, now?:number) => void,
 * }} PresenceState
 */

// The plausibility rule as its own pure export (the headless-testable half of the cheater policy).
export function passes_speed_check(prev, x, y, now, mounted) {
  if (!prev || !prev.ts) return true // first sighting — nothing to compare against, let it spawn
  const dt = Math.max((now - prev.ts) / 1000, 0.05) // floor avoids a div-by-~0 spike on back-to-back packets
  const dist = Math.hypot(x - prev.x, y - prev.y)
  const cap = mounted ? MAX_PLAUSIBLE_TILES_PER_SEC * MOUNTED_SPEED_HEADROOM : MAX_PLAUSIBLE_TILES_PER_SEC
  return dist / dt <= cap
}

const fold_peer_pos = (state, input, now) => {
  const { id } = input
  const x = Number(input.x)
  const y = Number(input.y)
  if (!id || id === state.character_id || !Number.isFinite(x) || !Number.isFinite(y)) return state
  // BOUNDS DROP: a finite-but-insane coordinate (garbage or hostile) has no prior cell to speed-check against
  // on a first sighting, so this sanity net is the only backstop for that case — same "silently dropped,
  // never applied" contract as the speed check below.
  if (Math.abs(x) > MAX_PLAUSIBLE_WORLD_COORD || Math.abs(y) > MAX_PLAUSIBLE_WORLD_COORD) return state
  const prev = state.peers.get(id)
  // THE CHEATER-PLAUSIBILITY DROP — no server exists to validate anyone; clients self-regulate:
  // an update implying an impossible speed since the last ACCEPTED cell is silently dropped, never applied.
  // The peer's self-declared mount earns exactly its legit headroom (TR-97).
  if (prev && !passes_speed_check(prev.cell, x, y, now, prev.mounted)) return state
  // h/yw are SECONDARY fields (h's own documented default is 0 = "unknown, renderer ground-scans"; yw already
  // falls back to the prior facing when omitted) — a non-finite value here must never leak NaN/Infinity into
  // the rendered position, but it also shouldn't nuke an otherwise-valid x/y move the way a garbage id/x/y does.
  const raw_h = Number(input.h ?? 0)
  const position = { x, y: Number.isFinite(raw_h) ? raw_h : 0, z: y }
  const raw_yw = Number(input.yw)
  const target_yaw = input.yw != null && Number.isFinite(raw_yw) ? raw_yw : prev?.target_yaw
  const peers = new Map(state.peers)
  // last_seen refreshes on EVERY accepted signal (this pos, a heartbeat re-emit, or a state tick) — it is the
  // clock the `tick` expiry reads to fold out a peer whose link went silent.
  const entry = { ...(prev ?? blank_peer(id)), cell: { x, y, ts: now }, position, target_yaw, last_seen: now }
  peers.set(id, entry)
  const next = { ...state, peers }
  if (prev) return next // a known peer moving is a retarget, not a roster change
  // FIRST SIGHTING: spawn the placeholder + ask the edge to resolve chain identity (an effect request).
  return {
    ...next,
    roster_seq: state.roster_seq + 1,
    identity_seq: state.identity_seq + 1,
    identity_requests: { seq: state.identity_seq + 1, ids: [id] },
  }
}

const fold_peer_state = (state, input, now) => {
  const { id } = input
  if (!id || id === state.character_id) return state
  const prev = state.peers.get(id)
  const peers = new Map(state.peers)
  peers.set(id, {
    ...(prev ?? blank_peer(id)),
    last_seen: now, // a state broadcast is a liveness signal too — refresh the expiry clock
    address: String(input.address ?? ''),
    color_1: Number(input.color_1 ?? 0),
    color_2: Number(input.color_2 ?? 0),
    color_3: Number(input.color_3 ?? 0),
    party_id: input.party_id ?? null,
    dungeon_id: input.dungeon_id ?? null,
    mounted: !!input.mounted,
    mount_glb: input.mount_glb ? String(input.mount_glb) : null,
    veteran: !!input.veteran,
    classe: input.classe ? String(input.classe) : null,
    male: typeof input.male === 'boolean' ? input.male : null,
    name: input.name ? String(input.name) : null,
  })
  return { ...state, peers, roster_seq: state.roster_seq + 1 }
}

// THE MARKERS FOLD (absorbs the world_fights_discovery shaping): one snapshot input → the in-range,
// own-fight-excluded marker map. Order-independent: an identical snapshot converges to equal rows.
const fold_fights_snapshot = (state, input) => {
  const { rows, offset_x, offset_z, px, pz } = input
  if (!Array.isArray(rows)) return state
  const fight_markers = new Map()
  for (const f of rows) {
    const marker = to_fight_marker(f)
    if (!marker) continue
    if (state.character_id && participant_ids(f).includes(state.character_id)) continue // my own fight
    marker.position = { x: marker.position.x - (offset_x ?? 0), z: marker.position.z - (offset_z ?? 0) }
    marker.distance = Math.hypot(marker.position.x - px, marker.position.z - pz)
    if (in_range(marker, { x: px, z: pz })) fight_markers.set(marker.id, marker)
  }
  return { ...state, fight_markers }
}

const fold_runs_snapshot = (state, input) => {
  const dungeon_fight_rows = new Map()
  for (const { run, fight } of input.rows ?? []) {
    const marker = fight ? to_fight_marker(fight) : null
    const row = marker ? to_dungeon_fight(run, marker) : null
    if (!row) continue
    if (state.character_id && row.participant_ids.includes(state.character_id)) continue // already in it
    dungeon_fight_rows.set(row.id, row)
  }
  return { ...state, dungeon_fight_rows }
}

// A rejoin / re-announce is an EFFECT REQUEST — a versioned ref the transport edge subscribes to. These two
// tiny helpers are the single home for bumping each request's seq (derive, don't copy).
const request_rejoin = (state, attempt, delay) => ({
  ...state,
  rejoin_attempt: attempt,
  rejoin_seq: state.rejoin_seq + 1,
  rejoin: { seq: state.rejoin_seq + 1, attempt, delay },
})
const request_reannounce = (state) => ({
  ...state,
  reannounce_seq: state.reannounce_seq + 1,
  reannounce: { seq: state.reannounce_seq + 1 },
})

// THE LINK-LIFECYCLE FOLD — the self-heal half of the presence core (liveness expiry + the connection-death →
// bounded-rejoin → re-announce state machine). Connection events are INPUTS; recovery is an EFFECT REQUEST the
// transport edge performs. Dispatched from the ONE reduce door below, exactly like the other fold_* helpers.
const fold_link = (state, input, now) => {
  switch (input.type) {
    case 'tick': {
      // LIVENESS EXPIRY — fold out any peer silent past PEER_EXPIRY_MS (honest count over a frozen one); a tick
      // that drops nobody is IDENTITY (no roster churn).
      let dropped = false
      const peers = new Map(state.peers)
      for (const [id, p] of peers)
        if (now - (p.last_seen ?? 0) > PEER_EXPIRY_MS) {
          peers.delete(id)
          dropped = true
        }
      return dropped ? { ...state, peers, roster_seq: state.roster_seq + 1 } : state
    }
    case 'room_lost': {
      // CONNECTION DEATH (relays gone / channel closed) — request a rejoin at the next bounded, escalating step.
      const attempt = state.rejoin_attempt + 1
      return request_rejoin(state, attempt, rejoin_backoff_ms(attempt))
    }
    case 'rejoin_ok': // live again — reset the backoff AND re-announce so both sides reconverge with no refresh
      return { ...request_reannounce(state), rejoin_attempt: 0 }
    case 'network_recover': // mid-backoff ⇒ kick to an IMMEDIATE rejoin; healthy ⇒ just re-announce
      return state.rejoin_attempt > 0 ? request_rejoin(state, state.rejoin_attempt, 0) : request_reannounce(state)
    default:
      return state
  }
}

/**
 * THE pure presence fold — realtime ticks in, freshness-law'd facts out. `now` is the only clock.
 * @param {PresenceState} state @param {any} input @param {number} now
 * @returns {PresenceState}
 */
export function reduce_presence(state, input, now) {
  switch (input.type) {
    case 'session': {
      const character_id = input.character_id ?? null
      if (character_id === state.character_id) return state
      const peers = new Map(state.peers)
      // our own id must never linger as a foreign peer across an identify/upgrade
      if (character_id && peers.delete(character_id))
        return { ...state, character_id, peers, roster_seq: state.roster_seq + 1 }
      return { ...state, character_id }
    }
    case 'peer_pos':
      return fold_peer_pos(state, input, now)
    case 'peer_state':
      return fold_peer_state(state, input, now)
    case 'peer_leave': {
      const { id } = input
      if (!id || !state.peers.has(id)) return state
      const peers = new Map(state.peers)
      peers.delete(id)
      return { ...state, peers, roster_seq: state.roster_seq + 1 }
    }
    case 'peer_identity': {
      const { id, record } = input
      const prev = state.peers.get(id)
      if (!prev) return state // despawned mid-resolve — the freshness law
      const peers = new Map(state.peers)
      peers.set(id, { ...prev, chain: record ?? null })
      return { ...state, peers, roster_seq: state.roster_seq + 1 }
    }
    case 'my_cell':
      return {
        ...state,
        my_cell: { x: Number(input.x), y: Number(input.y), h: Number(input.h ?? 0), yw: Number(input.yw ?? 0) },
      }
    case 'my_state':
      return { ...state, my_state: input.state ?? null }
    case 'my_cosmetic':
      return { ...state, my_cosmetic: { ...state.my_cosmetic, ...input.partial } }
    case 'chat_received': {
      if (!input.row?.id || !input.row?.message) return state
      const seq = state.chat_seq + 1
      return { ...state, chat_seq: seq, chat: { seq, row: input.row } }
    }
    case 'commission_received': {
      if (!input.row?.to_address) return state
      const seq = state.commission_seq + 1
      return { ...state, commission_seq: seq, commission: { seq, row: input.row } }
    }
    case 'fights_snapshot':
      return fold_fights_snapshot(state, input)
    case 'runs_snapshot':
      return fold_runs_snapshot(state, input)
    case 'reset':
      return {
        ...state,
        character_id: null,
        my_cell: null,
        my_state: null,
        my_cosmetic: { mounted: false, mount_glb: null, veteran: false },
        peers: new Map(),
        fight_markers: new Map(),
        dungeon_fight_rows: new Map(),
        roster_seq: state.roster_seq + 1,
        rejoin_attempt: 0, // a deliberate teardown starts the next join with a clean backoff
      }
    default:
      // SELF-HEAL — the link-lifecycle inputs (tick / room_lost / rejoin_ok / network_recover) fold through here;
      // a genuinely unknown input returns state unchanged (fold_link's own default). One door, one dispatch.
      return fold_link(state, input, now)
  }
}

const make_presence_input =
  (set, get) =>
  (input, now = Date.now()) => {
    const state = get()
    const next = reduce_presence(state, input, now)
    if (next !== state) set(next, true)
  }

/** @returns {import('zustand/vanilla').StoreApi<PresenceState>} */
export function create_presence_store() {
  return createStore((set, get) => ({
    character_id: null,
    my_cell: null,
    my_state: null,
    my_cosmetic: { mounted: false, mount_glb: null, veteran: false },
    peers: new Map(),
    roster_seq: 0,
    identity_requests: null,
    identity_seq: 0,
    chat: null,
    chat_seq: 0,
    commission: null,
    commission_seq: 0,
    fight_markers: new Map(),
    dungeon_fight_rows: new Map(),
    rejoin_attempt: 0,
    rejoin: null,
    rejoin_seq: 0,
    reannounce: null,
    reannounce_seq: 0,
    input: make_presence_input(set, get),
  }))
}

// ── effect edges (exported subscriptions — the package performs nothing) ─────────────────────────────────────

/** One call per identity-resolution request batch (the adapter reads the chain, answers via peer_identity). */
export function subscribe_identity_requests(store, on_request) {
  return store.subscribe((state, prev) => {
    if (state.identity_requests && state.identity_requests !== prev.identity_requests)
      on_request(state.identity_requests)
  })
}

/** One call per received chat row, in order. */
export function subscribe_chat(store, on_row) {
  return store.subscribe((state, prev) => {
    if (state.chat && state.chat !== prev.chat) on_row(state.chat.row)
  })
}

/** One call per received commission-request row, in order. */
export function subscribe_commissions(store, on_row) {
  return store.subscribe((state, prev) => {
    if (state.commission && state.commission !== prev.commission) on_row(state.commission.row)
  })
}

/** One call per REJOIN request — the edge tears down the dead room and rejoins after `delay` (+ its own jitter),
 *  then feeds `rejoin_ok` on success. Fires on every room_lost / network_recover-while-lost. */
export function subscribe_rejoin(store, on_rejoin) {
  return store.subscribe((state, prev) => {
    if (state.rejoin && state.rejoin !== prev.rejoin) on_rejoin(state.rejoin)
  })
}

/** One call per RE-ANNOUNCE request — the edge re-broadcasts our cell + state to the whole room so both sides
 *  reconverge without a user refresh. Fires on rejoin success and on a healthy network/visibility recovery. */
export function subscribe_reannounce(store, on_reannounce) {
  return store.subscribe((state, prev) => {
    if (state.reannounce && state.reannounce !== prev.reannounce) on_reannounce(state.reannounce)
  })
}

// ── projections (renderer-complete — consumers compute nothing) ──────────────────────────────────────────────

/** The visible-player rows (foreign peers only): identity prefers the CHAIN record, falls back to the peer's
 *  self-declared p2p identity (serverless spectate truth). The frontend bridge maps classe→sprites at its edge. */
export function visible_players(state) {
  const out = []
  for (const p of state.peers.values())
    out.push({
      id: p.id,
      name: p.chain?.name ?? p.name ?? '',
      classe: p.chain?.classe ?? p.classe ?? null,
      male: p.chain?.male ?? p.male ?? null,
      color_1: p.chain?.color_1 ?? p.color_1 ?? 0,
      position: p.position,
      target_yaw: p.target_yaw,
    })
  return out
}

/** The last-known peer state (address/colors/party/dungeon/cosmetic/identity) for one character id. */
export function peer_state_of(state, character_id) {
  const p = state.peers.get(character_id)
  if (!p) return null
  const { id, cell, last_seen, position, target_yaw, chain, ...rest } = p
  return { ...rest, name: chain?.name ?? rest.name ?? null }
}

/** The same self-declared identity home, looked up by wallet address (friend/presence surfaces). */
export function peer_state_by_address(state, address) {
  if (!address) return null
  for (const p of state.peers.values()) if (p.address === address) return peer_state_of(state, p.id)
  return null
}

/** The [V] "see fights in the area" affordance: how many joinable/spectatable rows the panel would show. */
export function see_fights_count(state, in_dungeon) {
  return in_dungeon ? state.dungeon_fight_rows.size : state.fight_markers.size
}
