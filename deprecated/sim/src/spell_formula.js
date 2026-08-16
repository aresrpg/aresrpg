// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPELL FORMULA (drain slice) — the JS twin of aresrpg_foundation::spell_formula's AP/MP-removal contest, so a
// client previews a drain's agility-contested dodge byte-for-byte with the chain. The legacy
// koshi damage/heal math lives in spell_calculator.js; this file mirrors ONLY the drain primitive the on-chain
// resolver wired in. `dodge_seed` (the turn-seed derivation the player cast threads) lives in turn_seed.js.

import { rng_int } from './prng.js'

/**
 * Remove `value` AP or MP one point at a time, agility-contested — byte-for-byte with spell_formula::remove_points.
 * `dodge=false` (the guaranteed class 168/169) removes min(current, value) with NO draw. Else each point rolls
 * `rng_int(100) < clamp(50·max(⌊wisdom/10⌋,1)/max(target_dodge,1)·(current−removed)/max, 10, 90)`; a dodge STOPS
 * the removal. The resolver feeds `target_dodge = agility + ap/mp_dodge` (agility drives the dodge) and
 * `caster_wisdom` as the remover term. Integer-only (⌊⌋ every divide). Returns { state, removed }.
 * @param {number} rng @param {number} value @param {boolean} dodge @param {number} caster_wisdom
 * @param {number} target_dodge @param {number} current @param {number} max
 * @returns {{ state: number, removed: number }}
 */
export const remove_points = (
  rng,
  value,
  dodge,
  caster_wisdom,
  target_dodge,
  current,
  max,
) => {
  if (!dodge) return { state: rng, removed: value < current ? value : current }
  if (max === 0) return { state: rng, removed: 0 }
  const wisdom = Math.max(1, Math.floor(caster_wisdom / 10))
  const resistance = target_dodge < 1 ? 1 : target_dodge
  const resist_rate = Math.floor((50 * wisdom) / resistance)
  let state = rng
  let removed = 0
  while (removed < value && removed < current) {
    const raw = Math.floor((resist_rate * (current - removed)) / max)
    const chance = raw < 10 ? 10 : raw > 90 ? 90 : raw
    const { state: next, value: roll } = rng_int(state, 100)
    state = next
    if (roll < chance) removed += 1
    else break
  }
  return { state, removed }
}

/**
 * The ONE turn-start refill law: `base + credit − debt`, floored at 0 — credit folds in BEFORE the debt
 * subtraction, so an over-drained-but-fed pool keeps the fed remainder. Byte-for-byte with
 * participant::net_refill (which mob::begin_turn shares). The debt/credit inputs come from
 * effect_board fighter_point_debt / fighter_point_credit.
 * @param {number} base @param {number} debt @param {number} credit @returns {number}
 */
export const net_refill = (base, debt, credit) => {
  const total = base + credit
  return total > debt ? total - debt : 0
}
