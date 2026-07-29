// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W3 gate suite (D770a presence) — red-first per the design note: (1) the CHEATER-PLAUSIBILITY DROP lives in
// the fold (impossible speed dropped; a broadcast-declared mount earns exactly its headroom); (2) the
// JOIN-REPLAY facts (my cell/state) live in the atom, not transport module scope; (3) MARKER CONVERGENCE —
// one fights snapshot folds to the in-range, own-fight-excluded rows and an identical snapshot converges.
// All on plain objects; no transport appears — the fold is pure.

import { describe, expect, it } from 'bun:test'

import {
  create_presence_store,
  passes_speed_check,
  visible_players,
  peer_state_of,
  peer_state_by_address,
  peer_states_by_address,
  see_fights_count,
  subscribe_identity_requests,
  subscribe_chat,
  subscribe_commissions,
  subscribe_rejoin,
  subscribe_reannounce,
  rejoin_backoff_ms,
  MAX_PLAUSIBLE_TILES_PER_SEC,
  MOUNTED_SPEED_HEADROOM,
  PEER_EXPIRY_MS,
} from '../src/presence.js'

const ME = `0x${'1'.repeat(64)}`
const PEER = `0x${'2'.repeat(64)}`
const PEER_B = `0x${'3'.repeat(64)}`

const boot = () => {
  const store = create_presence_store()
  const input = (msg, now = 1_000) => store.getState().input(msg, now)
  input({ type: 'session', character_id: ME })
  return { store, input, state: () => store.getState() }
}

describe('the peer table — realtime ticks under the freshness law', () => {
  it('a first sighting spawns a placeholder row + emits ONE identity request', () => {
    const { store, input, state } = boot()
    const requests = []
    subscribe_identity_requests(store, (r) => requests.push(r))
    input({ type: 'peer_pos', id: PEER, x: 10, y: 20, h: 64, yw: 1.5 })
    const rows = visible_players(state())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: PEER, position: { x: 10, y: 64, z: 20 }, target_yaw: 1.5 })
    expect(requests.map((r) => r.ids)).toEqual([[PEER]])
  })
  it('my own id is never a foreign peer (own-echo/spoof filter in the fold)', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: ME, x: 1, y: 1 })
    expect(visible_players(state())).toHaveLength(0)
  })
  it('peer_leave expires every fact (facts EXPIRE — the freshness law)', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 })
    input({ type: 'peer_state', id: PEER, address: '0xabc', color_1: 3 })
    input({ type: 'peer_leave', id: PEER })
    expect(visible_players(state())).toHaveLength(0)
    expect(peer_state_of(state(), PEER)).toBe(null)
  })
  it('peer_state merges identity/cosmetic; chain resolution (peer_identity) wins over self-declared', () => {
    const { input, state } = boot()
    input({ type: 'peer_state', id: PEER, address: '0xabc', classe: 'senshi', name: 'p2p-name', mounted: true })
    input({ type: 'peer_pos', id: PEER, x: 12, y: -7 }) // position may arrive after identity; action-time lookup sees it
    expect(peer_state_of(state(), PEER)).toMatchObject({ address: '0xabc', classe: 'senshi', mounted: true })
    expect(peer_state_by_address(state(), '0xabc')?.name).toBe('p2p-name')
    input({ type: 'peer_pos', id: PEER_B, x: 4, y: 9 }, 2_000)
    input({ type: 'peer_state', id: PEER_B, address: '0xabc', name: 'second-tab' }, 2_000)
    expect(peer_states_by_address(state(), '0xabc')).toMatchObject([
      { id: PEER, name: 'p2p-name', cell: { x: 12, y: -7 }, position: { x: 12, z: -7 } },
      { id: PEER_B, name: 'second-tab', cell: { x: 4, y: 9 }, position: { x: 4, z: 9 } },
    ])
    input({ type: 'peer_identity', id: PEER, record: { name: 'chain-name', classe: 'yajin', male: false, color_1: 7 } })
    const row = visible_players(state())[0] ?? peer_state_of(state(), PEER)
    expect(peer_state_of(state(), PEER)?.name).toBe('chain-name')
    expect(row).toBeTruthy()
  })
  it('COSMETICS TRANSPORT RULING: a peer_state still carrying a legacy `worn` field never resurrects it — worn cosmetics resolve from /v1 now, never the p2p payload (a stale old-bundle client mid-rollout must not smuggle it back in)', () => {
    const { input, state } = boot()
    input({
      type: 'peer_state',
      id: PEER,
      address: '0xabc',
      worn: { head: { url: 'https://cdn/cosmetics/sui_helmet.glb', variant: null }, back: null },
    })
    const row = peer_state_of(state(), PEER)
    expect(row?.address).toBe('0xabc')
    expect(row).not.toHaveProperty('worn')
  })
  it('a late peer_identity for a despawned peer is dropped (never resurrects an expired fact)', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 })
    input({ type: 'peer_leave', id: PEER })
    input({ type: 'peer_identity', id: PEER, record: { name: 'ghost' } })
    expect(visible_players(state())).toHaveLength(0)
  })
})

