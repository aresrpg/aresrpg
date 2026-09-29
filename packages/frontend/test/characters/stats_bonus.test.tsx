// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { item_stat_center } from '@aresrpg/immutable'

import StatsTab from '../../src/characters/StatsTab.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { character } from '../modules/automation_fixture.ts'
import { render_english } from '../i18n/render.ts'

test('characteristics show base values followed by signed equipment bonuses, without double counting', async () => {
  const copy = await load_app_copy('en')
  const html = render_english(
    <StatsTab
      copy={copy}
      character={{
        ...character(),
        strength: 100,
        wisdom: 30,
        folded_stats: { strength: item_stat_center + 57, wisdom: item_stat_center - 8 },
      }}
    />
  )
  const value = (stat: string) =>
    new RegExp(`data-stat="${stat}"[\\s\\S]*?class="aui-attribute-value">([\\s\\S]*?)</strong>`)
      .exec(html)?.[1]
      ?.replace(/<[^>]+>/g, '')
  expect(value('strength')).toBe('100 (+57)')
  expect(value('wisdom')).toBe('30 (-8)')
  expect(value('agility')).toBe('0')
})
