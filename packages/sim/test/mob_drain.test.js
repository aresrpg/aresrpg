// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { remove_points, net_refill } from '../src/spell_formula.js'
import { dodge_seed, turn_seed, slot_crit_roll } from '../src/turn_seed.js'
import {
  empty,
  add_status,
  fighter_point_debt,
  fighter_point_credit,
  collect_spent_statuses,
  decrement_fighter_statuses,
  clear_fighter,
  fighter_alter_rows,
} from '../src/effect_board.js'
import {
  drain_row,
  credit_row,
  alter_stat,
  POINT_AP,
  POINT_MP,
} from '../src/spell_effect.js'

// PARITY: the client previews an AP/MP drain's agility-contested dodge byte-for-byte with the
// on-chain resolver. These pin the sim mirror against the Move spell_formula golden values + the mob drain-debt /
// alter-row readers the resolver added.

describe('AP/MP-removal contest — spell_formula.remove_points ↔ chain golden', () => {
  test('guaranteed (no dodge) = min(current, value), rng untouched — Move t_remove_points_guaranteed', () => {
    const r = remove_points(0, 3, false, 0, 0, 2, 6)
    expect(r.removed).toBe(2) // capped at current
    expect(r.state).toBe(0) // no draw
    expect(remove_points(0, 2, false, 0, 0, 6, 6).removed).toBe(2)
  })

  test('dodged at the floor — Move t_remove_points_dodged_at_floor (removed 0)', () => {
    expect(remove_points(0, 3, true, 0, 100, 6, 6).removed).toBe(0)
  })

  test('hits at the ceiling — Move t_remove_points_hits_at_ceiling (removed 1)', () => {
    expect(remove_points(0, 1, true, 1000, 1, 6, 6).removed).toBe(1)
  })

  test('agility contest: a high dodge term removes strictly fewer than a low one (same seed/caster)', () => {
    const lo = remove_points(424242, 6, true, 200, 1, 6, 6).removed // dodge term 1 (no agility)
    const hi = remove_points(424242, 6, true, 200, 300, 6, 6).removed // dodge term 300 (a boss's agility)
    expect(hi).toBeLessThan(lo)
  })

  test('determinism: same seed ⇒ same removed (client-previewable)', () => {
    expect(remove_points(424242, 6, true, 200, 1, 6, 6).removed).toBe(
      remove_points(424242, 6, true, 200, 1, 6, 6).removed,
    )
  })
})

describe('dodge_seed — the turn-seed dodge stream ↔ spell_formula::dodge_seed', () => {
  test('deterministic, slot-bound, and a DISTINCT domain from the crit stream', () => {
    const ts = turn_seed({
      world_seed: 12345,
      spawn_id: 1,
      turn_entropy: 999,
      turn_ordinal: 1,
      seat: 0,
    })
    expect(dodge_seed(ts, 0)).toBe(dodge_seed(ts, 0)) // deterministic
    expect(dodge_seed(ts, 0)).not.toBe(dodge_seed(ts, 1)) // slot-bound
    expect(dodge_seed(ts, 0)).not.toBe(slot_crit_roll(ts, 0)) // ≠ crit domain
  })
})

describe('effect_board drain debt + alter rows ↔ spell_board', () => {
  test('fighter_point_debt sums live drain rows per pool; alter rows read separately', () => {
    const b = empty()
    add_status(b, 1000, 0, drain_row(POINT_AP, 3, 1)) // mob fid 1000: 3 AP debt
    add_status(b, 1000, 0, drain_row(POINT_AP, 2, 2)) // +2 AP
    add_status(b, 1000, 0, drain_row(POINT_MP, 4, 1)) // 4 MP (separate pool)
    add_status(b, 1000, 0, alter_stat(0, 50, true, false, 3)) // a str-shred row — NOT a drain
    expect(fighter_point_debt(b, 1000, POINT_AP)).toBe(5)
    expect(fighter_point_debt(b, 1000, POINT_MP)).toBe(4)
    expect(fighter_point_debt(b, 1001, POINT_AP)).toBe(0) // another fighter is untouched
    expect(fighter_alter_rows(b, 1000).length).toBe(1) // the shred row only, not the drains
  })
})