// ─── THE W3 GATE ROW 1 (red-first): the cheater-plausibility drop IN THE FOLD ───

describe('the CHEATER-PLAUSIBILITY DROP — a pure rule of the fold, headless-testable', () => {
  it('an impossible speed between two ticks is DROPPED (the position never applies)', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 0, y: 0 }, 1_000)
    // 100 tiles in 1s >> 15 tiles/s — a teleport/speed-hack; the fold must keep the LAST accepted cell.
    input({ type: 'peer_pos', id: PEER, x: 100, y: 0 }, 2_000)
    expect(visible_players(state())[0].position).toMatchObject({ x: 0, z: 0 })
  })
  it('a legit pace passes (4 tiles/s roam with batching jitter)', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 0, y: 0 }, 1_000)
    input({ type: 'peer_pos', id: PEER, x: 8, y: 0 }, 2_000) // 8 tiles/s < 15 cap
    expect(visible_players(state())[0].position).toMatchObject({ x: 8, z: 0 })
  })
  it('TR-97: the SAME above-base speed drops an unmounted peer but passes a broadcast-declared MOUNT', () => {
    const { input, state } = boot()
    // 20 tiles/s: above the 15 base cap, under the 27 mounted cap (15 × 1.8).
    input({ type: 'peer_pos', id: PEER, x: 0, y: 0 }, 1_000)
    input({ type: 'peer_pos', id: PEER, x: 20, y: 0 }, 2_000)
    expect(visible_players(state())[0].position).toMatchObject({ x: 0, z: 0 }) // dropped

    input({ type: 'peer_state', id: PEER_B, mounted: true })
    input({ type: 'peer_pos', id: PEER_B, x: 0, y: 0 }, 1_000)
    input({ type: 'peer_pos', id: PEER_B, x: 20, y: 0 }, 2_000)
    expect(visible_players(state()).find((r) => r.id === PEER_B)?.position).toMatchObject({ x: 20, z: 0 }) // kept
  })
  it('the pure rule stands alone (passes_speed_check table)', () => {
    expect(passes_speed_check(null, 5, 5, 1_000, false)).toBe(true) // first sighting spawns
    expect(passes_speed_check({ x: 0, y: 0, ts: 1_000 }, 10, 0, 2_000, false)).toBe(true)
    expect(passes_speed_check({ x: 0, y: 0, ts: 1_000 }, 16, 0, 2_000, false)).toBe(false)
    expect(passes_speed_check({ x: 0, y: 0, ts: 1_000 }, 16, 0, 2_000, true)).toBe(true) // mounted headroom
    expect(MAX_PLAUSIBLE_TILES_PER_SEC * MOUNTED_SPEED_HEADROOM).toBe(27)
  })
})

// ─── THE W3 GATE ROW 2: the join-replay facts live in the ATOM (module-scope side tables are dead) ───

