// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W2 gate suite (D770a spawns_zones) — red-first per the design note: (1) a search RECEIPT advances
// checkpoint + zone + hunt_zone ATOMICALLY; (2) a poll after a receipt converges as a NO-OP (order
// independence — grace-shielded adds, tombstoned removals); (3) a claim removes the group and hands off to
// the fight seam. Plus the two relocated renderer decisions (gather hysteresis + proximity arming) and the
// pending-until-settle affordance discipline, all asserted on plain objects — zero browser.

import { describe, expect, it } from 'bun:test'

import {
  create_spawns_store,
  reduce_spawns,
  spawn_rows,
  gather_target,
  attack_target,
  searchable_zone,
  affordance_rows,
  boot_spawn,
  subscribe_spawn_tx,
  subscribe_spawn_beats,
  subscribe_fight_entry,
} from './spawns_zones.js'
import {
  zone_row_of,
  pick_gather_target,
  is_group_claimable,
  zone_searchable,
  PROXIMITY_M,
  GATHER_HYSTERESIS_M,
  RECEIPT_GRACE_MS,
  SEARCH_PROGRESS_MS,
} from './spawns_reconcile.js'
import { OPENNESS_GROUP } from './openness.js'

const WORLD = `0x${'a'.repeat(64)}`
const TMPL = `0x${'b'.repeat(64)}`
// A 100×100-zone world with bounds 1000 → offset 500: chain (500, 500) = world (0, 0), zone (5, 5).
const DOC = { zone_size: 100, bounds_x: 1000, bounds_z: 1000, zone_ttl_ms: 60_000 }

const mob = (spawn_id, x, z, extra = {}) => ({ spawn_id, kind: 'mob', x, z, template_id: TMPL, size: 3, ...extra })
const res = (spawn_id, x, z, extra = {}) => ({
  spawn_id,
  kind: 'resource',
  x,
  z,
  template_id: TMPL,
  remaining: 1,
  job: 0,
  tier: 1,
  ...extra,
})

/** A bound world with dims resolved — every scenario's opening. */
const boot = (now = 1_000) => {
  const store = create_spawns_store()
  const input = (msg, at = now) => store.getState().input(msg, at)
  input({ type: 'world_bound', world_id: WORLD })
  input({ type: 'world_doc', doc: DOC })
  return { store, input, state: () => store.getState() }
}

describe('boot facts — world binding, dims, checkpoint seeding', () => {
  it('world_bound + world_doc resolve the codec (zone_size, offsets, ttl)', () => {
    const { state } = boot()
    expect(state()).toMatchObject({
      world_id: WORLD,
      zone_size: 100,
      offset_x: 500,
      offset_z: 500,
      zone_ttl_ms: 60_000,
    })
  })
  it('a chain-direct checkpoint read seeds checkpoint (world space) AND hunt_zone (one unified fact)', () => {
    const { input, state } = boot()
    input({ type: 'checkpoint_resolved', world_id: WORLD, x: 520, z: 540, source: 'read' })
    expect(state().checkpoint).toEqual({ x: 20, z: 40 })
    expect(state().hunt_zone).toEqual({ zx: 5, zy: 5 })
  })
  it('an indexed doc position SEEDS only when unknown — it never clobbers a live fact', () => {
    const { input, state } = boot()
    input({ type: 'checkpoint_resolved', world_id: WORLD, x: 950, z: 950, source: 'indexed' })
    expect(state().hunt_zone).toEqual({ zx: 9, zy: 9 }) // cold-boot seed accepted
    expect(state().checkpoint).toBe(null) // an indexed position is not boot-grade
    input({ type: 'checkpoint_resolved', world_id: WORLD, x: 520, z: 540, source: 'read' })
    input({ type: 'checkpoint_resolved', world_id: WORLD, x: 111, z: 111, source: 'indexed' })
    expect(state().hunt_zone).toEqual({ zx: 5, zy: 5 }) // the read holds; indexed never clobbers
  })
  it('world_bound to a DIFFERENT world resets every zone fact (a stale zone never crosses worlds)', () => {
    const { input, state } = boot()
    input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 1 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('1', 520, 520)] }],
    })
    expect(spawn_rows(state()).length).toBe(1)
    input({ type: 'world_bound', world_id: `0x${'c'.repeat(64)}` })
    expect(spawn_rows(state()).length).toBe(0)
    expect(state().hunt_zone).toBe(null)
  })
  it('boot_spawn projects the checkpoint through the resolve_boot_spawn arbiter (chain wins over a far session)', () => {
    const { input, state } = boot()
    input({ type: 'checkpoint_resolved', world_id: WORLD, x: 520, z: 540, source: 'read' })
    const far = boot_spawn(state(), { session: { x: 900, z: 900, y: 10 }, fallback: [0, 80, 0], y_seed: 80 })
    expect(far).toMatchObject({ source: 'checkpoint', position: [20, 80, 40] })
    const near = boot_spawn(state(), { session: { x: 22, z: 41, y: 10, yaw: 1 }, fallback: [0, 80, 0], y_seed: 80 })
    expect(near).toMatchObject({ source: 'session', position: [22, 10, 41] })
  })
})

