// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { DEAD_CRIT_KEYS, fold_corpus, fold_side, verify_drift, verify_folded } from './crit_fold.mjs'

// Fixtures ride REAL item_stat_law facts (single source of truth): 20_zenith_scar/concussion is a D765
// allowlisted outlier pinned at 11; its L199 CLUB band envelope for `critical` is [2,7]. A non-allowlisted
// slug at the same band is the 20th-outlier probe. `where` (world/slug) is the pin key the gate looks up.
const item = (overrides) => ({
  slug: 'probe_blade',
  world: '20_zenith_scar',
  category: 'CLUB',
  level: 199,
  stats: { min: {}, max: {} },
  ...overrides,
})

describe('fold — per-side plain sum into critical, dead keys removed', () => {
  test('a row carrying 11/12 folds to the exact per-side sum (concussion shape: min 9, max 11)', () => {
    const { folded, deltas } = fold_corpus([
      item({
        slug: 'concussion_shape',
        stats: {
          min: { critical: 1, critical_outcomes: 3, critical_chance: 5 },
          max: { critical: 2, critical_outcomes: 4, critical_chance: 5 },
        },
      }),
    ])
    expect(folded[0].stats.min.critical).toBe(9)
    expect(folded[0].stats.max.critical).toBe(11)
    expect(deltas).toHaveLength(1)
    expect(deltas[0].max).toEqual({ before: 2, critical_chance: 5, critical_outcomes: 4, after: 11 })
  })

  test('dead keys are ABSENT from the folded output on both sides', () => {
    const { folded } = fold_corpus([
      item({ stats: { min: { critical_chance: 2 }, max: { critical_chance: 3, critical_outcomes: 1 } } }),
    ])
    for (const dead of DEAD_CRIT_KEYS) {
      expect(dead in folded[0].stats.min).toBe(false)
      expect(dead in folded[0].stats.max).toBe(false)
    }
    expect(folded[0].stats.min.critical).toBe(2)
    expect(folded[0].stats.max.critical).toBe(4)
  })

  test('critical with no prior value is created from the sum (rename case)', () => {
    const { folded } = fold_corpus([item({ stats: { min: {}, max: { critical_chance: 5 } } })])
    expect(folded[0].stats.max.critical).toBe(5)
  })

  test('a SIGNED malus folds correctly (cocoon_king_cowl shape: 5 + -4 = 1, 6 + -3 = 3)', () => {
    const { folded } = fold_corpus([
      item({
        slug: 'cocoon_shape',
        stats: { min: { critical: 5, critical_chance: -4 }, max: { critical: 6, critical_chance: -3 } },
      }),
    ])
    expect(folded[0].stats.min.critical).toBe(1)
    expect(folded[0].stats.max.critical).toBe(3)
  })

  test('a row without crit keys passes through untouched (no delta)', () => {
    const { folded, deltas } = fold_corpus([
      item({ slug: 'plain', stats: { min: { strength: 1 }, max: { strength: 20, critical: 3 } } }),
    ])
    expect(deltas).toHaveLength(0)
    expect(folded[0].stats.max).toEqual({ strength: 20, critical: 3 })
  })

  test('fold_side leaves a dead-key-free side identical (no spurious critical)', () => {
    const { side, detail } = fold_side({ strength: 10, critical: 4 }, 'x max')
    expect(side).toEqual({ strength: 10, critical: 4 })
    expect(detail).toBeNull()
  })
})