describe('MY broadcastable facts — the atom replaces the transport side tables (join-replay reads it)', () => {
  it('my_cell / my_state / my_cosmetic fold in and compose the replay payload', () => {
    const { input, state } = boot()
    input({ type: 'my_cell', x: 4, y: 9, h: 71, yw: 0.5 })
    input({
      type: 'my_state',
      state: { address: '0xme', color_1: 1, color_2: 2, color_3: 3, party_id: null, dungeon_id: null },
    })
    input({ type: 'my_cosmetic', partial: { mounted: true } })
    expect(state().my_cell).toEqual({ x: 4, y: 9, h: 71, yw: 0.5 })
    expect(state().my_state?.address).toBe('0xme')
    expect(state().my_cosmetic).toEqual({ mounted: true })
    // a cosmetic toggle never clobbers the party/dungeon payload (orthogonal facts, one atom)
    input({ type: 'my_cosmetic', partial: { mounted: false } })
    expect(state().my_state?.address).toBe('0xme')
  })
  it('reset clears everything ephemeral (scene teardown / account switch)', () => {
    const { input, state } = boot()
    input({ type: 'my_cell', x: 4, y: 9 })
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 })
    input({ type: 'reset' })
    expect(state()).toMatchObject({ character_id: null, my_cell: null, my_state: null })
    expect(state().peers.size).toBe(0)
  })
})

// ─── THE W3 GATE ROW 3 (red-first): marker convergence ───

describe('the MARKERS fold — fights_snapshot → in-range, own-excluded rows; identical snapshots converge', () => {
  const fight = (fight_id, x, z, participants = []) => ({
    fight_id,
    anchor: { x, z },
    public: true,
    status: 1,
    participants: participants.map((character, seat) => ({ character, seat })),
    mob_count: 3,
  })
  it('folds one snapshot: chain→world anchors, 50-block ring, my own fight excluded', () => {
    const { input, state } = boot()
    input({
      type: 'fights_snapshot',
      rows: [
        fight('0xnear', 510, 510, [PEER]), // world (10,10) — ~14 blocks from the player at (0,0): IN
        fight('0xfar', 900, 900, [PEER_B]), // world (400,400): OUT of the 50-block ring
        fight('0xmine', 505, 505, [ME]), // my own fight — never a discovery row
      ],
      offset_x: 500,
      offset_z: 500,
      px: 0,
      pz: 0,
    })
    expect([...state().fight_markers.keys()]).toEqual(['0xnear'])
    expect(state().fight_markers.get('0xnear')).toMatchObject({ position: { x: 10, z: 10 } })
    expect(see_fights_count(state(), false)).toBe(1)
  })
  it('an identical snapshot CONVERGES (equal rows, stable count) — order independence', () => {
    const { input, state } = boot()
    const snap = () => ({
      type: 'fights_snapshot',
      rows: [fight('0xnear', 510, 510, [PEER])],
      offset_x: 500,
      offset_z: 500,
      px: 0,
      pz: 0,
    })
    input(snap())
    const before = [...state().fight_markers.entries()]
    input(snap())
    expect([...state().fight_markers.entries()]).toEqual(before)
  })
  it('runs_snapshot shapes party room-fights and excludes rows I already sit in', () => {
    const { input, state } = boot()
    input({
      type: 'runs_snapshot',
      rows: [
        { run: { pass_id: 'p1', room: 2, character: PEER, fight_id: '0xroom' }, fight: fight('0xroom', 0, 0, [PEER]) },
        {
          run: { pass_id: 'p2', room: 3, character: PEER_B, fight_id: '0xjoined' },
          fight: fight('0xjoined', 0, 0, [PEER_B, ME]),
        },
      ],
    })
    expect([...state().dungeon_fight_rows.keys()]).toEqual(['0xroom'])
    expect(see_fights_count(state(), true)).toBe(1)
  })
})