describe('the versioned snapshot — chain rows in, world space out, stale polls discarded', () => {
  it('ingests rows chain→world (offset applied) and keys them zx:zy:kind:spawn_id', () => {
    const { input, state } = boot()
    input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }],
    })
    const rows = spawn_rows(state())
    expect(rows).toEqual([
      { key: '5:5:mob:7', zx: 5, zy: 5, kind: 'mob', pending: null, row: expect.objectContaining({ x: 20, z: 40 }) },
    ])
  })
  it('a snapshot with a stale version is DISCARDED wholesale', () => {
    const { input, state } = boot()
    input({
      type: 'zones_rows_snapshot',
      version: 5,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }],
    })
    input({ type: 'zones_rows_snapshot', version: 4, zones: [], cells: [] }) // late out-of-order poll
    expect(spawn_rows(state()).length).toBe(1)
  })
  it('an identical snapshot converges as a NO-OP on the projected rows', () => {
    const { input, state } = boot()
    const snap = (version) => ({
      type: 'zones_rows_snapshot',
      version,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }],
    })
    input(snap(1))
    const before = spawn_rows(state())
    input(snap(2))
    expect(spawn_rows(state())).toEqual(before)
  })
  it('a fresh cell read MERGES rows instead of replacing already-visible spawns', () => {
    const { input, state } = boot()
    input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('visible', 520, 540)] }],
    })
    input({
      type: 'zones_rows_snapshot',
      version: 2,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 10 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('searched', 522, 542)] }],
    })
    expect(spawn_rows(state()).map((row) => row.key).sort()).toEqual([
      '5:5:mob:searched',
      '5:5:mob:visible',
    ])
  })
})

// ─── THE W2 GATE ROWS (red-first): receipt atomicity · order independence · claim handoff ───

describe('zone_searched RECEIPT — checkpoint + zone + hunt_zone advance ATOMICALLY', () => {
  it('one receipt input advances all three facts + emits the reveal beats', () => {
    const { input, state } = boot()
    const beats = []
    // x/z are the SIGNED WORLD standing position the search was fired from (world (30, 45) = zone (5,5)).
    input({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 3, resource_nodes: 2 } })
    expect(state().checkpoint).toEqual({ x: 30, z: 45 }) // the search PROVED this standing position
    expect(state().hunt_zone).toEqual({ zx: 5, zy: 5 })
    expect(state().zones.get('5:5')).toBeTruthy() // the zone is DISCOVERED
    for (const b of state().beats) beats.push(b.kind)
    expect(beats).toEqual(['reveal_chime', 'reveal_banner', 'fov_pulse'])
    expect(state().beats.find((b) => b.kind === 'reveal_banner')?.payload).toEqual({ mob_groups: 3, resource_nodes: 2 })
  })
  it('the receipt resolves the pending search (pending-until-settle as data)', () => {
    const { input, state } = boot()
    input({ type: 'player_pos', x: 30, z: 45 })
    input({ type: 'search_intent', x: 30, z: 45 })
    expect(state().pending.has('search:5:5')).toBe(true)
    input({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 1, resource_nodes: 0 } })
    expect(state().pending.has('search:5:5')).toBe(false)
  })
  it(
    'zone_row_of flips zone K to discovered the SAME tick as the receipt — no poll input dispatched at all ' +
      '(the fact CompassStrip reads via reconciled_zone_row, compass_math.js)',
    () => {
      const { input, state } = boot()
      expect(zone_row_of(state().zones, 5, 5)).toBeNull() // unsearched, before the receipt
      input({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 1, resource_nodes: 0 } }, 42_000)
      // no 'zones_rows_snapshot' / 'zone_rows' poll input was ever dispatched — pure receipt, pure read.
      expect(zone_row_of(state().zones, 5, 5)).toEqual({ discovered: true, discovered_at_ms: 42_000 })
    }
  )
  it('an explicit TTL re-search replaces only that zone under the visible reveal transition', () => {
    const { input, state } = boot()
    input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [
        { zx: 5, zy: 5, discovered_at_ms: 1 },
        { zx: 6, zy: 5, discovered_at_ms: 1 },
      ],
      cells: [
        { zx: 5, zy: 5, rows: [mob('old-generation', 520, 540)] },
        { zx: 6, zy: 5, rows: [mob('neighbour', 620, 540)] },
      ],
    })
    input({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 1, resource_nodes: 0 } })
    expect(spawn_rows(state()).map((row) => row.key)).toEqual(['6:5:mob:neighbour'])
    expect(state().beats.slice(-3).map((beat) => beat.kind)).toEqual([
      'reveal_chime',
      'reveal_banner',
      'fov_pulse',
    ])
  })
})

