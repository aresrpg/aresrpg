// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('../../src/content/assets.ts', () => ({
  item_icon: (id: string) => `/items/${id}.webp`,
  mob_icon: (id: string) => `/mobs/${id}.webp`,
  spell_icon: () => null,
}))

test('mob detail retains icon stats, horizontal spell tabs, loot odds, and world rows', async () => {
  const { MobsTab } = await import('../../src/encyclopedia/MobsTab.tsx')
  const html = renderToStaticMarkup(
    <MobsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      selected_id="wooligan"
      select_world={() => undefined}
      text={(key) => key}
    />
  )

  for (const stat of ['hp', 'ap', 'mp', 'agility', 'wisdom', 'xp'])
    expect(html).toContain(`data-mob-stat-icon="${stat}"`)
  expect(html).toContain('data-mob-spell-tabs=""')
  expect(html).toContain('role="tablist"')
  expect(html).toContain('Head Butt')
  expect(html).toContain('Bull Rush')
  expect(html).toContain('data-mob-loot-progress=""')
  expect(html).toContain('data-mob-found-in=""')
})
