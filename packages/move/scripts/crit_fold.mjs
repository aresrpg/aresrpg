// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRIT FOLD — the pure crit-convergence transform + its law verification. No filesystem, git, chain, or
// client import lives here: every fold, delta, pin, envelope, and drift rule is proven by fixtures alone.
//
// This fold (honoring the equipment_stats.move:24-25 mandate "the reseed must write the
// combat denominator reduction to canonical `critical`"): the dead `critical_chance`(11) and
// `critical_outcomes`(12) pair folds into canonical `critical`(9) as a PLAIN PER-SIDE SUM — the row's total
// combat-denominator reduction, no invented merge math — and the two dead keys can NEVER return to a seed
// (strict_key_schema DEAD_CRIT_STATS). The 19 authored fold-sums that exceed their band envelope ship as
// authored: item_stat_law's D765_CRIT_OUTLIERS allowlist value-pins each; any 20th over-envelope row, or a
// pinned slug drifting off its pin, stays a hard error.
//
// The pins + envelope are NOT copied here — that is the cardinal single-home law. `verify_folded` runs the
// REAL validation gates (packages/validation), so this module and the constitution can never disagree.

import { gate_item_stat_law } from '../../validation/src/mainnet/gates/item_stat_law.ts'
import { DEAD_CRIT_STATS } from '../../validation/src/mainnet/schema.ts'

export const CRITICAL_STAT = 'critical'
export const CRITICAL_CHANCE = 'critical_chance'
export const CRITICAL_OUTCOMES = 'critical_outcomes'
export const DEAD_CRIT_KEYS = [CRITICAL_CHANCE, CRITICAL_OUTCOMES]

// Crit lines are SIGNED (a below-center malus is a legal negative, e.g. cocoon_king_cowl min crit_chance -4),
// so the fold sums signed integers. A non-integer (string/float/NaN) is a schema surprise and refuses loudly.
const as_integer = (value, label) => {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new Error(`${label}: expected an integer, got ${JSON.stringify(value)}`)
  return number
}

// Fold ONE stats side (min or max): critical := critical + critical_chance + critical_outcomes (SIGNED sum),
// with the two dead keys removed. Returns the rewritten side plus, when the side carried either dead key, a
// delta detail. An absent side (null/undefined) is preserved verbatim. Any non-integer crit value refuses.
export function fold_side(side, label) {
  if (side == null) return { side, detail: null }
  const folded = {}
  let critical_chance = 0
  let critical_outcomes = 0
  let carried = false
  for (const [key, value] of Object.entries(side)) {
    if (key === CRITICAL_CHANCE) {
      critical_chance = as_integer(value, `${label} ${CRITICAL_CHANCE}`)
      carried = true
      continue
    }
    if (key === CRITICAL_OUTCOMES) {
      critical_outcomes = as_integer(value, `${label} ${CRITICAL_OUTCOMES}`)
      carried = true
      continue
    }
    folded[key] = value
  }
  if (!carried) return { side: folded, detail: null }
  const before = as_integer(folded[CRITICAL_STAT] ?? 0, `${label} ${CRITICAL_STAT}`)
  const after = before + critical_chance + critical_outcomes
  folded[CRITICAL_STAT] = after
  return { side: folded, detail: { before, critical_chance, critical_outcomes, after } }
}

// Fold one item row. Preserves every non-crit field; a stats-less row passes through untouched. A row that
// carried either dead key on either side yields a delta (the audit table's row). Missing slug refuses loudly.
export function fold_item(item) {
  const { slug } = item ?? {}
  if (typeof slug !== 'string' || slug.length === 0)
    throw new Error(`item row is missing a string slug: ${JSON.stringify(item)}`)
  const where = item.world ? `${item.world}/${slug}` : slug
  if (!item.stats) return { item, delta: null }
  const { side: min, detail: min_detail } = fold_side(item.stats.min, `${where} min`)
  const { side: max, detail: max_detail } = fold_side(item.stats.max, `${where} max`)
  const folded = { ...item, stats: { ...item.stats, min, max } }
  if (!min_detail && !max_detail) return { item: folded, delta: null }
  return {
    item: folded,
    delta: { where, world: item.world ?? null, slug, min: min_detail, max: max_detail },
  }
}