describe('order independence — a poll NEVER regresses a receipt-proven fact, and agreement converges no-op', () => {
  it('receipt-discovered zone + chain-direct rows survive a LAGGING snapshot that omits them (grace)', () => {
    const { input, state } = boot(10_000)
    input({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 1, resource_nodes: 0 } }, 10_000)
    input({ type: 'zone_rows', zx: 5, zy: 5, proven: true, rows: [mob('7', 520, 540)] }, 10_200)
    // the lagging 6s poll — pre-search indexer state: zone absent, rows absent
    input({ type: 'zones_rows_snapshot', version: 1, zones: [], cells: [] }, 11_000)
    expect(state().zones.get('5:5')).toBeTruthy() // the discovered zone SURVIVES
    expect(spawn_rows(state()).map((r) => r.key)).toEqual(['5:5:mob:7']) // the proven rows SURVIVE
    // the poll catches up and LISTS the zone+row → shield clears, facts adopt the indexer stamps
    input(
      {
        type: 'zones_rows_snapshot',
        version: 2,
        zones: [{ zx: 5, zy: 5, discovered_at_ms: 10_050 }],
        cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }],
      },
      12_000
    )
    expect(state().zones.get('5:5')?.discovered_at_ms).toBe(10_050)
    expect(state().zones.get('5:5')?.row_proven.size).toBe(0) // confirmed — shield dropped
    // ...and a THIRD identical poll is a byte-level no-op on the projection
    const before = spawn_rows(state())
    input(
      {
        type: 'zones_rows_snapshot',
        version: 3,
        zones: [{ zx: 5, zy: 5, discovered_at_ms: 10_050 }],
        cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }],
      },
      13_000
    )
    expect(spawn_rows(state())).toEqual(before)
  })
  it('the grace is a CAP, not a shield forever: an unconfirmed proven row expires after RECEIPT_GRACE_MS', () => {
    const { input, state } = boot(10_000)
    input({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 1, resource_nodes: 0 } }, 10_000)
    input({ type: 'zone_rows', zx: 5, zy: 5, proven: true, rows: [mob('7', 520, 540)] }, 10_000)
    input({ type: 'zones_rows_snapshot', version: 1, zones: [], cells: [] }, 10_000 + RECEIPT_GRACE_MS + 1)
    expect(spawn_rows(state()).length).toBe(0)
  })
})

