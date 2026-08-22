// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MinimapReadout } from '../../../src/game/hud/Minimap.tsx'

test('shows the biome left of the coordinate chips', () => {
  const html = renderToStaticMarkup(
    <MinimapReadout
      biome_label="Biome"
      biome_name="Shore Plains"
      coordinates={{ x: -210, y: 85, z: 139 }}
      coordinates_label="Coordinates"
    />
  )

  expect(html).toContain('aria-label="Biome"')
  expect(html).toContain('Shore Plains')
  expect(html).toContain('aria-label="Coordinates"')
  expect(html.indexOf('Shore Plains')).toBeLessThan(html.indexOf('aria-label="Coordinates"'))
})
