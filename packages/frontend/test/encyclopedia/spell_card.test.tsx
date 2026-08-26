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

const [base_level] = spell.levels
const [base_effect] = base_level.effects

test('the shared spell card keeps its read layout at every size and opens on the invested level', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')

  // The full card: read layout intact, field-level admin edits exposed, and no
  // raw form control leaking into the read surface.
  const html = renderToStaticMarkup(
    <SpellCard edit={{ change: () => undefined, save: () => undefined }} spell={spell} />
  )

  expect(html).toContain('data-spell-detail-card=""')
  expect(html).toContain('data-spell-inline-edit="spell name"')
  expect(html).toContain('data-spell-effect-field="effect kind"')
  expect(html).toContain('data-spell-effect-field="effect power"')
  expect(html).toContain('data-spell-effect-field="target"')
  expect(html).toContain('data-spell-effect-field="area"')
  expect(html).not.toContain('data-spell-effect-field="duration"')
  expect(html).toContain('data-spell-add-critical-for=""')
  expect(html).toContain('(any target)')
  expect(html).toContain('data-spell-ap-cost="5"')
  expect(html).toContain('data-spell-level-tabs=""')
  expect(html).toContain('data-spell-effects=""')
  expect(html).toContain('Casts / turn')
  expect(html).not.toContain('Unlocks at')
  expect(html).toContain('Point')
  expect(html).not.toContain('<input')
  expect(html).not.toContain('<select')
  expect(html).not.toContain('data-spell-edit=')
  expect(html).not.toContain('aria-label="Edit spell effect"')

  // It opens on the fighter's invested level when asked.
  const leveled = Object.freeze({
    ...spell,
    levels: Object.freeze([base_level, Object.freeze({ ...base_level, ap_cost: 3 })]),
  }) satisfies SeedSpell
  expect(renderToStaticMarkup(<SpellCard initial_level={2} spell={leveled} />)).toContain('data-spell-ap-cost="3"')

  // The small card shows only the invested level's name, critical, and effects.
  const small_spell = Object.freeze({
    ...spell,
    levels: Object.freeze([base_level, Object.freeze({ ...base_level, ap_cost: 3, crit_1_in: 3 })]),
  }) satisfies SeedSpell
  const small_html = renderToStaticMarkup(<SpellCard initial_level={2} small spell={small_spell} />)

  expect(small_html).toContain('data-spell-small=""')
  expect(small_html).toContain('Ruinstroke')
  expect(small_html).toContain('Critical')
  expect(small_html).toContain('1 / 3')
  expect(small_html).toContain('data-spell-effects=""')
  expect(small_html).toContain('data-spell-effects-compact=""')
  // the compact wrapper KILLS the row separators via its override — assert the mechanism, not
  // the absence of the underlying utility (which legitimately remains on the shared row)
  expect(small_html).toContain('data-spell-effects-compact')
  expect(small_html).toContain('!border-b-0')
  expect(small_html).not.toContain('/spell.webp')
  expect(small_html).not.toContain('data-spell-level-tabs=""')
  expect(small_html).not.toContain('data-spell-ap-cost=')
  expect(small_html).not.toContain('Casts / turn')
  expect(small_html).not.toContain('Cooldown')
})

test('an aligned critical effect stays editable even while it matches its normal row', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const with_critical = {
    ...spell,
    levels: [{ ...base_level, crit_effects: [{ ...base_effect }] }],
  } as unknown as SeedSpell
  const html = renderToStaticMarkup(
    <SpellCard edit={{ change: () => undefined, save: () => undefined }} spell={with_critical} />
  )

  expect(html).toContain('data-spell-effect-field="critical effect"')
  expect(html).toContain('>Same</span>')
  expect(html).not.toContain('data-spell-add-critical-for=""')
})

test('an empty editable spell can bootstrap normal and critical effects', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const empty = {
    ...spell,
    levels: spell.levels.map((level) => ({ ...level, effects: [], crit_effects: [] })),
  } as unknown as SeedSpell
  const html = renderToStaticMarkup(
    <SpellCard edit={{ change: () => undefined, save: () => undefined }} spell={empty} />
  )

  expect(html).toContain('data-spell-add-effect=""')
  expect(html).toContain('data-spell-add-critical-effect=""')
})

test('optional duration and guaranteed chance remain editable at their zero/default values', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const editable = {
    ...spell,
    levels: [
      {
        ...base_level,
        effects: [{ ...base_effect, kind: 4, turns: 0, chance_bp: 10_000 }],
      },
    ],
  } as unknown as SeedSpell
  const html = renderToStaticMarkup(
    <SpellCard edit={{ change: () => undefined, save: () => undefined }} spell={editable} />
  )

  expect(html).toContain('data-spell-effect-field="duration"')
  expect(html).toContain('>Instant</button>')
  expect(html).toContain('data-spell-effect-field="chance"')
  expect(html).toContain('· 100%')
})

