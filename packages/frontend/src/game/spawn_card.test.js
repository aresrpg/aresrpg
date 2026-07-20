// The client mirror of the chain's §8 aging XP bonus must match aresrpg_fight::fight::aging_bp EXACTLY (whole-
// hour floor, +1%/h, capped at +100%) — the card previews what a fight started now would bank, so a lie here
// is a lie to the player. These pin the formula against the Move kernel (fight.move:383-389 + config defaults).

import { describe, expect, it } from 'bun:test'

import { aging_bonus_pct } from './spawn_card.js'

const HOUR = 3_600_000
const t0 = 1_700_000_000_000 // an arbitrary spawn epoch

describe('aging_bonus_pct', () => {
  it('is 0 for a just-spawned group (and defends against a missing spawn time)', () => {
    expect(aging_bonus_pct(t0, t0)).toBe(0)
    expect(aging_bonus_pct(0, t0)).toBe(0)
    expect(aging_bonus_pct(undefined, t0)).toBe(0)
  })

  it('is 0 if the clock is behind the spawn time (never negative)', () => {
    expect(aging_bonus_pct(t0, t0 - HOUR)).toBe(0)
  })

  it('FLOORS to whole hours exactly like the chain (integer division, not continuous)', () => {
    expect(aging_bonus_pct(t0, t0 + 0.5 * HOUR)).toBe(0) // 30 min → still 0%
    expect(aging_bonus_pct(t0, t0 + 1 * HOUR)).toBe(1) // +1.00%/h
    expect(aging_bonus_pct(t0, t0 + 3 * HOUR + 20 * 60_000)).toBe(3) // 3h20m → 3%, not 3.33
  })

  it('accrues +1% per whole hour', () => {
    for (const h of [1, 5, 12, 47, 99]) expect(aging_bonus_pct(t0, t0 + h * HOUR)).toBe(h)
  })

  it('CAPS at +100% (the +10000bp ceiling reached at 100h) and never climbs past it', () => {
    expect(aging_bonus_pct(t0, t0 + 100 * HOUR)).toBe(100)
    expect(aging_bonus_pct(t0, t0 + 500 * HOUR)).toBe(100)
  })
})
