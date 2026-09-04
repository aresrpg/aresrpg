// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MinimapReadout, toggles_world_map } from '../../../src/game/hud/Minimap.tsx'

test('M toggles the world map unless the player is typing', () => {
  expect(toggles_world_map({ code: 'KeyM', repeat: false, target: null })).toBeTrue()
  expect(toggles_world_map({ code: 'KeyM', repeat: true, target: null })).toBeFalse()
  expect(toggles_world_map({ code: 'KeyM', repeat: false, target: { tagName: 'INPUT' } as never })).toBeFalse()
  expect(toggles_world_map({ code: 'KeyN', repeat: false, target: null })).toBeFalse()
})

test('shows the biome left of the coordinate chips', () => {
  const html = renderToStaticMarkup(
    <MinimapReadout
      city={false}
      coordinates={{ x: -210, y: 85, z: 139 }}
      coordinates_label="Coordinates"
      location_label="Biome"
      location_name="Shore Plains"
    />
  )

  expect(html).toContain('aria-label="Biome"')
  expect(html).toContain('Shore Plains')
  expect(html).toContain('aria-label="Coordinates"')
  expect(html.indexOf('Shore Plains')).toBeLessThan(html.indexOf('aria-label="Coordinates"'))
})

test('uses the city treatment for an authored city location', () => {
  const html = renderToStaticMarkup(
    <MinimapReadout
      city
      coordinates={{ x: 512, y: 167, z: 0 }}
      coordinates_label="Coordinates"
      location_label="City of Thebes"
      location_name="City of Thebes"
    />
  )

  expect(html).toContain('gw-minimap__biome--city')
  expect(html).toContain('City of Thebes')
})
