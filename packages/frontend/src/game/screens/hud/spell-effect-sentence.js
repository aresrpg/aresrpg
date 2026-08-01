// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure spell-effect prose for the shared spell-surface seam. Values, durations and wire vocabulary never
// enter these sentences: each live corpus kind owns one localized meaning template. APPLY_STATE is the one
// content-backed reference; L2 supplies its published name through resolve_state_name.

const element_keys = Object.freeze({
  0: 'spells.el_fire',
  1: 'spells.el_water',
  2: 'spells.el_earth',
  3: 'spells.el_air',
  255: 'spells.neutral',
  fire: 'spells.el_fire',
  water: 'spells.el_water',
  earth: 'spells.el_earth',
  air: 'spells.el_air',
  neutral: 'spells.neutral',
})

const point_keys = Object.freeze({
  0: 'stat.action',
  1: 'stat.movement',
})

const stat_keys = Object.freeze({
  0: 'stat.strength',
  1: 'stat.intelligence',
  2: 'stat.chance',
  3: 'stat.agility',
  4: 'stat.wisdom',
  5: 'stat.vitality',
  6: 'stat.range',
  7: 'stat.critical_hit',
  8: 'stat.percent_damage',
  9: 'stat.raw_damage',
  10: 'stats.health',
  11: 'stat.heal',
})

/** The exact 2026-08-01 live corpus vocabulary from SPELL_TEXT_CONTRACT.md at 3eb716d. */
export const spell_effect_sentence_templates = Object.freeze({
  0: 'spells.effect_sentence.damage',
  1: 'spells.effect_sentence.percent_life',
  2: 'spells.effect_sentence.life_steal',
  3: 'spells.effect_sentence.caster_damage',
  4: 'spells.effect_sentence.punishment',
  5: 'spells.effect_sentence.heal',
  6: 'spells.effect_sentence.give_points',
  7: 'spells.effect_sentence.remove_points',
  8: 'spells.effect_sentence.steal_points',
  9: 'spells.effect_sentence.alter_stat',
  10: 'spells.effect_sentence.steal_stat',
  11: 'spells.effect_sentence.alter_resist',
  12: 'spells.effect_sentence.push',
  13: 'spells.effect_sentence.pull',
  14: 'spells.effect_sentence.teleport',
  15: 'spells.effect_sentence.swap',
  16: 'spells.effect_sentence.carry',
  17: 'spells.effect_sentence.throw',
  19: 'spells.effect_sentence.place_trap',
  20: 'spells.effect_sentence.place_glyph',
  21: 'spells.effect_sentence.apply_dot',
  22: 'spells.effect_sentence.apply_state',
  24: 'spells.effect_sentence.reduce_damage',
  25: 'spells.effect_sentence.reflect_damage',
  26: 'spells.effect_sentence.dispel',
  27: 'spells.effect_sentence.invisibility',
  28: 'spells.effect_sentence.reveal',
  29: 'spells.effect_sentence.return_spell',
})

const plain_reference = (value, unavailable_message) => {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || /[0-9]|[\r\n_]|\{\{|\}\}/u.test(name)) throw new Error(unavailable_message)
  return name
}

const translated_reference = (t, key) => {
  if (!key) throw new Error('Spell effect reference name is unavailable.')
  const name = plain_reference(t(key), 'Spell effect reference name is unavailable.')
  if (name === key) throw new Error('Spell effect reference name is unavailable.')
  return name
}

const element_name = (t, effect) => translated_reference(t, element_keys[effect?.element])

const point_name = (t, effect) => translated_reference(t, point_keys[effect?.stat])

const stat_name = (t, effect) =>
  translated_reference(t, stat_keys[effect?.stat] ?? 'stats.characteristics')

const state_name = (effect, resolve_state_name) => {
  if (typeof resolve_state_name !== 'function') throw new Error('Spell state name is unavailable.')
  const state_reference = effect?.state_id ?? effect?.value
  const resolved_name = (() => {
    try {
      return resolve_state_name(state_reference)
    } catch {
      throw new Error('Spell state name is unavailable.')
    }
  })()
  return plain_reference(resolved_name, 'Spell state name is unavailable.')
}

const sentence_params = (t, kind, effect, resolve_state_name) => {
  if ([0, 1, 2, 3, 4, 21].includes(kind)) return { element: element_name(t, effect) }
  if ([6, 7, 8].includes(kind)) return { points: point_name(t, effect) }
  if ([9, 10].includes(kind)) return { stat: stat_name(t, effect) }
  if (kind === 11) return { element: element_name(t, effect) }
  if (kind === 22) return { state: state_name(effect, resolve_state_name) }
  return {}
}

const plain_sentence = (value) => {
  const sentence = String(value).trim()
  const terminators = sentence.match(/[.!?。！？]/gu) ?? []
  const raw_key_path = /\b[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+\b/i
  if (
    !sentence ||
    /[0-9]|[\r\n_]|\{\{|\}\}/u.test(sentence) ||
    raw_key_path.test(sentence) ||
    terminators.length !== 1 ||
    !/[.!?。！？]$/u.test(sentence)
  )
    throw new Error('Spell effect sentence is unavailable.')
  return sentence
}

/**
 * Render one raw or projected corpus effect as one value-free localized sentence.
 * @param {(key: string, params?: object) => string} t
 * @param {{ kind?: number | string, kind_id?: number, element?: number | string, stat?: number,
 *   state_id?: number | string, value?: number | string }} effect
 * @param {{ resolve_state_name?: (state_reference: number | string | undefined) => string | null }} options
 */
export const spell_effect_sentence = (t, effect, { resolve_state_name } = {}) => {
  const raw_kind = effect?.kind_id ?? effect?.kind
  const kind = Number(raw_kind)
  const template_key = Number.isInteger(kind) ? spell_effect_sentence_templates[kind] : null
  if (!template_key) throw new Error('Spell effect sentence template is unavailable.')
  const params = sentence_params(t, kind, effect, resolve_state_name)
  return plain_sentence(t(template_key, params))
}
