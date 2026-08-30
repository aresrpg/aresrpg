// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { SpellEffect, SpellLevel } from '@aresrpg/fight'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { FightSpellView } from '../../../src/game/fight/fight_projection.ts'

const effect: SpellEffect = {
  kind: 0n,
  element: 'fire',
  value: 22n,
  value_max: 22n,
  area_shape: 0n,
  area_size: 0n,
  target_filter: 0n,
  chance_bp: 10_000n,
  turns: 0n,
  stat: 0n,
}

test('fight spell details display the fight-projected critical denominator', async () => {
  const { fight_spell_detail } = await import('../../../src/game/fight/FightSpell.tsx')
  const details: SpellLevel = {
    ap_cost: 3n,
    range_min: 1n,
    range_max: 4n,
    modifiable_range: false,
    line_of_sight: true,
    line_launch: false,
    free_cell: false,
    casts_per_turn: 0n,
    casts_per_target: 0n,
    cooldown_turns: 0n,
    crit_1_in: 3n,
    effects: [effect],
    crit_effects: [],
  }
  const spell: FightSpellView = Object.freeze({
    name: 'Burning Arrow',
    level: 1n,
    details,
    source: Object.freeze({ classe: 'yogan', unlock_level: 1n, levels: [details] }),
    cooldown: 0n,
    turn: Object.freeze({
      critical: false,
      crit_1_in: 2n,
      effects: Object.freeze([{ ...effect, critical_only: false }]),
    }),
  })

  expect(fight_spell_detail(spell).levels[0]?.crit_1_in).toBe(2)
})

test('an unaffordable spell does not display the turn-critical border', async () => {
  const { FightSpell } = await import('../../../src/game/fight/FightSpell.tsx')
  const details: SpellLevel = {
    ap_cost: 3n,
    range_min: 1n,
    range_max: 4n,
    modifiable_range: false,
    line_of_sight: true,
    line_launch: false,
    free_cell: false,
    casts_per_turn: 0n,
    casts_per_target: 0n,
    cooldown_turns: 0n,
    crit_1_in: 3n,
    effects: [effect],
    crit_effects: [],
  }
  const spell: FightSpellView = Object.freeze({
    name: 'Burning Arrow',
    level: 1n,
    details,
    source: Object.freeze({ classe: 'yogan', unlock_level: 1n, levels: [details] }),
    cooldown: 0n,
    turn: Object.freeze({
      critical: true,
      crit_1_in: 2n,
      effects: Object.freeze([{ ...effect, critical_only: false }]),
    }),
  })

  const html = renderToStaticMarkup(
    createElement(FightSpell, { spell, disabled: true, selected: false, select: () => {} })
  )

  expect(html).toContain('disabled')
  expect(html).not.toContain(' critical')
  expect(html).not.toContain('data-turn-critical')
})

test('a successful roll without a critical branch cannot promise a gold outcome', async () => {
  const { FightSpell } = await import('../../../src/game/fight/FightSpell.tsx')
  const details: SpellLevel = {
    ap_cost: 3n,
    range_min: 1n,
    range_max: 4n,
    modifiable_range: false,
    line_of_sight: true,
    line_launch: false,
    free_cell: false,
    casts_per_turn: 0n,
    casts_per_target: 0n,
    cooldown_turns: 0n,
    crit_1_in: 3n,
    effects: [effect],
    crit_effects: [],
  }
  const spell: FightSpellView = Object.freeze({
    name: 'Stain',
    level: 1n,
    details,
    source: Object.freeze({ classe: 'shusen', unlock_level: 1n, levels: [details] }),
    cooldown: 0n,
    turn: Object.freeze({
      critical: true,
      crit_1_in: 3n,
      effects: Object.freeze([{ ...effect, critical_only: false }]),
    }),
  })

  const html = renderToStaticMarkup(
    createElement(FightSpell, { spell, disabled: false, selected: false, select: () => {} })
  )
  expect(html).not.toContain(' critical')
  expect(html).not.toContain('data-turn-critical')
})

test('an affordable turn-critical spell marks its socket shell for shared hover-detail styling', async () => {
  const { FightSpell } = await import('../../../src/game/fight/FightSpell.tsx')
  const details: SpellLevel = {
    ap_cost: 3n,
    range_min: 1n,
    range_max: 4n,
    modifiable_range: false,
    line_of_sight: true,
    line_launch: false,
    free_cell: false,
    casts_per_turn: 0n,
    casts_per_target: 0n,
    cooldown_turns: 0n,
    crit_1_in: 3n,
    effects: [effect],
    crit_effects: [effect],
  }
  const spell: FightSpellView = Object.freeze({
    name: 'Burning Arrow',
    level: 1n,
    details,
    source: Object.freeze({ classe: 'yogan', unlock_level: 1n, levels: [details] }),
    cooldown: 0n,
    turn: Object.freeze({
      critical: true,
      crit_1_in: 2n,
      effects: Object.freeze([{ ...effect, critical_only: false }]),
    }),
  })

  const html = renderToStaticMarkup(
    createElement(FightSpell, { spell, disabled: false, selected: false, select: () => {} })
  )

  expect(html).toContain('fight-hud__spell-shell critical')
  expect(html).toContain('data-turn-critical="true"')
})
