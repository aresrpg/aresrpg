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
// The retired validation workspace used to own the fold-only critical envelope and its 19 exception pins.
// Keeping imports to that deleted private tree made this public script unloadable. These fold facts now live
// here, beside their sole consumer; the broader item-stat constitution did not move into this repository.

export const CRITICAL_STAT = 'critical'
export const CRITICAL_CHANCE = 'critical_chance'
export const CRITICAL_OUTCOMES = 'critical_outcomes'
export const DEAD_CRIT_KEYS = [CRITICAL_CHANCE, CRITICAL_OUTCOMES]
const DEAD_CRIT_STATS = new Set(DEAD_CRIT_KEYS)

// Observed effective-max `critical` envelopes for the ten 20-level bands (L1-20 … L181-200), inclusive.
// This is the complete fold-relevant projection of the retired item-stat artifact; no other stat law is
// duplicated here.
const CRITICAL_ENVELOPES = Object.freeze([
  Object.freeze({ min: 1, max: 3 }),
  Object.freeze({ min: 1, max: 10 }),
  Object.freeze({ min: 1, max: 10 }),
  Object.freeze({ min: 1, max: 7 }),
  Object.freeze({ min: 2, max: 10 }),
  Object.freeze({ min: 3, max: 10 }),
  Object.freeze({ min: 2, max: 6 }),
  Object.freeze({ min: 1, max: 6 }),
  Object.freeze({ min: 3, max: 7 }),
  Object.freeze({ min: 2, max: 7 }),
])

// The exact authored fold sums that are legal above their band envelope. Value-pinned: a named row at any
// other value is drift, even if that value happens to fall back inside the ordinary envelope.
const CRIT_OUTLIER_PINS = new Map([
  ['10_sunspire_dunes/frostwolf_hauberk', 8],
  ['14_charnel_marches/soul_shard_loop', 14],
  ['16_the_sundering/abyssrift_warbelt_of_torn_ground', 9],
  ['16_the_sundering/riftsunder_fangs', 9],
  ['17_obsidian_choir/litany_of_cinders', 7],
  ['17_obsidian_choir/hymnbound_girdle_choir', 10],
  ['17_obsidian_choir/kiln_potholder', 8],
  ['17_obsidian_choir/welcome_doormat', 10],
  ['18_abyssal_weald/deepwoven_crest_of_drowned_weald', 8],
  ['18_abyssal_weald/deepwoven_cincture_of_drowned_weald_mire', 10],
  ['19_hollow_crown/feathergilt_visor_of_silent_court_godbone', 11],
  ['20_zenith_scar/concussion', 11],
  ['20_zenith_scar/legweight', 9],
  ['20_zenith_scar/longdraw', 9],
  ['20_zenith_scar/lastwhisper', 9],
  ['20_zenith_scar/neckoath', 8],
  ['20_zenith_scar/evenhand', 9],
  ['20_zenith_scar/marginalia', 8],
  ['20_zenith_scar/backswing', 8],
])

const ENVELOPED_CATEGORIES = new Set([
  'LONGSWORD',
  'DAGGERS',
  'BOW',
  'SPEAR',
  'STAFF',
  'AXE',
  'SPELLBOOK',
  'BATTLEAXE',
  'SWORD',
  'CLUB',
  'MACE',
  'HELMET',
  'CHESTPLATE',
  'BELT',
  'GAUNTLETS',
  'PANTS',
  'BOOTS',
  'AMULET',
  'RING',
])

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

// Verify the crit fold is law-clean, scoped to the crit fold alone. (1) The 19-pin allowlist + the critical
// band envelope live above as the fold's single source of truth; unrelated non-crit corpus facts never enter
// this receipt. (2) The dead-key ban is derived from DEAD_CRIT_KEYS, the transform's own vocabulary.
export function verify_folded(folded_items) {
  const errors = []
  for (const item of folded_items) {
    const where = item.world ? `${item.world}/${item.slug}` : item.slug
    const category = String(item.category ?? '').toUpperCase()
    const value = Number(item.stats?.max?.[CRITICAL_STAT])
    if (ENVELOPED_CATEGORIES.has(category) && Number.isFinite(value) && value > 0) {
      const pinned = CRIT_OUTLIER_PINS.get(where)
      if (pinned != null && value !== pinned)
        errors.push(`item_stat_law: '${where}' critical max ${value} drifted from pinned fold sum ${pinned}`)
      else if (pinned == null) {
        const band = Math.min(9, Math.max(0, Math.ceil((Number(item.level) || 1) / 20) - 1))
        const envelope = CRITICAL_ENVELOPES[band]
        if (value < envelope.min || value > envelope.max)
          errors.push(
            `item_stat_law: '${where}' critical max ${value} outside observed [${envelope.min}, ${envelope.max}] — corpus band ${band}`
          )
      }
    }
    for (const name of ['min', 'max'])
      for (const key of Object.keys(item.stats?.[name] ?? {}))
        if (DEAD_CRIT_STATS.has(key))
          errors.push(`strict_key_schema: '${item.world}/${item.slug}' ${name} dead key '${key}' survived the fold`)
  }
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