// Fold a whole item corpus → { folded rows, delta rows }. A duplicate slug (broken seed identity) refuses.
export function fold_corpus(items) {
  if (!Array.isArray(items)) throw new Error('fold_corpus expects an array of item rows')
  const folded = []
  const deltas = []
  const seen = new Set()
  for (const item of items) {
    const { item: folded_item, delta } = fold_item(item)
    if (seen.has(folded_item.slug))
      throw new Error(`duplicate item slug '${folded_item.slug}' — the seed identity is broken`)
    seen.add(folded_item.slug)
    folded.push(folded_item)
    if (delta) deltas.push(delta)
  }
  return { folded, deltas }
}

// Project a folded row to ONLY its critical stat. item_stat_law then checks exactly the crit fold's law — the
// 19-pin D765 allowlist + the critical band envelope — and never a pre-existing NON-crit corpus issue (a pet
// resistance, a future unknown key: that breadth is the full validation harness's separate job). The pin key
// (world/slug) and the band keys (category/level) are preserved.
const project_critical = (item) => ({
  slug: item.slug,
  world: item.world,
  category: item.category,
  level: item.level,
  stats: {
    min: {},
    max:
      item.stats?.max && CRITICAL_STAT in item.stats.max ? { [CRITICAL_STAT]: item.stats.max[CRITICAL_STAT] } : {},
  },
})

// Verify the crit fold is law-clean, scoped to the crit fold alone. (1) The 19-pin allowlist + the critical
// band envelope come from the REAL item_stat_law gate (single source of truth for the pins/envelope), fed the
// critical-only projection so an unrelated non-crit corpus finding never false-reds this receipt. (2) The
// dead-key ban: every DEAD_CRIT_STATS key (schema.ts is their single home) must be gone from the folded rows.
export function verify_folded(folded_items) {
  const stat_law = gate_item_stat_law({ items: folded_items.map(project_critical), mobs: [] })
  const errors = stat_law.errors.map((issue) => `${issue.validator}: ${issue.message}`)
  for (const item of folded_items)
    for (const name of ['min', 'max'])
      for (const key of Object.keys(item.stats?.[name] ?? {}))
        if (DEAD_CRIT_STATS.has(key))
          errors.push(`strict_key_schema: '${item.world}/${item.slug}' ${name} dead key '${key}' survived the fold`)
  return { ok: errors.length === 0, errors }
}

// Prove the committed (current, on-disk) seed already carries the faithful per-side sums: for every folded
// row, the current `critical` must equal the fold's `after` on each carried side, and no dead key may survive
// on disk. Isolates `critical` alone, so an unrelated post-fold stat edit never false-reds the receipt.
export function verify_drift(deltas, current_by_slug) {
  const errors = []
  for (const delta of deltas) {
    const current = current_by_slug.get(delta.slug)
    if (!current) {
      errors.push(`${delta.where}: folded row is absent from the current seed`)
      continue
    }
    const sides = [
      ['min', delta.min, current.stats?.min ?? {}],
      ['max', delta.max, current.stats?.max ?? {}],
    ]
    for (const [name, detail, side] of sides) {
      if (detail) {
        const live = Number(side[CRITICAL_STAT] ?? 0)
        if (live !== detail.after)
          errors.push(`${delta.where} ${name}: current critical ${live} != folded sum ${detail.after}`)
      }
      for (const dead of DEAD_CRIT_KEYS)
        if (dead in side) errors.push(`${delta.where} ${name}: dead key '${dead}' survives in the current seed`)
    }
  }
  return { ok: errors.length === 0, errors }
}
