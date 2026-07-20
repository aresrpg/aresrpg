// FIGHT SPELL RESOLVER — the ONE home mapping a character's (class, level) to the on-chain spells it can cast.
//
// Rows derive synchronously from the authored spell corpus plus packages/move/scripts/out/seed_manifest.json.
// Each row carries the spell's `object_id` — the `aresrpg_spells::spell_template::SpellTemplate` SHARED object
// the `act_cast` PTB references (§7) — plus display facts and every authored SpellLevel. There is no copied ID
// artifact to regenerate after a seed. The chain is the
// referee: it enforces AP cost, range, LoS and the per-level `min_char_level` unlock at cast time; the bar only
// SHOWS what a character can reach (unlock_level ≤ char level), never gates beyond UX.
//
// One home per fact: the fight bar (DeckCluster via fight.js spell_card), the board's cast gate + dispatch
// (DungeonBoard) and the voxel cast wash (voxel_fight_folds) all resolve spell facts + the cast object id from
// HERE, keyed by `name_key`. A class with no seeded spells resolves to [] (weapon + move only — the honest
// on-chain state), so nothing renders a stub.

import { normalize_chain_spell_corpus } from '@aresrpg/sim'

import { bun_runtime, seed_manifest } from '../../../content/seed_manifest'

const kind_names = {
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
const element_names = { 0: 'fire', 1: 'water', 2: 'earth', 3: 'air', 255: 'neutral' }
const shape_names = { 0: 'POINT', 1: 'CIRCLE', 2: 'CROSS', 3: 'LINE', 4: 'TBAR', 5: 'RING', 6: 'ALLMAP', 7: 'CONE' }

const name_key = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

export const project_spell_effect = (effect) => ({
  ...effect,
  kind_id: effect.kind,
  kind: kind_names[effect.kind] ?? String(effect.kind),
  ...(effect.element != null
    ? { element_id: effect.element, element: element_names[effect.element] ?? String(effect.element) }
    : {}),
  base: effect.value ?? 0,
  chance: effect.chance ?? 100,
  turns: effect.turns ?? 0,
  target_filter: effect.target_filter ?? 0,
  flags: effect.flags ?? 0,
  area_shape_id: effect.area_shape ?? 0,
  area_shape: shape_names[effect.area_shape ?? 0] ?? 'POINT',
  area_size: effect.area_size ?? 0,
  ...(effect.zone != null
    ? {
        zone: {
          ...effect.zone,
          shape_id: effect.zone.shape ?? 0,
          shape: shape_names[effect.zone.shape ?? 0] ?? 'POINT',
          size: effect.zone.size ?? 0,
        },
      }
    : {}),
})

export const project_spell_level = (level) => {
  const critical_by_kind = new Map()
  for (const critical of level.crit_effects ?? []) {
    const rows = critical_by_kind.get(critical.kind) ?? []
    critical_by_kind.set(critical.kind, [...rows, critical])
  }
  const occurrences = new Map()
  const effects = (level.effects ?? []).map((effect) => {
    const occurrence = occurrences.get(effect.kind) ?? 0
    occurrences.set(effect.kind, occurrence + 1)
    const critical = critical_by_kind.get(effect.kind)?.[occurrence]
    const decoded = project_spell_effect(effect)
    return critical
      ? { ...decoded, crit_base: critical.value ?? 0, crit_effect: project_spell_effect(critical) }
      : decoded
  })
  return {
  min_char_level: level.min_char_level,
  ap: level.ap_cost,
  mp: 0,
  range: [level.range_min, level.range_max],
  modifiable_range: level.modifiable_range ?? false,
  line_of_sight: level.line_of_sight !== false,
  linear: level.line_launch ?? false,
  free_cell: level.free_cell ?? false,
  casts_per_turn: level.casts_per_turn,
  casts_per_target: level.casts_per_target,
  cooldown: level.cooldown_turns,
  crit_rate: level.crit_rate,
    effects,
  }
}

const spell_classes = [...new Set(Object.values(seed_manifest.spells).map((spell) => spell.class).filter(Boolean))]
const corpus_modules = bun_runtime
  ? Object.fromEntries(
      spell_classes.map((spell_class) => {
        const relative_path = `../../../../../../seed/mainnet/spells/${spell_class}.json`
        const rows = import.meta.require(relative_path)
        return [relative_path, rows]
      })
    )
  : import.meta.glob('../../../../../../seed/mainnet/spells/*.json', { eager: true, import: 'default' })

const spell_corpus = Object.values(corpus_modules).flatMap((module) => {
  const rows = module?.default ?? module
  return Array.isArray(rows) ? rows : []
})

/** Raw corpus id → normalized sim SpellTemplate. This is the only product door into the sim spell algebra. */
export const fight_spell_templates = normalize_chain_spell_corpus(spell_corpus)

const spells = spell_corpus
  .map((spell) => {
    const key = `${spell.classType}:${spell.unlock}:${spell.id}`
    const entry = seed_manifest.spells[key]
    if (!entry?.id) throw new Error(`seed manifest has no object id for ${key}; run the full corpus seed`)
    return {
      object_id: entry.id,
      class: spell.classType,
      unlock_level: spell.unlock,
      name: spell.name,
      name_key: name_key(spell.name),
      template_id: spell.id,
      template: fight_spell_templates.get(spell.id),
      kind: spell.role === 'heal' ? 'heal' : 'dmg',
      role: spell.role ?? 'damage',
      element: spell.element ?? null,
      levels: (spell.levels ?? []).map(project_spell_level),
    }
  })
  .sort((left, right) => left.class.localeCompare(right.class) || left.unlock_level - right.unlock_level)

if (!spells.length) throw new Error('authored spell corpus is empty')
export const fight_spells_data = { spells }

/**
 * @typedef {object} FightSpell
 * @property {string} object_id     the on-chain SpellTemplate shared object id (the act_cast target)
 * @property {string} class         lowercase class id ('senshi' …)
 * @property {number} unlock_level  the character level that unlocks the spell
 * @property {string} name          the on-chain display name ('Ember Strike')
 * @property {string} name_key      stable slug — the arm id + spell-icon key ('ember_strike')
 * @property {string} kind          'dmg' | 'heal'
 * @property {string} role          VFX-variant family key (damage/heal/dot/trap/punishment/… — vfx_variants.variant_for); derived from kind for plain seed content
 * @property {string | null} element
 * @property {Array<{ min_char_level: number, ap: number, mp: number, range: [number, number],
 *   modifiable_range: boolean, line_of_sight: boolean, linear: boolean, free_cell: boolean,
 *   casts_per_turn: number, casts_per_target: number, cooldown: number, crit_rate: number,
 *   effects: Array<{ kind: string, element?: string, base: number, crit_base?: number,
 *     chance: number, turns: number, area_shape: string, area_size: number }> }>} levels
 *   all 6 on-chain SpellLevels (SpellTemplate.levels — spell_effect.move's SpellLevel/Effect fields
 *   projected 1:1 above). Fight RESOLUTION currently reads levels[0] only (level-1 MVP —
 *   cast.move's "SPELL LEVEL" note); the encyclopedia (classes_tab.tsx) renders every level.
 *   casts_per_turn/casts_per_target == 255 means unlimited (spell_bands::CASTS_UNLIMITED).
 */

/** name_key → the on-chain spell row (every seeded spell, all classes). */
const by_name_key = new Map(spells.map((spell) => [spell.name_key, spell]))

/**
 * The on-chain spells a character of `class_id` at `char_level` can cast — every seeded class spell whose
 * `unlock_level ≤ char_level`, sorted by unlock level. Empty for a class with no seed / an unknown class.
 * @param {string | null | undefined} class_id  lowercase class id
 * @param {number} char_level
 * @returns {FightSpell[]}
 */
export function resolve_class_spells(class_id, char_level) {
  if (!class_id) return []
  const cls = String(class_id).toLowerCase()
  const lvl = Number.isFinite(char_level) ? char_level : 0
  return spells.filter((spell) => spell.class === cls && spell.unlock_level <= lvl).sort((a, b) => a.unlock_level - b.unlock_level)
}

/**
 * EVERY seeded spell of a class — locked ones included — sorted by unlock level. The GRIMOIRE's row source
 * (the spells tab shows the whole book, locked rows with their unlock chip). Empty for an unseeded class —
 * the honest on-chain state, never a stub.
 * @param {string | null | undefined} class_id  lowercase class id
 * @returns {FightSpell[]}
 */
export function class_spells(class_id) {
  if (!class_id) return []
  const cls = String(class_id).toLowerCase()
  return spells.filter((spell) => spell.class === cls).sort((a, b) => a.unlock_level - b.unlock_level)
}

/** The on-chain spell row for a `name_key` (the armed/hand id), or null. @param {string | null | undefined} name_key */
export function fight_spell(name_key) {
  return (name_key && by_name_key.get(name_key)) || null
}

/** The normalized sim template for a live on-chain spell name_key, or null. */
export function fight_spell_template(name_key) {
  return fight_spell(name_key)?.template ?? null
}

/** The SpellTemplate object id to stage in `act_cast` for a `name_key`, or null. @param {string | null | undefined} name_key */
export function spell_object_id(name_key) {
  return fight_spell(name_key)?.object_id ?? null
}