describe('stream heads — chat + commissions flow through the door as data', () => {
  it('chat_received rows reach subscribers exactly once, in order; malformed rows are dropped', () => {
    const { store, input } = boot()
    const rows = []
    subscribe_chat(store, (r) => rows.push(r.message))
    input({ type: 'chat_received', row: { id: PEER, message: 'hello' } })
    input({ type: 'chat_received', row: { id: PEER, message: 'world' } })
    input({ type: 'chat_received', row: { id: PEER } }) // no message — dropped
    expect(rows).toEqual(['hello', 'world'])
  })
  it('commission_received rows reach subscribers once, in order; a row without to_address is dropped', () => {
    const { store, input } = boot()
    const rows = []
    subscribe_commissions(store, (r) => rows.push(r.recipe_id))
    input({ type: 'commission_received', row: { to_address: '0xartisan', recipe_id: 'sword' } })
    input({ type: 'commission_received', row: { to_address: '0xartisan', recipe_id: 'shield' } })
    input({ type: 'commission_received', row: { recipe_id: 'orphan' } }) // no to_address — dropped
    expect(rows).toEqual(['sword', 'shield'])
  })
})

// ─── SELF-HEAL LEG ① (red-first): LIVENESS — a peer that stops signaling folds OUT of the roster ───
// Regression: the p2p link silently died and the peer lists froze until a full refresh on BOTH machines.
// The freshness law must hold over a DEAD link too — no signal for PEER_EXPIRY_MS ⇒ the peer expires on the
// next `tick`, so the roster count is HONEST (an absent peer drops) without anyone refreshing.

describe('SELF-HEAL ① liveness — silence expires a peer; a heartbeat keeps a live one', () => {
  it('a peer with no signal for PEER_EXPIRY_MS folds out on the next tick (was: stayed forever)', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 }, 1_000)
    expect(visible_players(state())).toHaveLength(1)
    // a tick still inside the window keeps the peer (no premature drop)
    input({ type: 'tick' }, 1_000 + PEER_EXPIRY_MS - 1)
    expect(visible_players(state())).toHaveLength(1)
    // a tick past the window folds it out — honest count over a frozen one
    input({ type: 'tick' }, 1_000 + PEER_EXPIRY_MS + 1)
    expect(visible_players(state())).toHaveLength(0)
  })
  it('any signal (a heartbeat re-emit of the same cell) refreshes last_seen so a live peer never expires', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 }, 1_000)
    // the edge heartbeat re-broadcasts the SAME cell late in the window — proves the reused pos path is liveness
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 }, 1_000 + PEER_EXPIRY_MS - 1)
    input({ type: 'tick' }, 1_000 + PEER_EXPIRY_MS + 1) // would expire the FIRST signal; the heartbeat saved it
    expect(visible_players(state())).toHaveLength(1)
  })
  it('a tick that drops nobody is identity (no churn, stable roster_seq)', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 }, 1_000)
    const seq = state().roster_seq
    input({ type: 'tick' }, 1_000 + PEER_EXPIRY_MS - 1)
    expect(state().roster_seq).toBe(seq)
  })
  // #305 (red-first): a BACKGROUNDED tab's heartbeat setInterval is browser-throttled (Chrome clamps a
  // hidden tab's timers to ~1/min once intensively throttled) — its renewals land at a >60s cadence even
  // though the presence link is fully alive. The FOCUSED tab's own tick keeps running on schedule (it is not
  // the one throttled) and must NOT mistake the other side's slow send cadence for a dead peer.
  it('a peer renewing at a 65s throttled cadence (>60s gap) stays online — red @22s TTL, green @90s', () => {
    const { input, state } = boot()
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 }, 1_000)
    // the focused tab's tick lands mid-gap, well past the old 22s TTL but inside the fixed one
    input({ type: 'tick' }, 1_000 + 65_000)
    expect(visible_players(state())).toHaveLength(1)
    // the throttled heartbeat finally lands, and the same cadence repeats — presence survives indefinitely,
    // not just one lucky gap
    input({ type: 'peer_pos', id: PEER, x: 1, y: 1 }, 1_000 + 65_000 + 1)
    input({ type: 'tick' }, 1_000 + 65_000 + 1 + 65_000)
    expect(visible_players(state())).toHaveLength(1)
  })
})

