// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('../../src/content/assets.ts', () => ({
  item_icon: (id: string) => `/items/${id}.webp`,
  mob_icon: (id: string) => `/mobs/${id}.webp`,
}))
mock.module('../../src/content/catalog.ts', () => ({
  encyclopedia_catalog: {
    items: [
      { item_type: 'wheat', name: 'Wheat', category: 'resource', level: 1 },
      { item_type: 'golden_wheat', name: 'Golden Wheat', category: 'resource', level: 10 },
    ],
    mobs: [
      { mob_type: 'ant_red', name: 'Red Ant', role: 'normal', element: 'fire', level_min: 1, level_max: 1 },
      {
        mob_type: 'protector_wheat',
        name: 'Wheat Protector',
        role: 'protector',
        element: 'earth',
        level_min: 1,
        level_max: 10,
      },
    ],
  },
  titleize: (value: string) => value.replaceAll('_', ' '),
}))

const { PopulationEditor } = await import('../../src/editor/PopulationEditor.tsx')
const { SplineEditor } = await import('../../src/editor/BiomeControls.tsx')

test('population is a compact searchable assignment sheet', () => {
  const html = renderToStaticMarkup(
    <PopulationEditor
      biome_names={['plains', 'forest']}
      change={() => undefined}
      world={{
        mobs: [{ mob_type: 'ant_red', weight_bp: 1_000, biomes: ['plains'] }],
        resources: [
          {
            item_type: 'wheat',
            biomes: ['plains', 'forest'],
          },
        ],
      }}
    />
  )

  expect(html).toContain('data-population-editor=""')
  expect(html).toContain('data-population-row="mob"')
  expect(html).toContain('data-population-row="resource"')
  expect(html).toContain('data-population-placeholder="mob"')
  expect(html).toContain('data-population-placeholder="resource"')
  expect(html).toContain('data-mob-reference-picker="world mob"')
  expect(html).toContain('data-item-reference-picker="world resource"')
  expect(html).toContain('aria-label="Edit Weight"')
  expect(html).toContain('aria-label="Remove mob"')
  expect(html).toContain('aria-label="Remove resource"')
  expect(html).toContain('FARMER · T1')
  expect(html).not.toContain('aria-label="Resource job"')
  expect(html).not.toContain('aria-label="Edit Tier"')
  expect(html).not.toContain('data-mob-reference-picker="resource protector"')
  expect(html).not.toContain('data-item-reference-picker="rare resource"')
  expect(html).not.toContain('>Remove<')
})

test('landscape spline fills its panel with a 0-bottom to 384-top plot', () => {
  const html = renderToStaticMarkup(
    <SplineEditor
      change={() => undefined}
      fill
      knots={[
        [0, 0],
        [1, 383],
      ]}
      name="landscape"
      x_domain={[0, 1]}
      y_domain={[0, 384]}
      y_value_domain={[0, 383]}
    />
  )

  expect(html).toContain('min-h-40 flex-1')
  expect(html).toContain('Elevation 0–384')
  expect(html).toContain('>384</text>')
  expect(html).toContain('>0</text>')
})