describe('verify_folded — the REAL gates own the pins, the envelope, and the dead-key ban', () => {
  test('GREEN — a D765-pinned outlier at its exact pin is legal (concussion → 11)', () => {
    const { folded } = fold_corpus([
      item({
        slug: 'concussion',
        stats: { min: { critical: 9 }, max: { critical: 2, critical_chance: 5, critical_outcomes: 4 } },
      }),
    ])
    expect(folded[0].stats.max.critical).toBe(11) // == the concussion pin
    expect(verify_folded(folded).ok).toBe(true)
  })

  test('RED — a pinned slug folded OFF its pin goes red (concussion → 12)', () => {
    const { folded } = fold_corpus([
      item({
        slug: 'concussion',
        stats: { min: {}, max: { critical: 3, critical_chance: 5, critical_outcomes: 4 } },
      }),
    ])
    expect(folded[0].stats.max.critical).toBe(12)
    const result = verify_folded(folded)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('concussion'))).toBe(true)
  })

  test('RED — a 20th (non-allowlisted) row folded above its band envelope goes red', () => {
    const { folded } = fold_corpus([
      item({
        slug: 'brand_new_outlier',
        stats: { min: {}, max: { critical: 4, critical_chance: 3, critical_outcomes: 1 } },
      }),
    ])
    expect(folded[0].stats.max.critical).toBe(8) // > L199 band envelope max 7, and NOT allowlisted
    const result = verify_folded(folded)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('brand_new_outlier'))).toBe(true)
  })

  test('RED — a dead key surviving the fold is caught (dead-key ban, DEAD_CRIT_STATS)', () => {
    const leaked = [item({ slug: 'leaky', stats: { min: {}, max: { critical_chance: 2 } } })]
    const result = verify_folded(leaked) // fed a leaked row on purpose: the ban must red a surviving dead key
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('critical_chance'))).toBe(true)
  })

  test('a NON-crit corpus issue never false-reds this receipt (isolation: only critical is checked)', () => {
    // a pet-shaped row with an out-of-envelope NON-crit stat + a legal critical must stay GREEN here
    const { folded } = fold_corpus([
      item({
        slug: 'noncrit_probe',
        category: 'AMULET',
        level: 199,
        stats: { min: {}, max: { air_resistance: 999, critical_chance: 2 } },
      }),
    ])
    expect(verify_folded(folded).ok).toBe(true)
  })
})

describe('verify_drift — the committed seed must already carry the faithful sums', () => {
  const { deltas } = fold_corpus([
    item({
      slug: 'concussion',
      stats: {
        min: { critical: 1, critical_chance: 5, critical_outcomes: 3 },
        max: { critical: 2, critical_chance: 5, critical_outcomes: 4 },
      },
    }),
  ])
  const current_row = (max_critical, extra = {}) => ({
    slug: 'concussion',
    stats: { min: { critical: 9 }, max: { critical: max_critical, ...extra } },
  })

  test('GREEN — current seed critical equals the folded sums, no dead key on disk', () => {
    expect(verify_drift(deltas, new Map([['concussion', current_row(11)]])).ok).toBe(true)
  })

  test('RED — current seed critical drifted from the folded sum', () => {
    const result = verify_drift(deltas, new Map([['concussion', current_row(10)]]))
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('!= folded sum 11'))).toBe(true)
  })

  test('RED — a dead key survives on disk', () => {
    const result = verify_drift(deltas, new Map([['concussion', current_row(11, { critical_chance: 5 })]]))
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('critical_chance'))).toBe(true)
  })

  test('RED — a folded row missing from the current seed', () => {
    const result = verify_drift(deltas, new Map())
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('absent'))).toBe(true)
  })
})

describe('schema surprises refuse loudly', () => {
  test('a non-integer (string) dead-key value throws', () => {
    expect(() => fold_corpus([item({ stats: { min: {}, max: { critical_chance: 'lots' } } })])).toThrow(
      /expected an integer/
    )
  })

  test('a fractional dead-key value throws', () => {
    expect(() => fold_corpus([item({ stats: { min: { critical_outcomes: 2.5 }, max: {} } })])).toThrow(
      /expected an integer/
    )
  })

  test('a duplicate slug throws', () => {
    expect(() => fold_corpus([item({ slug: 'dup' }), item({ slug: 'dup' })])).toThrow(/duplicate/)
  })

  test('a row missing its slug throws', () => {
    expect(() => fold_corpus([{ world: 'x', stats: { min: {}, max: {} } }])).toThrow(/slug/)
  })
})
