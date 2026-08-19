// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ItemDetailView, item_stat_display_range, item_stat_rows } from '../../src/components/ItemDetailView.tsx'

const labels = Object.freeze({
  characteristics: 'Characteristics',
  damages: 'damages',
  level_short: 'Lv. 80',
  range_to: 'to',
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
    icon: null,
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
  expect(editable).toContain('data-item-inline-edit="Vitality"')
  expect(editable).toContain('data-item-stat="wisdom"')
  expect(readonly).not.toContain('data-item-detail-editable=""')
  expect(readonly).not.toContain('data-item-stat="wisdom"')
})