describe('claim — pending hides, receipt removes + tombstones + hands off to the fight seam', () => {
  const armed = (now = 1_000) => {
    const ctx = boot(now)
    ctx.input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540), res('9', 522, 541)] }],
    })
    ctx.input({ type: 'player_pos', x: 21, z: 41 }) // ~1.4 blocks from the mob anchor (20, 40)
    return ctx
  }
  it('proximity arms the [R] target; claim_intent emits claim_tx (with openness) and marks the row pending', () => {
    const { store, input, state } = armed()
    expect(attack_target(state())?.key).toBe('5:5:mob:7') // ARMING IS FOLD STATE — the renderer decides nothing
    const requests = []
    subscribe_spawn_tx(store, (req) => requests.push(req))
    input({ type: 'openness_set', value: OPENNESS_GROUP })
    input({ type: 'claim_intent', key: '5:5:mob:7' })
    expect(state().tx_request).toMatchObject({
      kind: 'claim',
      payload: { spawn_id: '7', zx: 5, zy: 5, is_public: false },
    })
    expect(requests.map((r) => r.kind)).toEqual(['claim']) // the effect edge saw exactly one request
    expect(spawn_rows(state()).find((r) => r.key === '5:5:mob:7')?.pending).toBe('claim') // optimistic hide as data
    expect(attack_target(state())).toBe(null) // a pending row stops being a target (the press dropped the pill)
  })
  it('claim_intent REFUSES beyond proximity (the far-click teaches "get closer", never a doomed tx)', () => {
    const { input, state } = armed()
    input({ type: 'player_pos', x: 90, z: 90 })
    input({ type: 'claim_intent', key: '5:5:mob:7' })
    expect(state().tx_request).toBe(null)
    expect(state().pending.size).toBe(0)
  })
  it('claim_receipt removes the group, advances checkpoint+hunt_zone to it, emits fight_entry — and a stale poll cannot resurrect it', () => {
    const { store, input, state } = armed(20_000)
    const entries = []
    subscribe_fight_entry(store, (e) => entries.push(e))
    input({ type: 'claim_intent', key: '5:5:mob:7' }, 20_000)
    input({ type: 'claim_receipt', key: '5:5:mob:7', fight_id: '0xf1647', at: 20_500 }, 20_500)
    expect(spawn_rows(state()).find((r) => r.key === '5:5:mob:7')).toBeUndefined() // REMOVED
    expect(state().pending.size).toBe(0)
    expect(state().checkpoint).toEqual({ x: 20, z: 40 }) // the claim travel-verified to the GROUP
    expect(state().hunt_zone).toEqual({ zx: 5, zy: 5 })
    expect(state().fight_entry).toMatchObject({ fight_id: '0xf1647' }) // the HANDOFF the fight core picks up
    expect(entries.map((e) => e.fight_id)).toEqual(['0xf1647']) // the effect edge saw it exactly once
    // the lagging poll still lists the claimed row → the tombstone holds the removal
    input(
      {
        type: 'zones_rows_snapshot',
        version: 2,
        zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
        cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540), res('9', 522, 541)] }],
      },
      21_000
    )
    expect(spawn_rows(state()).find((r) => r.key === '5:5:mob:7')).toBeUndefined()
    // a poll past the grace that STILL lists it would re-adopt chain truth (the tombstone is a cap, not a veto)
    input(
      {
        type: 'zones_rows_snapshot',
        version: 3,
        zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
        cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }],
      },
      21_000 + RECEIPT_GRACE_MS
    )
    expect(spawn_rows(state()).find((r) => r.key === '5:5:mob:7')).toBeTruthy()
  })
  it('claim_failed restores the row (honest rollback); the 108 GHOST variant drops it instead', () => {
    const { input, state } = armed()
    input({ type: 'claim_intent', key: '5:5:mob:7' })
    input({ type: 'claim_failed', key: '5:5:mob:7' })
    expect(spawn_rows(state()).find((r) => r.key === '5:5:mob:7')?.pending).toBe(null) // visible again
    input({ type: 'claim_intent', key: '5:5:mob:7' })
    input({ type: 'claim_failed', key: '5:5:mob:7', ghost: true })
    expect(spawn_rows(state()).find((r) => r.key === '5:5:mob:7')).toBeUndefined() // the ghost is dropped
  })
})

