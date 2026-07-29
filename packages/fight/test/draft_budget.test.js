// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// draft-budget — the PURE turn-draft gating math the dungeon board rides on, locked against aresrpg_fight::cast
// (enforce_and_record_cast) + participant.move (give_points) + the auto-commit buffer the visible timer shares.
// These are the exact predicates DungeonBoard wires into its castable gate / optimistic MP pool and FightTimeline
// reads for the effective deadline; here they meet a CHAIN-TRUTH oracle (not a self-mirror), so a drift from the
// contract fails, not just a drift from the component. Component wiring is browser/render-proven separately.

import { describe, expect, it } from 'bun:test'

import {
  spell_mp_grant,
  on_cooldown,
  cooldown_left,
  cooldown_display,
  casts_at_cell,
  cap_of,
  effective_deadline,
  COMMIT_BUFFER_MS,
  POINT_MP,
} from '../src/draft_budget.js'

// ── FIX 1: the give_points(MP) fold (seed kind:6 / stat:1) ──────────────────────────────────────────────────
describe('spell_mp_grant — the drafted-cast MP grant folded into the movement pool', () => {
  // Vanish's real level-1 shape (seed/mainnet/spells/yajin.json → fight-spells.json): INVISIBILITY + GIVE_POINTS(MP).
  const vanish_l1 = {
    effects: [
      { kind: 'INVISIBILITY', base: 1, turns: 3 },
      { kind: 'GIVE_POINTS', base: 1, stat: POINT_MP, turns: 3 },
    ],
  }
  it('sums a give_points(MP) grant — Vanish → +1 MP', () => {
    expect(spell_mp_grant(vanish_l1)).toBe(1)
  })
  it('a give_points on the AP pool (stat 0) is NOT movement MP → 0', () => {
    expect(spell_mp_grant({ effects: [{ kind: 'GIVE_POINTS', base: 2, stat: 0 }] })).toBe(0)
  })
  it('a damage-only level grants no MP; a null level is 0 (never NaN)', () => {
    expect(spell_mp_grant({ effects: [{ kind: 'DAMAGE', base: 9 }] })).toBe(0)
    expect(spell_mp_grant(null)).toBe(0)
    expect(spell_mp_grant(undefined)).toBe(0)
  })
  it('sums MULTIPLE give_points(MP) effects on one level', () => {
    expect(
      spell_mp_grant({
        effects: [
          { kind: 'GIVE_POINTS', base: 1, stat: POINT_MP },
          { kind: 'GIVE_POINTS', base: 2, stat: POINT_MP },
        ],
      })
    ).toBe(3)
  })
})

// ── FIX 4: the cooldown lockout — the exact cast.move rule, across turn boundaries ──────────────────────────
describe('on_cooldown / cooldown_left — cast.move enforce_and_record_cast, across turns', () => {
  // The CHAIN ORACLE (cast.move): a cast recorded on the caster's own turn `last` (cooldown C) is recastable only
  // when `current − last > C`. Independent re-derivation of the contract to test our predicate against.
  const chain_locked = (last, current, C) => C > 0 && last != null && current - last <= C

  it('C=0 never locks (a no-cooldown spell); no prior cast is always free', () => {
    for (let t = 1; t <= 5; t += 1) expect(on_cooldown(1, t, 0)).toBe(false)
    expect(on_cooldown(null, 7, 4)).toBe(false)
    expect(on_cooldown(undefined, 7, 4)).toBe(false)
    expect(cooldown_left(null, 7, 4)).toBe(0)
  })

  it('Vanish (C=4) cast on turn 1: LOCKED turns 1–5, FREE from turn 6 — byte-for-byte the chain', () => {
    const C = 4
    const last = 1
    for (let current = 1; current <= 8; current += 1) {
      expect(on_cooldown(last, current, C)).toBe(chain_locked(last, current, C)) // matches the oracle every turn
    }
    // the boundary spelled out: the last locked turn and the first free turn
    expect(on_cooldown(1, 5, 4)).toBe(true) // 5 − 1 = 4 ≤ 4 → still on cooldown
    expect(on_cooldown(1, 6, 4)).toBe(false) // 6 − 1 = 5 > 4 → recastable
  })

  it('cooldown_left counts down to 0 exactly as the lock releases (drives the honest toast)', () => {
    expect(cooldown_left(1, 2, 4)).toBe(4)
    expect(cooldown_left(1, 3, 4)).toBe(3)
    expect(cooldown_left(1, 5, 4)).toBe(1) // one turn left
    expect(cooldown_left(1, 6, 4)).toBe(0) // free — and on_cooldown agrees
    expect(on_cooldown(1, 6, 4)).toBe(false)
  })

  it('a fresh cast RE-ARMS the window from the new turn (last advances with each committed cast)', () => {
    // cast on turn 1, then again on turn 6 (its first legal recast): locked anew 6–10, free 11.
    expect(on_cooldown(6, 10, 4)).toBe(true)
    expect(on_cooldown(6, 11, 4)).toBe(false)
  })
})

