// STATS DERIVE — the live-stat re-derivation law, a mirror of participant.move `refresh_stats` /
// `alter_base_stat` (S-16 parity). A fighter's LIVE stats are ALWAYS re-derived from the base block + the live
// timed alter rows: every addition first, then ONE saturating subtraction pass per stat. The rows are the single
// home for timed deltas — apply, expiry and dispel all just change the row set and re-derive, so a debuff clamped
// by the 0-floor can NEVER leak a permanent gain when its row leaves. (This replaced per-row delta-reverting,
// which the flipped-sign re-application broke under the clamp; DO NOT reintroduce any revert bookkeeping.)
//
// PERMANENT (turns==0) alters land on the BASE block via alter_base_stat and survive every re-derivation; timed
// rows stack on top and never touch base.

import {
  clone_stats,
  add_stat,
  sub_stat,
  add_resist,
  sub_resist,
} from './spell.js'
import {
  K_ALTER_STAT,
  FLAG_NEGATIVE,
  has_flag,
  kind,
  stat,
  element,
  value,
} from './spell_effect.js'

/**
 * A minimal fight seat: the join-snapshot base block (+ permanent alters) and the live re-derived block. Mirrors
 * the participant fields `stats` (live) and `base_stats`.
 * @typedef {{ base_stats: import('./spell.js').Stats, stats: import('./spell.js').Stats }} Fighter
 */

/** A fresh seat from a base Stats block — live starts equal to base. Mirrors participant::new (stats/base_stats). */
export const new_fighter = base_stats => ({
  base_stats: clone_stats(base_stats),
  stats: clone_stats(base_stats),
})

/** Read the live re-derived block / the base block. */
export const stats = f => f.stats
export const base_stats = f => f.base_stats

/**
 * PERMANENT (turns==0) ALTER_STAT: lands on the BASE block, saturating (a permanent effect has no revert, so the
 * 0-floor is its real semantics). The caller re-derives right after. Mirrors participant::alter_base_stat.
 * @param {Fighter} f
 */
export const alter_base_stat = (f, field, amount, neg) => {
  if (neg) sub_stat(f.base_stats, field, amount)
  else add_stat(f.base_stats, field, amount)
}

/** The base-block twin for element resistances. Mirrors participant::alter_base_resist. @param {Fighter} f */
export const alter_base_resist = (f, elem, amount, neg) => {
  if (neg) sub_resist(f.base_stats, elem, amount)
  else add_resist(f.base_stats, elem, amount)
}

/**
 * RE-DERIVE the live block from base + the fighter's live timed alter rows: every addition first, then one
 * saturating subtraction pass. Mirrors participant::refresh_stats.
 * @param {Fighter} f
 * @param {import('./spell_effect.js').Effect[]} rows the live timed alter rows
 */
export const refresh_stats = (f, rows) => {
  const s = clone_stats(f.base_stats)
  fold_alters(s, rows, false)
  fold_alters(s, rows, true)
  f.stats = s
}

/**
 * One fold pass: apply every row whose sign matches `negatives`. Alter rows fold with their authored
 * element/stat/value. Mirrors participant::fold_alters.
 */
const fold_alters = (s, rows, negatives) => {
  for (const e of rows) {
    if (has_flag(e, FLAG_NEGATIVE) === negatives) {
      if (kind(e) === K_ALTER_STAT) {
        if (negatives) sub_stat(s, stat(e), value(e))
        else add_stat(s, stat(e), value(e))
      } else if (negatives) sub_resist(s, element(e), value(e))
      else add_resist(s, element(e), value(e))
    }
  }
}
