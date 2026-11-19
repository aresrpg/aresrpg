// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  SpellCard,
  SpellEffectList,
  type ItemSheetField,
  type SpellCardProps,
  type SpellGlyph,
} from '../../src/index.ts'

const glyph =
  (name: string): SpellGlyph =>
  ({ className }) => <svg className={className} data-glyph={name} />

const labels = Object.fromEntries(
  [
    'ap_cost',
    'range',
    'crit_chance',
    'effects',
    'range_modifiability',
    'line_of_sight',
    'cast_line',
    'target_cell_empty',
    'casts_per_turn',
    'casts_per_target',
    'cooldown',
    'unlimited',
    'cooldown_none',
  ].map((key) => [key, key.toUpperCase()])
) as SpellCardProps['labels']

const card: SpellCardProps = {
  name: 'Ember Lance',
  caster: { label: 'Yogan', color: '#ff4500' },
  art: <img alt="" src="lance.webp" />,
  rank: { index: 1, label: 'Level 2', unlock: 'Unlocks at 21' },
  ranks: { labels: ['Level 1', 'Level 2'], select: () => undefined },
  level: {
    ap_cost: 4,
    range_min: 1,
    range_max: 6,
    crit_1_in: 30,
    modifiable_range: true,
    line_of_sight: false,
    line_launch: true,
    free_cell: false,
    casts_per_turn: 0,
    casts_per_target: 2,
    cooldown_turns: 0,
  },
  labels,
  icons: { ap: glyph('ap'), range: glyph('range'), critical: glyph('critical'), yes: glyph('yes'), no: glyph('no') },
  effects: {
    rows: [
      {
        kind: 'read',
        key: 'effect-0',
        icon: { kind: 'dot', color: '#ff4500' },
        pre: 'Deals ',
        value: '8 to 12',
        tone: '#ff4500',
        post: ' fire damage',
        area: { label: 'Cross 2', size: 2, mask: ['00100', '00100', '11111', '00100', '00100'] },
        target: 'Enemies only',
        turns: null,
        chance: 50,
        critical: { label: 'Critical', value: '14 to 18' },
      },
    ],
  },
}

test('the spell card pins its hooks, rank, metrics and fact order', () => {
  const html = renderToStaticMarkup(<SpellCard {...card} />)

  expect(html).toContain('data-spell-detail-card="" data-spell-current-level="2"')
  expect(html).toContain('data-spell-art=""')
  expect(html).toContain('<span>Level 2</span><span>Unlocks at 21</span>')
  expect(html).toContain('aria-label="Level 2" aria-pressed="true"')
  expect(html).toContain('data-spell-ap-cost="4"')
  expect(html).toContain('1–6')
  expect(html).toContain('1 / 30')
  expect(html.indexOf('AP_COST')).toBeLessThan(html.indexOf('RANGE<'))
  expect(html.match(/data-glyph="(yes|no)"/g)).toEqual([
    'data-glyph="yes"',
    'data-glyph="no"',
    'data-glyph="yes"',
    'data-glyph="no"',
  ])
  expect(html).toContain('>UNLIMITED<')
  expect(html).toContain('>2<')
  expect(html).toContain('>COOLDOWN_NONE<')
})

test('effect lines keep their prose, pictogram, chance and critical badge', () => {
  const html = renderToStaticMarkup(<SpellCard {...card} />)

  expect(html).toContain('data-spell-effect-row="true"')
  expect(html).toContain('Deals <b style="color:#ff4500">8 to 12</b> fire damage')
  expect(html).toContain('title="Cross 2"')
  expect(html.match(/aui-spell-area-on/g)).toHaveLength(9)
  expect(html).toContain('data-spell-effect-target="true">(Enemies only)')
  expect(html).toContain('>· 50%<')
  expect(html).toContain('data-spell-critical-badge="true"')
  expect(html).toContain('14 to 18')
})

test('the compact card hides the rank picker and compacts its effect list', () => {
  const html = renderToStaticMarkup(<SpellCard {...card} effects={{ ...card.effects, compact: true }} small />)

  expect(html).toContain('data-spell-small=""')
  expect(html).not.toContain('data-spell-level-tabs')
  expect(html).toContain('data-spell-effects-compact=""')
})

test('authoring routes every displayed value through the field decorator', () => {
  const slots: string[] = []
  const field: ItemSheetField = ({ slot, display }) => {
    slots.push(slot)
    return <i data-slot={slot}>{display}</i>
  }
  renderToStaticMarkup(
    <SpellCard
      {...card}
      effects={{
        field,
        footer: <button data-footer="" type="button" />,
        row_action: (key) => <button data-action={key} type="button" />,
        rows: [
          {
            kind: 'draft',
            key: 'effect-0',
            icon: { kind: 'dot', color: '#ff4500' },
            action: 'Deals',
            amount: { text: '8 to 12', color: '#ff4500' },
            stat: null,
            suffix: 'damage',
            area: { label: 'Point', size: 0, mask: null },
            target: '(enemies only)',
            duration: { text: 'Instant', active: false },
            chance: '· 100%',
            critical: null,
          },
        ],
      }}
      field={field}
    />
  )

  expect(new Set(slots)).toEqual(
    new Set([
      'name',
      'classe',
      'ap_cost',
      'range',
      'crit_1_in',
      'effect-0:element',
      'effect-0:kind',
      'effect-0:power',
      'effect-0:suffix',
      'effect-0:area',
      'effect-0:target',
      'effect-0:duration',
      'effect-0:chance',
      'modifiable_range',
      'line_of_sight',
      'line_launch',
      'free_cell',
      'casts_per_turn',
      'casts_per_target',
      'cooldown_turns',
    ])
  )
  expect(slots).toHaveLength(20)
})

test('an effect list stands alone for fight tooltips', () => {
  const html = renderToStaticMarkup(<SpellEffectList compact rows={card.effects.rows} />)
  expect(
    html.startsWith('<div class="aui-spell-effects aui-spell-effects-compact" data-spell-effects-compact="">')
  ).toBe(true)
})
