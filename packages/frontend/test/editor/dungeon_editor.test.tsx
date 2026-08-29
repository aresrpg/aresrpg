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
    items: [{ item_type: 'dungeon_key', name: 'Dungeon Key', category: 'key', level: 1 }],
    worlds: [],
    mobs: [
      { mob_type: 'ant', name: 'Ant', role: 'normal', element: 'earth', level_min: 10, level_max: 20 },
      { mob_type: 'boss', name: 'Boss', role: 'boss', element: 'fire', level_min: 20, level_max: 30 },
    ],
  },
  titleize: (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
}))

const { DungeonEditor } = await import('../../src/editor/DungeonEditor.tsx')

test('a world dungeon is an ordered room composition sheet', () => {
  const html = renderToStaticMarkup(
    <DungeonEditor
      change={() => undefined}
      world={{
        dungeon: {
          key: 'dungeon_key',
          rooms: [[{ mob_type: 'ant' }], [{ mob_type: 'boss' }]],
        },
      }}
    />
  )

  expect(html).toContain('data-dungeon-editor=""')
  expect(html).toContain('data-dungeon-room="1"')
  expect(html).toContain('data-dungeon-room="2"')
  expect(html).toContain('data-dungeon-member=""')
  expect(html).toContain('data-dungeon-placeholder="room"')
  expect(html).toContain('data-dungeon-placeholder="member"')
  expect(html).toContain('data-item-reference-picker="dungeon key"')
  expect(html).toContain('data-mob-reference-picker="room mob"')
  expect(html).toContain('Random Lv. 10–20')
  expect(html).toContain('Random Lv. 20–30')
  expect(html).not.toContain('Edit room mob level')
  expect(html).not.toContain('level_scalar')
})
