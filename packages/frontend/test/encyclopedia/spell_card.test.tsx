// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { SeedSpell } from '../../src/content/catalog.ts'

mock.module('../../src/content/assets.ts', () => ({ spell_icon: () => '/spell.webp' }))

const spell = Object.freeze({
  name: 'Ruinstroke',
  classe: 'senshi',
  unlock_level: 21,
  levels: Object.freeze([
    Object.freeze({
      ap_cost: 5,
      range_min: 1,
      range_max: 5,
      modifiable_range: true,
      line_of_sight: true,
      line_launch: false,
      free_cell: false,
      casts_per_turn: 0,
      casts_per_target: 0,
      cooldown_turns: 0,
      crit_1_in: 50,
      effects: Object.freeze([
        Object.freeze({
          kind: 0,
          element: 'fire',
          value: 6,
          value_max: 20,
          area_shape: 0,
          area_size: 0,
          target_filter: 0,
          chance_bp: 10000,
          turns: 0,
          stat: 0,
        }),
      ]),
      crit_effects: Object.freeze([]),
    }),
  ]),
}) satisfies SeedSpell

test('the shared spell card keeps its read layout while exposing field-level admin edits', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const html = renderToStaticMarkup(
    <SpellCard edit={{ change: () => undefined, save: () => undefined }} spell={spell} />
  )

  expect(html).toContain('data-spell-detail-card=""')
  expect(html).toContain('data-spell-inline-edit="spell name"')
  expect(html).toContain('data-spell-effect-field="effect kind"')
  expect(html).toContain('data-spell-effect-field="effect power"')
  expect(html).toContain('data-spell-effect-field="target"')
  expect(html).toContain('(any target)')
  expect(html).toContain('data-spell-ap-cost="5"')
  expect(html).toContain('data-spell-level-tabs=""')
  expect(html).toContain('data-spell-effects=""')
  expect(html).toContain('Casts / turn')
  expect(html).not.toContain('Unlocks at')
  expect(html).not.toContain('Point')
  expect(html).not.toContain('<input')
  expect(html).not.toContain('<select')
  expect(html).not.toContain('data-spell-edit=')
  expect(html).not.toContain('aria-label="Edit spell effect"')
})

test('the shared spell card opens on the fighter invested level when requested', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const [first_level] = spell.levels
  if (!first_level) throw new Error('spell fixture has no level')
  const leveled_spell = Object.freeze({
    ...spell,
    levels: Object.freeze([first_level, Object.freeze({ ...first_level, ap_cost: 3 })]),
  }) satisfies SeedSpell

  const html = renderToStaticMarkup(<SpellCard initial_level={2} spell={leveled_spell} />)

  expect(html).toContain('data-spell-ap-cost="3"')
})

test('small spell cards show only the invested level name, critical, and effects', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const [first_level] = spell.levels
  if (!first_level) throw new Error('spell fixture has no level')
  const leveled_spell = Object.freeze({
    ...spell,
    levels: Object.freeze([first_level, Object.freeze({ ...first_level, ap_cost: 3, crit_1_in: 3 })]),
  }) satisfies SeedSpell

  const html = renderToStaticMarkup(<SpellCard initial_level={2} small spell={leveled_spell} />)

  expect(html).toContain('data-spell-small=""')
  expect(html).toContain('Ruinstroke')
  expect(html).toContain('Critical')
  expect(html).toContain('1 / 3')
  expect(html).toContain('data-spell-effects=""')
  expect(html).toContain('data-spell-effects-compact=""')
  // the compact wrapper KILLS the row separators via its override — assert the mechanism, not
  // the absence of the underlying utility (which legitimately remains on the shared row)
  expect(html).toContain('data-spell-effects-compact')
  expect(html).toContain('!border-b-0')
  expect(html).not.toContain('/spell.webp')
  expect(html).not.toContain('data-spell-level-tabs=""')
  expect(html).not.toContain('data-spell-ap-cost=')
  expect(html).not.toContain('Casts / turn')
  expect(html).not.toContain('Cooldown')
})

test('the class spell list owns unlock order and keeps unlock levels outside the card header', async () => {
  const { ClassesTab } = await import('../../src/encyclopedia/ClassesTab.tsx')
  const html = renderToStaticMarkup(
    <ClassesTab selected_id="senshi" select_class={() => undefined} text={(key) => key} />
  )
  const unlock_levels = [...html.matchAll(/Lv\. (\d+)/g)].map(([, level]) => Number(level))

  expect(unlock_levels.length).toBeGreaterThan(1)
  expect(unlock_levels).toEqual(unlock_levels.toSorted((left, right) => left - right))
  const card_header = html.slice(html.indexOf('data-spell-detail-card'), html.indexOf('data-spell-level-tabs'))
  expect(card_header).not.toContain('Lv.')
})

test('damage formula prose explains punishment scaling and caster self-damage', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const [level] = spell.levels
  const [effect] = level.effects
  const punishment = {
    ...spell,
    levels: [{ ...level, effects: [{ ...effect, kind: 3, value: 41, value_max: 59 }] }],
  } satisfies SeedSpell
  const caster_damage = {
    ...spell,
    levels: [{ ...level, effects: [{ ...effect, kind: 2, value: 11, value_max: 15, target_filter: 4 }] }],
  } satisfies SeedSpell
  const punishment_html = renderToStaticMarkup(<SpellCard spell={punishment} />)
  const caster_html = renderToStaticMarkup(<SpellCard spell={caster_damage} />)

  expect(punishment_html).toContain('41 to 59')
  expect(punishment_html).toContain('damage, increased by missing HP')
  expect(punishment_html).not.toContain('41 to 59%')
  expect(caster_html).toContain('Inflicts')
  expect(caster_html).toContain('damage on yourself')
  expect(caster_html).not.toContain('(caster only)')
})

test('timed HP removal reads as damage and critical targeting inherits the normal row', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const [level] = spell.levels
  const [effect] = level.effects
  const timed_damage = {
    ...spell,
    levels: [
      {
        ...level,
        effects: [{ ...effect, kind: 5, stat: 12, value: 2, value_max: 3, turns: 2, target_filter: 0 }],
        crit_effects: [{ ...effect, kind: 5, stat: 12, value: 5, value_max: 5, turns: 2, target_filter: 1 }],
      },
    ],
  } satisfies SeedSpell
  const html = renderToStaticMarkup(
    <SpellCard edit={{ change: () => undefined, save: () => undefined }} spell={timed_damage} />
  )

  expect(html).toContain('Deals')
  expect(html).toContain('2 to 3')
  expect(html).toContain('damage')
  expect(html).toContain('for 2 turns')
  expect(html).not.toContain('Removes')
  expect(html).not.toContain('enemies only')
  expect(html).not.toContain('Critical target')
})

test('target restrictions remain visibly separated and dimmer than effect prose', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const [level] = spell.levels
  const [effect] = level.effects
  const restricted = {
    ...spell,
    levels: [{ ...level, effects: [{ ...effect, target_filter: 3, turns: 2 }] }],
  } satisfies SeedSpell
  const html = renderToStaticMarkup(<SpellCard small spell={restricted} />)

  expect(html).toContain('text-[8px] text-[#858994]')
  expect(html).toContain('(allies only)')
  expect(html).toContain('for 2 turns')
  expect(html).not.toContain('(allies only)for')
})