test('the class spell list owns unlock order and keeps unlock levels outside the card header', async () => {
  const { ClassesTab } = await import('../../src/encyclopedia/ClassesTab.tsx')
  const html = renderToStaticMarkup(
    <ClassesTab selected_id="senshi" select_class={() => undefined} text={(key) => key} />
  )
  const unlock_levels = [...html.matchAll(/Lv\. (\d+)/g)].map(([, level]) => Number(level))

  expect(unlock_levels.length).toBeGreaterThan(1)
  expect(unlock_levels).toEqual(unlock_levels.toSorted((left, right) => left - right))
  expect(html).toContain('data-characteristic-costs=""')
  expect(html).toContain('data-characteristic="intelligence"')
  expect(html).toContain('data-cost="2" data-from="20"')
  const card_header = html.slice(html.indexOf('data-spell-detail-card'), html.indexOf('data-spell-level-tabs'))
  expect(card_header).not.toContain('Lv.')
})

test('every effect kind reads as player prose, never as a raw stat row', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')

  const cases: readonly {
    why: string
    effects: readonly Record<string, unknown>[]
    crit_effects?: readonly Record<string, unknown>[]
    small?: boolean
    edit?: boolean
    reads: readonly string[]
    never: readonly string[]
  }[] = [
    {
      why: 'punishment scaling names the missing-HP term, not a percentage',
      effects: [{ ...base_effect, kind: 3, value: 41, value_max: 59 }],
      reads: ['41 to 59', 'damage, increased by missing HP'],
      never: ['41 to 59%'],
    },
    {
      why: 'caster self-damage addresses the caster instead of labelling a filter',
      effects: [{ ...base_effect, kind: 2, value: 11, value_max: 15, target_filter: 4 }],
      reads: ['Inflicts', 'damage on yourself'],
      never: ['(caster only)'],
    },
    {
      why: 'chatiment names its damage-fed turn cap instead of pretending to add a flat stat',
      effects: [{ ...base_effect, kind: 7, value: 140, value_max: 140, stat: 0, turns: 5, target_filter: 4 }],
      reads: ['Gains up to', '140', 'Strength', 'from damage received each turn', 'for 5 turns'],
      never: ['Chatiment 140', 'Adds 140'],
    },
    {
      why: 'timed HP removal reads as damage, and a critical row inherits the normal targeting',
      effects: [{ ...base_effect, kind: 5, stat: 12, value: 2, value_max: 3, turns: 2, target_filter: 0 }],
      crit_effects: [{ ...base_effect, kind: 5, stat: 12, value: 5, value_max: 5, turns: 2, target_filter: 1 }],
      edit: true,
      reads: ['Deals', '2 to 3', 'damage', 'for 2 turns'],
      never: ['Removes', 'enemies only', 'Critical target'],
    },
    {
      why: 'an HP grant reads as healing, not a generic stat addition',
      effects: [{ ...base_effect, kind: 4, stat: 12, value: 8, value_max: 8, target_filter: 4 }],
      reads: ['Heals', '8', 'HP'],
      never: ['Adds'],
    },
    {
      why: 'damage reduction reads as a shield and never leaks its ignored stat field',
      effects: [{ ...base_effect, kind: 14, stat: 0, value: 12, value_max: 12, turns: 1, target_filter: 3 }],
      reads: ['Reduces damage by', '12'],
      never: ['Strength'],
    },
    {
      why: 'reflect names the fixed non-elemental damage Move applies',
      effects: [{ ...base_effect, kind: 15, element: '', value: 2, value_max: 2, turns: 2 }],
      small: true,
      reads: ['Reflects', '2', 'damage'],
      never: ['Reflect 2'],
    },
    {
      why: 'a target restriction stays visibly separated and dimmer than the effect prose',
      effects: [{ ...base_effect, target_filter: 3, turns: 2 }],
      small: true,
      reads: ['text-[8px] text-[#858994]', '(allies only)', 'for 2 turns'],
      never: ['(allies only)for'],
    },
    {
      why: 'a single-cell effect exposes no meaningless zero-sized area',
      effects: [{ ...base_effect, area_shape: 1, area_size: 0 }],
      reads: [],
      never: ['title="Circle"'],
    },
  ]

  cases.forEach(({ why, effects, crit_effects, small, edit, reads, never }) => {
    const fixture = {
      ...spell,
      levels: [{ ...base_level, effects, ...(crit_effects ? { crit_effects } : {}) }],
    } as unknown as SeedSpell
    const html = renderToStaticMarkup(
      <SpellCard
        edit={edit ? { change: () => undefined, save: () => undefined } : undefined}
        small={small}
        spell={fixture}
      />
    )

    reads.forEach((prose) => expect(html, `${why} — reads "${prose}"`).toContain(prose))
    never.forEach((prose) => expect(html, `${why} — never "${prose}"`).not.toContain(prose))
  })
})

test('read-only effect fields remain separate flex items so chatiment prose keeps its gap', async () => {
  const { SpellCard } = await import('../../src/encyclopedia/SpellCard.tsx')
  const fixture = {
    ...spell,
    levels: [
      {
        ...base_level,
        effects: [{ ...base_effect, kind: 7, value: 140, value_max: 140, stat: 0, turns: 5, target_filter: 4 }],
      },
    ],
  } as unknown as SeedSpell

  const html = renderToStaticMarkup(<SpellCard spell={fixture} text={() => ''} />)

  expect(html).toContain('>Strength</span><span>from damage received each turn</span>')
})