// ─── ATTACK-PROMPT VISIBILITY vs ENGAGE LEGALITY — the attack button shows at 3-4 blocks from the
// group, for convenience — the [R] prompt ARMS on a WIDER ring (ATTACK_VISIBLE_M, measured from the NEAREST fed
// member, not the invisible centroid), while the claim door's LEGALITY stays the 6-block ANCHOR ring. The renderer
// feeds each placed group's member positions as a TYPED INPUT (never a reach-out read); with none fed the anchor
// is the sole basis (an unplaced group is always far, where anchor ≈ group). Reducer outputs BOTH flags.
describe('attack visibility widens to the nearest member; engage legality stays the anchor ring', () => {
  const placed = (now = 1_000) => {
    const ctx = boot(now)
    ctx.input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }], // anchor world (20, 40)
    })
    // the renderer feeds the placed group's member positions (world space); nearest member 2 blocks toward +x
    ctx.input({
      type: 'member_positions',
      key: '5:5:mob:7',
      members: [
        { x: 22, z: 40 },
        { x: 18, z: 40 },
        { x: 20, z: 42 },
      ],
    })
    return ctx
  }
  it('a player 3.5 blocks BEYOND the 6-block engage ring is VISIBLE but not ENGAGEABLE', () => {
    const { input, state } = placed()
    input({ type: 'player_pos', x: 29.5, z: 40 }) // anchor_dist 9.5 (= 6 + 3.5); nearest member 7.5 away (≤ 10)
    expect(state().attack_target_key).toBe('5:5:mob:7') // the [R] prompt ARMS on the wider ring
    expect(state().attack_engageable).toBe(false) // …but the claim door still refuses — anchor 9.5 > 6
    input({ type: 'claim_intent', key: '5:5:mob:7' })
    expect(state().tx_request).toBe(null) // LEGALITY unchanged — a far press never fires a doomed tx
    expect(state().pending.size).toBe(0)
  })
  it('far beyond BOTH rings arms nothing', () => {
    const { input, state } = placed()
    input({ type: 'player_pos', x: 35, z: 40 }) // nearest member 13 away (> 10)
    expect(state().attack_target_key).toBe(null)
    expect(state().attack_engageable).toBe(false)
  })
  it('inside the engage ring is VISIBLE and ENGAGEABLE (the gold state)', () => {
    const { input, state } = placed()
    input({ type: 'player_pos', x: 24, z: 40 }) // anchor_dist 4 (≤ 6); nearest member 2 away
    expect(state().attack_target_key).toBe('5:5:mob:7')
    expect(state().attack_engageable).toBe(true)
  })
  it('with NO members fed the anchor is the sole basis (an unplaced far group is never mis-armed)', () => {
    const ctx = boot()
    ctx.input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }],
    })
    ctx.input({ type: 'player_pos', x: 29, z: 40 }) // anchor_dist 9 (≤ 10) → visible off the anchor, not engageable
    expect(ctx.state().attack_target_key).toBe('5:5:mob:7')
    expect(ctx.state().attack_engageable).toBe(false)
    ctx.input({ type: 'player_pos', x: 31, z: 40 }) // anchor_dist 11 (> 10) → not visible
    expect(ctx.state().attack_target_key).toBe(null)
  })
  it('member_positions is a pure typed input — clearing it reverts to the anchor basis', () => {
    const ctx = boot()
    ctx.input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [mob('7', 520, 540)] }], // anchor world (20, 40)
    })
    ctx.input({ type: 'member_positions', key: '5:5:mob:7', members: [{ x: 24, z: 40 }] }) // member 4 blocks toward +x
    ctx.input({ type: 'player_pos', x: 32, z: 40 }) // anchor_dist 12 (> 10) but nearest member 8 away (≤ 10)
    expect(ctx.state().attack_target_key).toBe('5:5:mob:7') // VISIBLE off the nearest member
    ctx.input({ type: 'member_positions', key: '5:5:mob:7', members: [] }) // renderer tore the group down
    expect(ctx.state().attack_target_key).toBe(null) // anchor 12 > 10 → no longer visible off the anchor
  })
})