// ── MOB_DEBUFF_HAT fix goldens — the three real-flow scenarios the fresh-pool suites masked ──────────────────

describe('P1 #1 — spent-pool drain lands its full weight on the refill', () => {
  test('contest vs the refill BASE: residual pool is irrelevant; next refill = base − debt (chain golden 2)', () => {
    // mob mid-turn-cycle at 1/6 AP; guaranteed drain 4 contests against base 6 → removed 4 (NOT residual-capped 1).
    const { removed } = remove_points(1, 4, false, 50, 0, 6, 6) // current = max = base (the P1 #1 read)
    expect(removed).toBe(4)
    const b = empty()
    add_status(b, 1000, 0, drain_row(POINT_AP, removed, 1))
    // Move golden (spent_pool_drain_lands_full_debt): begin_turn refills to 6 − 4 = 2, never full.
    expect(net_refill(6, fighter_point_debt(b, 1000, POINT_AP), 0)).toBe(2)
  })
})

describe('P1 #2 — feed-then-act: the credit survives begin_turn, then expires', () => {
  test('ally +2 MP credit → refill = base + 2 (chain golden 8) → expiry → base', () => {
    const b = empty()
    add_status(b, 1000, 0, credit_row(POINT_MP, 2, 1)) // the ally's feed, recorded off-turn
    expect(fighter_point_credit(b, 1000, POINT_MP)).toBe(2)
    // THE BOSS'S TURN, in the chain's order (#2000): expiry first, THEN point_adjust, then begin_turn. The
    // authored 1 still has this turn coming, so the aging spends its counter and leaves the row live.
    decrement_fighter_statuses(b, 1000)
    // the boss's begin_turn folds the credit — MP at act time is 8 (Move: ally_feed_survives_begin_turn).
    expect(
      net_refill(
        6,
        fighter_point_debt(b, 1000, POINT_MP),
        fighter_point_credit(b, 1000, POINT_MP),
      ),
    ).toBe(8)
    // #2033 — that turn's END collects the spent row, so the NEXT refill is back to base.
    collect_spent_statuses(b, 1000)
    expect(fighter_point_credit(b, 1000, POINT_MP)).toBe(0)
    expect(net_refill(6, 0, 0)).toBe(6)
  })

  test('net_refill fold order: credit in BEFORE the debt clamp (over-drained-but-fed keeps the remainder)', () => {
    expect(net_refill(6, 8, 3)).toBe(1) // (6+3)−8 — NOT ((6−8)⌊0⌋)+3 = 3, and NOT 0
    expect(net_refill(6, 100, 2)).toBe(0) // still floors at 0, never wraps
  })
})

describe('P3 — death fold purges the corpse rows (order-exact with the Move twin)', () => {
  test('clear_fighter drops only the dead fid; survivors keep the Move pop/push (reversed) order', () => {
    const b = empty()
    add_status(b, 1000, 0, drain_row(POINT_AP, 3, 2)) // the corpse's rows
    add_status(b, 7, 0, drain_row(POINT_AP, 1, 2)) // a survivor's row A
    add_status(b, 7, 0, drain_row(POINT_MP, 2, 2)) // a survivor's row B
    clear_fighter(b, 1000)
    expect(fighter_point_debt(b, 1000, POINT_AP)).toBe(0) // the corpse's debt is gone
    expect(fighter_point_debt(b, 7, POINT_AP)).toBe(1) // the survivor's rows persist
    expect(fighter_point_debt(b, 7, POINT_MP)).toBe(2)
    // order parity: Move's pop_back/push_back REVERSES the kept rows — B now precedes A.
    expect(b.statuses.map(s => s.effect.stat)).toEqual([POINT_MP, POINT_AP])
  })
})
