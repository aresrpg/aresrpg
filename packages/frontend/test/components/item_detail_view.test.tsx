// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ItemDetailView, item_stat_display_range, item_stat_rows } from '../../src/components/ItemDetailView.tsx'

const labels = Object.freeze({
  characteristics: 'Characteristics',
  damages: 'damages',
  level_short: 'Lv. 80',
  range_to: 'to',
})

test('the shared detail sheet owns HD item art instead of accepting a thumbnail URL', () => {
  const component = readFileSync(new URL('../../src/components/ItemDetailView.tsx', import.meta.url), 'utf8')

  expect(component).toContain("import { item_detail_icon } from '../content/item_detail_assets.ts'")
  expect(component).toContain('const icon = item_detail_icon(item_type)')
  expect(component).toContain('item_type: string')
  expect(component).not.toContain('icon: string | null')
})

test('editable item stat rows promote defined values and retain the complete vocabulary', () => {
  const rows = item_stat_rows(
    {
      min: { vitality: 10, movement: 1 },
      max: { vitality: 20, movement: 1 },
    },
    true
  )

  expect(rows.slice(0, 2).map(({ key }) => key)).toEqual(['vitality', 'movement'])
  expect(rows.find(({ key }) => key === 'wisdom')).toEqual({ key: 'wisdom', minimum: 0, maximum: 0 })

  // Negative ranges display from the mildest to the strongest penalty.
  expect(item_stat_display_range({ key: 'intelligence', minimum: -9, maximum: -1 })).toEqual([-1, -9])
  expect(item_stat_display_range({ key: 'vitality', minimum: 3, maximum: 18 })).toEqual([3, 18])
})

test('the shared item detail exposes click-to-edit fields without changing read-only callers', () => {
  const common = {
    category: 'sword',
    damages: [{ element: 'earth', from: 3, to: 7, damage_type: 'weapon' }],
    item_type: 'aberrant_edge',
    labels,
    level: 80,
    name: 'Aberrant Edge',
    stats: { min: { vitality: 10 }, max: { vitality: 20 } },
  } as const
  const editable = renderToStaticMarkup(
    <ItemDetailView edit={{ change: () => undefined, save: () => undefined }} {...common} />
  )
  const readonly = renderToStaticMarkup(<ItemDetailView {...common} />)

  expect(editable).toContain('data-item-detail-editable=""')
  expect(readonly).toContain('data-item-detail-name=""')
  expect(editable).toContain('data-item-inline-edit="Vitality"')
  expect(editable).toContain('data-item-stat="wisdom"')
  expect(readonly).not.toContain('data-item-detail-editable=""')
  expect(readonly).not.toContain('data-item-stat="wisdom"')
})

test('rune item details show the exact stat points added by one rune', () => {
  const pa_vi = renderToStaticMarkup(
    <ItemDetailView
      category="rune"
      damages={[]}
      item_type="rune_vitality_pa"
      labels={labels}
      level={20}
      name="Rune Pa Vi"
    />
  )
  const ba_do = renderToStaticMarkup(
    <ItemDetailView
      category="rune"
      damages={[]}
      item_type="rune_raw_damage_ba"
      labels={labels}
      level={20}
      name="Rune Ba Do"
    />
  )

  expect(pa_vi).toContain('data-rune-effect=""')
  expect(pa_vi).toContain('+10')
  expect(pa_vi).toContain('Vitality')
  expect(ba_do).toContain('+1')
  expect(ba_do).toContain('Raw Damage')
})