// ─── SELF-HEAL LEG ②③④ (red-first): CONNECTION DEATH → BOUNDED REJOIN → RE-ANNOUNCE ───
// Connection lifecycle is an INPUT to the reducer; recovery is an EFFECT REQUEST executed at the edge (no
// async callback ever set()s the store). room_lost ⇒ a rejoin request with jittered/bounded backoff;
// rejoin_ok ⇒ backoff reset + a FULL re-announce so both sides reconverge without a user refresh.

describe('SELF-HEAL ②③④ connection death → bounded rejoin → re-announce on recovery', () => {
  it('room_lost requests a rejoin (backoff attempt 1); a persistent loss ESCALATES the backoff', () => {
    const { store, input } = boot()
    const rejoins = []
    subscribe_rejoin(store, (r) => rejoins.push(r))
    input({ type: 'room_lost' })
    input({ type: 'room_lost' })
    expect(rejoins.map((r) => r.attempt)).toEqual([1, 2])
    expect(rejoins.map((r) => r.delay)).toEqual([rejoin_backoff_ms(1), rejoin_backoff_ms(2)])
    expect(store.getState().rejoin_attempt).toBe(2)
  })
  it('the backoff is bounded and monotonic (attempt 1 < 2 < … ≤ the ceiling)', () => {
    expect(rejoin_backoff_ms(1)).toBeLessThan(rejoin_backoff_ms(2))
    expect(rejoin_backoff_ms(2)).toBeLessThan(rejoin_backoff_ms(3))
    expect(rejoin_backoff_ms(99)).toBe(rejoin_backoff_ms(50)) // both pinned at the ceiling
  })
  it('rejoin_ok resets the backoff AND requests a full re-announce (both sides converge)', () => {
    const { store, input } = boot()
    const reannounces = []
    subscribe_reannounce(store, (r) => reannounces.push(r))
    input({ type: 'room_lost' })
    expect(store.getState().rejoin_attempt).toBe(1)
    input({ type: 'rejoin_ok' })
    expect(store.getState().rejoin_attempt).toBe(0)
    expect(reannounces).toHaveLength(1)
  })
  it('network/visibility recovery re-arms an in-flight backoff to an IMMEDIATE rejoin; healthy = re-announce only', () => {
    const { store, input } = boot()
    const rejoins = []
    const reannounces = []
    subscribe_rejoin(store, (r) => rejoins.push(r))
    subscribe_reannounce(store, (r) => reannounces.push(r))
    // healthy (attempt 0): recovery re-announces (cheap convergence), never churns a rejoin on a working room
    input({ type: 'network_recover' })
    expect(rejoins).toHaveLength(0)
    expect(reannounces).toHaveLength(1)
    // lost mid-backoff: recovery kicks the scheduled rejoin to an IMMEDIATE (delay 0) retry
    input({ type: 'room_lost' })
    input({ type: 'network_recover' })
    expect(rejoins.at(-1)).toMatchObject({ delay: 0 })
  })
  it('reset (scene teardown / account switch) clears the backoff so a fresh join starts healthy', () => {
    const { store, input } = boot()
    input({ type: 'room_lost' })
    input({ type: 'reset' })
    expect(store.getState().rejoin_attempt).toBe(0)
  })
  it('stops automatic rejoins after a finite budget and exposes an honest terminal error', () => {
    const { store, input } = boot()
    const rejoins = []
    subscribe_rejoin(store, (r) => rejoins.push(r))

    for (let n = 0; n < 7; n++) input({ type: 'room_lost' })

    expect(rejoins).toHaveLength(6)
    expect(store.getState()).toMatchObject({
      rejoin_attempt: 6,
      link_status: 'failed',
    })
    expect(store.getState().link_error).toContain('6 attempts')
    const terminal = store.getState()
    input({ type: 'network_recover' })
    expect(store.getState()).toBe(terminal)
  })
})
