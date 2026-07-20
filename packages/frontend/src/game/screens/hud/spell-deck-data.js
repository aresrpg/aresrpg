// Per-spell SpellDetail view (NO JSX). The shared SpellDetail panel's data home: `spell_detail_view` +
// `area_label`, rendered by SpellDetail.jsx (FightArmedReadout — template / non-dungeon fights).
// LEGACY-RESIDUAL: it reads the sim's normalized SpellTemplate map (@aresrpg/sim via fight.js) because that map
// carries the hand-authored DESCRIPTION and the min/max damage ROLLS the on-chain fight SSOT (fight-spells.json)
// has no shape for — the chain model is a FIXED `base` + `crit_base` per level. Chain / dungeon spells (keyed by
// name_key) are absent from that short-id map, so DungeonSpellReadout.jsx already renders them straight off
// fight-spells.js; this path only serves the legacy template SPELL_TEMPLATES. Element tints: the element-colors SSOT.
//
// The former `class_spell_pool` / `unlock_levels` deck derivations were deleted 2026-07-12: the deck + grimoire
// pivoted to the fight-spells.json SSOT (spellbook-data.js → class_spells), which left those exports dead. The
// legacy classes.json `{ level -> ONE id }` map they inverted could never hold three starters at one unlock; the
// SSOT filter can — see spell-unlock-select.js.

import { SPELL_TEMPLATES, spell_card } from '../../core/modules/fight.js'

import { element_color } from './element-colors.js'

/** @typedef {'fire' | 'water' | 'earth' | 'air' | 'buff'} SpellBucket */

// Non-damage spells share one BUFF bucket + tint (the house epic violet; element-colors carries no buff
// key, so this single category colour is defined here, not a re-declared element colour).
const BUFF_COLOR = '#b07cff'

// Effect types that make a spell "elemental" for bucketing/tint (a damaging spell of its element).
const DAMAGE_TYPES = new Set(['DAMAGE', 'POISON'])

/** Title-case an UPPERCASE label, e.g. 'CIRCLE' -> 'Circle', 'FIRE' -> 'Fire'. @param {string} s */
const titleize = s =>
  (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).replace(/_/g, ' ')

/**
 * Classify a spell into a filter bucket + display kind + tint from its level-1 base effects (the sim
 * normalized template). A DAMAGE/POISON effect makes it elemental (its element drives bucket + colour);
 * anything else is a non-damage BUFF (heals/steals read as kind 'Heal' but still bucket 'buff' — the
 * builder has no separate Heal filter).
 * @param {string} spell_id  short spell id
 * @returns {{ school: 'fire' | 'water' | 'earth' | 'air' | null, bucket: SpellBucket, kind: string, color: string }}
 */
const categorize = spell_id => {
  const effects = SPELL_TEMPLATES.get(spell_id)?.levels[0]?.base_effects ?? []
  const dmg = effects.find(e => DAMAGE_TYPES.has(e.type) && e.element != null)
  if (dmg?.element) {
    const school = /** @type {'fire' | 'water' | 'earth' | 'air'} */ (
      String(dmg.element).toLowerCase()
    )
    return {
      school,
      bucket: school,
      kind: 'Damage',
      color: element_color(dmg.element),
    }
  }
  const heal = effects.some(e => e.type === 'HEAL' || e.type === 'STEAL')
  return {
    school: null,
    bucket: 'buff',
    kind: heal ? 'Heal' : 'Buff',
    color: BUFF_COLOR,
  }
}

/**
 * @typedef {object} EffectView
 * @property {string} text
 * @property {string} color            element dot colour (neutral when non-elemental)
 * @property {number | null} chance    percent, only when below 100
 * @property {string | null} target    ENEMY | SELF | CELL | ALLY | ANY | TRAP
 * @property {number | null} turns     duration in turns, when timed
 */