// ── #368: the hotbar's cooldown DISPLAY projection (spell-state → {greyed, turns_left}) ─────────────────────
describe('cooldown_display — the icon-grey + big-centered-number projection (#368)', () => {
  it('RED-FIRST: cast a C=4 spell on turn 1 — greys with the count, ticks down each turn, restores exactly on ready', () => {
    expect(cooldown_display(1, 2, 4)).toEqual({ greyed: true, turns_left: 4 })
    expect(cooldown_display(1, 3, 4)).toEqual({ greyed: true, turns_left: 3 })
    expect(cooldown_display(1, 4, 4)).toEqual({ greyed: true, turns_left: 2 })
    expect(cooldown_display(1, 5, 4)).toEqual({ greyed: true, turns_left: 1 }) // last locked turn
    expect(cooldown_display(1, 6, 4)).toEqual({ greyed: false, turns_left: 0 }) // restores EXACTLY on ready
  })

  it('never on cooldown: C=0, or no prior cast — never greyed, 0 turns', () => {
    expect(cooldown_display(1, 3, 0)).toEqual({ greyed: false, turns_left: 0 })
    expect(cooldown_display(null, 7, 4)).toEqual({ greyed: false, turns_left: 0 })
    expect(cooldown_display(undefined, 7, 4)).toEqual({ greyed: false, turns_left: 0 })
  })

  it('greyed and turns_left agree at every turn — one derivation, never a second on_cooldown recompute', () => {
    for (let current = 1; current <= 8; current += 1) {
      const { greyed, turns_left } = cooldown_display(1, current, 4)
      expect(greyed).toBe(on_cooldown(1, current, 4))
      expect(greyed).toBe(turns_left > 0)
      expect(turns_left).toBe(cooldown_left(1, current, 4))
    }
  })
})

// ── FIX 4: casts_per_target (per cell, per turn) + the cap sentinels ────────────────────────────────────────
describe('casts_at_cell / cap_of — the per-target cap that drops a saturated cell', () => {
  it('counts only entries matching BOTH spell_key and cell', () => {
    const path = [
      { cell: 40, spell_key: 'gutterknife' },
      { cell: 40, spell_key: 'gutterknife' },
      { cell: 41, spell_key: 'gutterknife' },
      { cell: 40, spell_key: 'vanish' },
    ]
    expect(casts_at_cell(path, 'gutterknife', 40)).toBe(2)
    expect(casts_at_cell(path, 'gutterknife', 41)).toBe(1)
    expect(casts_at_cell(path, 'vanish', 40)).toBe(1)
    expect(casts_at_cell([], 'gutterknife', 40)).toBe(0)
  })
  it('cap_of: only the chain sentinel 255 and an absent value are unlimited; authored 0 admits its first cast', () => {
    expect(cap_of(255)).toBe(Infinity)
    expect(cap_of(0)).toBe(1)
    expect(cap_of(null)).toBe(Infinity)
    expect(cap_of(undefined)).toBe(Infinity)
    expect(cap_of(2)).toBe(2) // Gutterknife casts_per_target — the 3rd cast at one cell is undraftable
  })
  it('the gate: Gutterknife (cap 2) blocks a 3rd cast at the SAME cell, never at a different cell', () => {
    const cap = cap_of(2)
    const path = [
      { cell: 40, spell_key: 'gutterknife' },
      { cell: 40, spell_key: 'gutterknife' },
    ]
    expect(casts_at_cell(path, 'gutterknife', 40) >= cap).toBe(true) // cell 40 saturated → drops out
    expect(casts_at_cell(path, 'gutterknife', 41) >= cap).toBe(false) // cell 41 still open
  })
})

// ── FIX 2: the effective deadline the visible timer counts to ───────────────────────────────────────────────
describe('effective_deadline — one honest clock (deadline − buffer while a draft exists)', () => {
  const deadline = 1_000_000
  it('with a live draft, counts to the auto-commit moment (deadline − COMMIT_BUFFER_MS)', () => {
    expect(effective_deadline(deadline, true)).toBe(deadline - COMMIT_BUFFER_MS)
    expect(COMMIT_BUFFER_MS).toBe(5_000) // r8: preserve submit margin beyond the measured 2.6s latency
  })
  it('idle (no draft) counts to the RAW deadline — the turn runs full length', () => {
    expect(effective_deadline(deadline, false)).toBe(deadline)
  })
  it('no deadline (0) stays 0 whether or not a draft exists (never a negative clock)', () => {
    expect(effective_deadline(0, true)).toBe(0)
    expect(effective_deadline(0, false)).toBe(0)
  })
})
