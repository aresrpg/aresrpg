// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure mob-effect PTB builder for seed_full_corpus.mjs. Kept free of client/manifest imports so the corpus wire
// shape can be regression-tested offline without loading the chain-facing seed driver.
import { encode_effect_value } from './spell_wire.mjs'

const KIND_PHASE = { 20: 1, 21: 1 } // K_PLACE_GLYPH / K_APPLY_DOT → PHASE_START; all else PHASE_ON_ENTER
const EL_ID = {
  fire: 0,
  water: 1,
  earth: 2,
  air: 3,
  neutral: 255,
  none: 255,
}
const MOB_OFFENSIVE = new Set([0, 1, 2, 3, 4, 7, 8, 12, 13, 17, 21])

// Select an authored range as one intact field family. Mob damage/DoT/life-steal rows carry the legacy midpoint
// in `base` alongside the real `damageMin`/`damageMax` band, so a present max chooses its matching min rather
// than hybridizing the midpoint with the ceiling. A row without a complete range family stays fixed.
const effectRange = (e) => {
  if (e.value_max != null) return [e.value ?? 0, e.value_max]
  if (e.baseMax != null) return [e.base ?? 0, e.baseMax]
  if (e.damageMax != null) return [e.damageMin ?? 0, e.damageMax]
  const fixed = e.value ?? e.base ?? e.damageMin ?? 0
  return [fixed, fixed]
}

export const mobEffect = (tx, foundationPackage, e) => {
  const element = typeof e.element === 'string' ? (EL_ID[e.element] ?? 255) : (e.element ?? 255)
  const [rawMin, rawMax] = effectRange(e)
  const encodedMin = encode_effect_value(e.kind, rawMin, e.flags ?? 0)
  const encodedMax = encode_effect_value(e.kind, rawMax, encodedMin.flags)
  return tx.moveCall({
    target: `${foundationPackage}::spell_effect::new_effect_ranged`,
    arguments: [
      tx.pure.u8(e.kind),
      tx.pure.u8(element),
      tx.pure.u64(Math.min(encodedMin.value, encodedMax.value)),
      tx.pure.u64(Math.max(encodedMin.value, encodedMax.value)),
      tx.pure.u8(e.area_shape ?? 0),
      tx.pure.u64(e.area_size ?? 0),
      tx.pure.u8(e.target_filter ?? (MOB_OFFENSIVE.has(e.kind) ? 1 : 0)),
      tx.pure.u8(e.chance ?? 100),
      tx.pure.u8(e.turns ?? 0),
      tx.pure.u8(e.stat ?? 0),
      tx.pure.u8(encodedMin.flags),
      tx.pure.u8(KIND_PHASE[e.kind] ?? 0),
    ],
  })
}
