// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Display-only spell taxonomy shared by the hotbar, grimoire, and encyclopedia. A category describes the
// selected level's rendered effects, never the spell-family metadata that can describe a different level.

import { element_color } from './element-colors.js'

// The established spell-deck violet, moved here so every spell surface shares the same existing family tint.
export const SPELL_BUFF_COLOR = '#b07cff'

const ELEMENTS = new Set(['fire', 'water', 'earth', 'air'])
const ELEMENTAL_EFFECTS = new Set([
  'DAMAGE',
  'PERCENT_LIFE',
  'LIFE_STEAL',
  'CASTER_DAMAGE',
  'PUNISHMENT',
  'HEAL',
  'APPLY_DOT',
])
const BUFF_EFFECTS = new Set([
  'GIVE_POINTS',
  'REDUCE_DAMAGE',
  'REFLECT_DAMAGE',
  'RETURN_SPELL',
])
const FRIENDLY_BUFF_EFFECTS = new Set(['ALTER_STAT', 'ALTER_RESIST'])
const TF_ALLY = 4
const TF_SELF = 32

const has_friendly_target = (effect) => {
  const target_filter = Number(effect?.target_filter ?? 0)
  return (target_filter & (TF_ALLY | TF_SELF)) !== 0
}

/**
 * @param {{ effects?: Array<{ kind?: string, element?: string, target_filter?: number }> } | null | undefined} level
 * @returns {{ key: 'fire' | 'water' | 'earth' | 'air' | 'buff' | 'utility',
 *   family: 'damage' | 'heal' | 'buff' | 'utility', color: string }}
 */
export const spell_category = (level) => {
  const effects = level?.effects ?? []
  const elemental = effects.find((effect) => {
    const element = String(effect?.element ?? '').toLowerCase()
    return ELEMENTAL_EFFECTS.has(effect?.kind) && ELEMENTS.has(element)
  })
  if (elemental) {
    const key = /** @type {'fire' | 'water' | 'earth' | 'air'} */ (
      String(elemental.element).toLowerCase()
    )
    return {
      key,
      family: elemental.kind === 'HEAL' ? 'heal' : 'damage',
      color: element_color(key),
    }
  }

  const is_buff = effects.some(
    (effect) =>
      BUFF_EFFECTS.has(effect?.kind) ||
      (FRIENDLY_BUFF_EFFECTS.has(effect?.kind) && has_friendly_target(effect)),
  )
  if (is_buff) return { key: 'buff', family: 'buff', color: SPELL_BUFF_COLOR }
  return { key: 'utility', family: 'utility', color: 'var(--color-gold)' }
}