/**
 * @typedef {object} SpellDetailView
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {string} description
 * @property {string} color             category tint (element or buff)
 * @property {string | null} school     'fire' | 'water' | 'earth' | 'air' or null (buff)
 * @property {string} kind              'Damage' | 'Heal' | 'Buff'
 * @property {number} cost
 * @property {[number, number]} range
 * @property {number} area
 * @property {string} area_type         'CIRCLE' | 'SQUARE' | 'LINE'
 * @property {boolean} line_of_sight
 * @property {number} critical_chance   1-in-N (0 = none)
 * @property {number} cooldown          turns to recast (0 = none)
 * @property {number} casts_per_turn    0 = no limit
 * @property {number} casts_per_target  0 = no limit
 * @property {EffectView[]} effects
 */

/**
 * Human effect description (donor spell_card.vue wording, lifted onto the sim's UPPERCASE effect union).
 * Damage / heal / poison show a min-max (or single) value; movement / control effects describe the action.
 * @param {import('@aresrpg/sim').SpellEffect} e @returns {string}
 */
const effect_text = e => {
  const value =
    e.min != null && e.max != null
      ? e.min === e.max
        ? `${e.min}`
        : `${e.min} to ${e.max}`
      : ''
  const el = e.element ? `${titleize(String(e.element))} ` : ''
  switch (e.type) {
    case 'DAMAGE':
      return `${value} ${el}damage`.trim()
    case 'POISON':
      return `Poison ${value} ${el}damage`.trim()
    case 'HEAL':
      return `Heals ${value}`.trim()
    case 'STEAL':
      return `Steals ${value} life`.trim()
    case 'STUN':
      return 'Stuns the target'
    case 'TELEPORT':
      return 'Teleport to a cell'
    case 'PUSH':
      return `Push ${e.distance ?? 1} cells`
    case 'PULL':
      return `Pull ${e.distance ?? 1} cells`
    case 'SHIELD':
      return value ? `Shield ${value}` : 'Shield'
    case 'GLYPH':
      return 'Places a glyph'
    case 'SUMMON':
      return 'Summons an ally'
    default:
      return titleize(e.raw_type ?? e.type)
  }
}

/** @param {import('@aresrpg/sim').SpellEffect} e @returns {EffectView} */
const effect_view = e => ({
  text: effect_text(e),
  color: element_color(e.element),
  chance: typeof e.chance === 'number' && e.chance < 100 ? e.chance : null,
  target: e.target ? e.target.toUpperCase() : null,
  turns: typeof e.turns === 'number' && e.turns > 0 ? e.turns : null,
})

/**
 * Build the full Spell Detail view from the sim's normalized SpellTemplate (the same data the fight engine
 * resolves) + the spell art / name. Reused by the deck builder AND the in-fight armed-spell readout
 * (canon/14) so both render one schema. Returns null for an unknown id.
 * @param {string} spell_id  short spell id @returns {SpellDetailView | null}
 */
export const spell_detail_view = spell_id => {
  const template = SPELL_TEMPLATES.get(spell_id)
  if (!template) return null
  const level = template.levels[0] ?? null
  const card = spell_card(spell_id)
  const cat = categorize(spell_id)
  return {
    id: spell_id,
    name: card.name,
    icon: card.icon,
    description: template.description,
    color: cat.color,
    school: cat.school,
    kind: cat.kind,
    cost: level?.cost ?? 0,
    range: level?.range ?? [0, 0],
    area: level?.area ?? 0,
    area_type: level?.area_type ?? 'CIRCLE',
    line_of_sight: !!level?.line_of_sight,
    critical_chance: level?.critical_chance ?? 0,
    cooldown: level?.cooldown_turns ?? 0,
    casts_per_turn: level?.casts_per_turn ?? 0,
    casts_per_target: level?.casts_per_target ?? 0,
    effects: (level?.base_effects ?? []).map(effect_view),
  }
}

/**
 * The Area fact, human-readable: "Square 2" / "Line 3" / "Single" (area 0). @param {number} area
 * @param {string} area_type @returns {string}
 */
export const area_label = (area, area_type) =>
  area > 0 ? `${titleize(area_type)} ${area}` : 'Single'
