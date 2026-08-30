// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const { DungeonEditor } = await import('../../src/editor/DungeonEditor.tsx')

test('a world dungeon is an ordered room composition sheet', () => {
  const html = renderToStaticMarkup(
    <DungeonEditor
      change={() => undefined}
      world={{
        dungeon: {
          key: 'key_of_tangled_aftermath',
          rooms: [[{ mob_type: 'ant_red' }], [{ mob_type: 'araknomath' }]],
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
  expect(html).toContain('Random Lv. 12–28')
  expect(html).toContain('Random Lv. 25–30')
  expect(html).not.toContain('Edit room mob level')
  expect(html).not.toContain('level_scalar')
})