describe('gather — hysteresis in the fold, receipt-shielded depletion', () => {
  const field = () => {
    const ctx = boot()
    // two adjacent nodes ~1 chain block apart (world x 0 and 1.2), the exact flicker geometry
    ctx.input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows: [res('a', 520, 540), res('b', 521.2, 540, { remaining: 2 })] }],
    })
    return ctx
  }
  it('the armed target HOLDS across the equidistant line; only a MEANINGFULLY closer node switches it', () => {
    const { input, state } = field()
    input({ type: 'player_pos', x: 20.0, z: 40 }) // standing on node a
    expect(gather_target(state())?.key).toBe('5:5:resource:a')
    input({ type: 'player_pos', x: 20.7, z: 40 }) // 0.1 past the midpoint toward b — inside the margin
    expect(gather_target(state())?.key).toBe('5:5:resource:a') // HELD (no flicker)
    input({ type: 'player_pos', x: 21.2, z: 40 }) // standing on b — meaningfully closer
    expect(gather_target(state())?.key).toBe('5:5:resource:b')
  })
  it('gather_intent fires gather_tx for the ARMED target; the receipt decrements remaining and shields it', () => {
    const { input, state } = field()
    input({ type: 'player_pos', x: 21.2, z: 40 })
    input({ type: 'gather_intent' })
    expect(state().tx_request).toMatchObject({ kind: 'gather', payload: { spawn_id: 'b', zx: 5, zy: 5 } })
    input({ type: 'gather_receipt', key: '5:5:resource:b' }, 2_000)
    expect(spawn_rows(state()).find((r) => r.key === '5:5:resource:b')?.row.remaining).toBe(1)
    // a lagging poll still reporting remaining: 2 cannot regress the receipt inside the grace window
    input(
      {
        type: 'zones_rows_snapshot',
        version: 2,
        zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
        cells: [{ zx: 5, zy: 5, rows: [res('a', 520, 540), res('b', 521.2, 540, { remaining: 2 })] }],
      },
      3_000
    )
    expect(spawn_rows(state()).find((r) => r.key === '5:5:resource:b')?.row.remaining).toBe(1)
  })
  it('a receipt on the LAST charge removes the node (tombstoned against the lagging poll)', () => {
    const { input, state } = field()
    input({ type: 'player_pos', x: 20, z: 40 })
    input({ type: 'gather_intent' })
    input({ type: 'gather_receipt', key: '5:5:resource:a' }, 2_000) // remaining 1 → 0
    expect(spawn_rows(state()).find((r) => r.key === '5:5:resource:a')).toBeUndefined()
    input(
      {
        type: 'zones_rows_snapshot',
        version: 2,
        zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
        cells: [{ zx: 5, zy: 5, rows: [res('a', 520, 540)] }],
      },
      3_000
    )
    expect(spawn_rows(state()).find((r) => r.key === '5:5:resource:a')).toBeUndefined()
  })
})

describe('search_intent — the [F] press through the door', () => {
  it('emits search_tx + the progress beat, latches single-flight pending per zone', () => {
    const { input, state } = boot()
    input({ type: 'player_pos', x: 30, z: 45 })
    input({ type: 'search_intent', x: 30, z: 45 })
    expect(state().tx_request).toMatchObject({ kind: 'search', payload: { world_id: WORLD, zx: 5, zy: 5 } })
    expect(state().beats.at(-1)).toMatchObject({ kind: 'search_progress', duration: SEARCH_PROGRESS_MS })
    const before = state()
    input({ type: 'search_intent', x: 31, z: 44 }) // pressed again while in flight — single-flight as data
    expect(state()).toBe(before)
  })
  it('REFUSES a fresh discovered zone (EZoneFresh mirror) and re-arms once the TTL elapses', () => {
    const { input, state } = boot()
    input(
      { type: 'zones_rows_snapshot', version: 1, zones: [{ zx: 5, zy: 5, discovered_at_ms: 1_000 }], cells: [] },
      1_500
    )
    input({ type: 'player_pos', x: 30, z: 45 })
    input({ type: 'search_intent', x: 30, z: 45 }, 2_000) // ttl 60s — still fresh
    expect(state().tx_request).toBe(null)
    expect(searchable_zone(state(), 2_000)).toBe(null)
    expect(searchable_zone(state(), 62_000)).toEqual({ zx: 5, zy: 5 }) // TTL elapsed → re-armed
    input({ type: 'search_intent', x: 30, z: 45 }, 62_000)
    expect(state().tx_request).toMatchObject({ kind: 'search' })
  })
})

describe('affordance rows — [F]/[G]/[R] as one data contract', () => {
  it('renders the three rows off the atom with pending-until-settle discipline', () => {
    const { input, state } = boot()
    input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 4, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 4, zy: 5, rows: [mob('7', 420, 540), res('9', 421, 541)] }],
    })
    input({ type: 'player_pos', x: -79, z: 41 }) // zone (4,5): near both rows; the standing zone (5,5)? no — (-79,41) → zone 4
    const rows = affordance_rows(state(), 2_000)
    expect(rows.map((r) => r.id).sort()).toEqual(['attack', 'gather']) // zone 4:5 is discovered+fresh → no search row
    input({ type: 'claim_intent', key: '4:5:mob:7' })
    expect(affordance_rows(state(), 2_000).find((r) => r.id === 'attack')).toBeUndefined() // pending row left the stack
  })
})

