// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

test('protector detail retains icon stats, horizontal spell tabs, and its resource world', async () => {
  const { MobsTab } = await import('../../src/encyclopedia/MobsTab.tsx')
  const html = renderToStaticMarkup(
    <MobsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      selected_id="protector_aloe_gaia"
      select_world={() => undefined}
      text={(key) => key}
    />
  )

  for (const stat of ['hp', 'ap', 'mp', 'agility', 'wisdom', 'xp'])
    expect(html).toContain(`data-mob-stat-icon="${stat}"`)
  expect(html).toContain('data-mob-spell-tabs=""')
  expect(html).toContain('role="tablist"')
  expect(html).toContain('Shed Spores')
  expect(html).toContain('Spore Glyph')
  expect(html).toContain('Venom Touch')
  expect(html).toContain('data-mob-loot-progress=""')
  expect(html).toContain('data-encyclopedia-item-icon=')
  expect(html).toContain('data-mob-found-in=""')
  expect(html).not.toContain('data-spell-art=""')
  expect(html.indexOf('gameplay.section_loot')).toBeLessThan(html.indexOf('found_in'))
  expect(html.indexOf('found_in')).toBeLessThan(html.indexOf('mob_spells'))
  expect(html.match(/data-facet-rail=""/g)).toHaveLength(1)
  expect(html).toContain('data-facet-option="world:nauvis"')
  expect(html).toContain('data-facet-option="biome:nauvis:plains"')
  expect(html).toContain('data-facet-option="family:fuwa"')
  expect(html).toContain('data-facet-option="element:earth"')
  expect(html).not.toContain('<select data-mob-filter')
})

test('a city-dungeon mob is found in its owning world', async () => {
  const { MobsTab } = await import('../../src/encyclopedia/MobsTab.tsx')
  const html = renderToStaticMarkup(
    <MobsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      selected_id="golden_lorito"
      select_world={() => undefined}
      text={(key) => key}
    />
  )

  expect(html).toContain('data-mob-found-in=""')
  expect(html).toContain('Nauvis')
})
