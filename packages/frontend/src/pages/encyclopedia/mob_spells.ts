// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MOB SPELL display decode (pure data mapping, no JSX). The authored corpus kit (world_corpus.ts
// CorpusMobSpell — the exact rows seed_full_corpus.mjs PHASE 5 minted into the MobTemplate's
// SpellLevels) becomes the SAME display shape the class-spell surfaces render: string kinds +
// lowercase element names + `base`, exactly what the shared `seed_effect_parts` grammar
// (game/screens/hud/seed-effect-line.js) consumes — ONE effect wording home, zero drift from the
// grimoire/classes tab. Numeric mappings mirror fight-spells.js (`decode_effect`) / the Move enums
// (aresrpg_foundation::spell_effect); mob_spells.test.ts proves the table against the ENTIRE live
// corpus using the corpus's own kind↔op pairing as the oracle (and that no effect renders the
// untranslated `? KIND` canary).
import type { CorpusMobSpell, CorpusMobSpellEffect } from './world_corpus'

/** Move spell_effect kind id → the display vocabulary of seed_effect_parts (fight-spells.js kind_names). */
const KIND_NAMES: Record<number, string> = {
  0: 'DAMAGE',
  1: 'PERCENT_LIFE',
  2: 'LIFE_STEAL',
  3: 'CASTER_DAMAGE',
  4: 'PUNISHMENT',
  5: 'HEAL',
  6: 'GIVE_POINTS',
  7: 'REMOVE_POINTS',
  8: 'STEAL_POINTS',
  9: 'ALTER_STAT',
  10: 'STEAL_STAT',
  11: 'ALTER_RESIST',
  12: 'PUSH',
  13: 'PULL',
  14: 'TELEPORT',
  15: 'SWAP',
  16: 'CARRY',
  17: 'THROW',
  19: 'PLACE_TRAP',
  20: 'PLACE_GLYPH',
  21: 'APPLY_DOT',
  22: 'APPLY_STATE',
  23: 'REMOVE_STATE',
  24: 'REDUCE_DAMAGE',
  25: 'REFLECT_DAMAGE',
  26: 'DISPEL',
  27: 'INVISIBILITY',
  28: 'REVEAL',
  29: 'RETURN_SPELL',
}

const SHAPE_NAMES: Record<number, string> = {
  0: 'POINT',
  1: 'CIRCLE',
  2: 'CROSS',
  3: 'LINE',
  4: 'TBAR',
  5: 'RING',
  6: 'ALLMAP',
  7: 'CONE',
}

/** The seed_effect_parts input shape (seed-effect-line.js EffectLineView source). */
export interface MobSpellEffectView {
  kind: string
  element?: string
  base: number
  /** value-line source for the damage/heal families — seed_effect_value renders ONLY damageMin/damageMax
   * (class rows carry an authored display range; a mob row's flat chain value is its honest single number) */
  damageMin?: number
  damageMax?: number
  chance: number
  turns: number
  area_shape: string
  area_size: number
  stat?: number
  crit_base?: number
}

/** Kinds whose line VALUE renders through seed_effect_value (damage_parts + HEAL). */
const VALUE_RANGE_KINDS = new Set(['DAMAGE', 'APPLY_DOT', 'LIFE_STEAL', 'PUNISHMENT', 'CASTER_DAMAGE', 'HEAL'])

export interface MobSpellView {
  ap: number
  range: [number, number]
  modifiable_range: boolean
  cooldown: number
  crit_rate: number
  line_of_sight: boolean
  effects: MobSpellEffectView[]
}

/** One authored effect → the display shape. `base ?? value` mirrors the seeder's own value mapping
 * (mobEffect); an unknown numeric kind passes through as its number so the shared grammar renders the
 * LOUD `? KIND` canary, never a silent blank. */
const effect_view = (effect: CorpusMobSpellEffect): MobSpellEffectView => {
  const kind = KIND_NAMES[effect.kind ?? -1] ?? String(effect.kind)
  const base = effect.base ?? effect.value ?? 0
  return {
    kind,
    ...(effect.element != null ? { element: String(effect.element).toLowerCase() } : {}),
    base,
    ...(VALUE_RANGE_KINDS.has(kind) ? { damageMin: base, damageMax: base } : {}),
    chance: effect.chance ?? 100,
    turns: effect.turns ?? 0,
    area_shape: SHAPE_NAMES[effect.area_shape ?? 0] ?? 'POINT',
    area_size: effect.area_size ?? 0,
    ...(effect.stat != null ? { stat: effect.stat } : {}),
  }
}

/** Authored kit → display views. Defaults mirror the mint path exactly (seed_full_corpus.mjs
 * `spellLevel`: ap 4 / range 1-4 / cd 0 / los true); the same-kind crit effect rides each line's own
 * `crit N` meta — the idiom every other spell surface uses. */
export const mob_spell_views = (spells: readonly CorpusMobSpell[] | null | undefined): MobSpellView[] =>
  (spells ?? []).map((spell) => ({
    ap: spell.ap ?? 4,
    range: [spell.rmin ?? 1, spell.rmax ?? 4],
    modifiable_range: spell.mod === true,
    cooldown: spell.cd ?? 0,
    crit_rate: spell.crit ?? 0,
    line_of_sight: spell.los !== false,
    effects: (spell.effects ?? []).map((effect) => {
      const critical = (spell.crit_effects ?? []).find((candidate) => candidate.kind === effect.kind)
      return {
        ...effect_view(effect),
        ...(critical ? { crit_base: critical.base ?? critical.value ?? 0 } : {}),
      }
    }),
  }))