describe('the pure rules stand alone (moved homes: hunt_zone / spawn_rigs / compass_math)', () => {
  it('is_group_claimable — in reach claims, far does not, garbage never', () => {
    expect(is_group_claimable(0, 0, 3, 4, PROXIMITY_M)).toBe(true)
    expect(is_group_claimable(0, 0, 5, 5, 6)).toBe(false)
    expect(is_group_claimable(NaN, 0, 1, 1, 6)).toBe(false)
    expect(is_group_claimable(0, 0, 1, 1, 0)).toBe(false)
  })
  it('pick_gather_target — the hysteresis table', () => {
    expect(
      pick_gather_target({
        armed_key: null,
        armed_d2: null,
        nearest_key: 'b',
        nearest_d2: 1,
        margin_m: GATHER_HYSTERESIS_M,
      })
    ).toBe('b')
    expect(pick_gather_target({ armed_key: 'a', armed_d2: 1, nearest_key: 'a', nearest_d2: 1, margin_m: 0.75 })).toBe(
      'a'
    )
    expect(
      pick_gather_target({ armed_key: 'a', armed_d2: 1.44, nearest_key: 'b', nearest_d2: 1, margin_m: 0.75 })
    ).toBe('a') // 1.2 vs 1.0 — held
    expect(pick_gather_target({ armed_key: 'a', armed_d2: 9, nearest_key: 'b', nearest_d2: 1, margin_m: 0.75 })).toBe(
      'b'
    ) // 3 vs 1 — switch
  })
  it('zone_searchable — undiscovered searches, fresh refuses, elapsed TTL re-arms', () => {
    expect(zone_searchable(null, 60_000, 5_000)).toBe(true)
    expect(zone_searchable({ discovered: true, discovered_at_ms: 1_000 }, 60_000, 5_000)).toBe(false)
    expect(zone_searchable({ discovered: true, discovered_at_ms: 1_000 }, 60_000, 61_001)).toBe(true)
    expect(zone_searchable({ discovered: true, discovered_at_ms: 1_000 }, null, 61_001)).toBe(false) // no ttl → never re-arms
  })
})

describe('constitution — purity + no-op discipline', () => {
  it('the fold never mutates its inputs (the snapshot rows array and the prior state survive byte-identical)', () => {
    const { input, state } = boot()
    const rows = [mob('7', 520, 540)]
    const frozen = JSON.stringify(rows)
    const before = state()
    input({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 5, zy: 5, discovered_at_ms: 9 }],
      cells: [{ zx: 5, zy: 5, rows }],
    })
    expect(JSON.stringify(rows)).toBe(frozen)
    expect(before.zones.size).toBe(0) // the prior state object was never written through
  })
  it('an input that changes nothing returns the SAME state reference (the door skips the commit)', () => {
    const { input, state } = boot()
    input({ type: 'player_pos', x: 10, z: 10 })
    const committed = state()
    input({ type: 'player_pos', x: 10, z: 10 }) // standing still
    expect(state()).toBe(committed)
    input({ type: 'world_doc', doc: DOC }) // identical doc facts
    expect(state()).toBe(committed)
  })
  it('reduce_spawns is a pure export usable without the store', () => {
    const s0 = create_spawns_store().getState()
    const s1 = reduce_spawns(s0, { type: 'world_bound', world_id: WORLD }, 0)
    expect(s1.world_id).toBe(WORLD)
    expect(s0.world_id).toBe(null)
  })
  it('beat subscribers see each beat exactly once, in order', () => {
    const store = create_spawns_store()
    const input = (msg, at = 1_000) => store.getState().input(msg, at)
    input({ type: 'world_bound', world_id: WORLD })
    input({ type: 'world_doc', doc: DOC })
    const kinds = []
    subscribe_spawn_beats(store, (b) => kinds.push(b.kind))
    input({ type: 'player_pos', x: 30, z: 45 })
    input({ type: 'search_intent', x: 30, z: 45 })
    input({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 1, resource_nodes: 0 } })
    expect(kinds).toEqual(['search_progress', 'reveal_chime', 'reveal_banner', 'fov_pulse'])
  })
})
