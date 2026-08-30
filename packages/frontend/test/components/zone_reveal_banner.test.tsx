// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppCopy } from '../../src/i18n/copy.ts'
import { ZoneRevealContent } from '../../src/components/ZoneRevealBanner.tsx'

const copy = {
  world_hud: {
    zone_revealed: 'ZONE REVEALED',
    zone_coordinates: 'SECTOR {{zx}} · {{zz}}',
    zone_mobs_found: '{{count}} MOBS FOUND',
    zone_resources_found: '{{count}} RESOURCES FOUND',
    zone_dungeon_spotted: 'DUNGEON SPOTTED',
  },
} as unknown as AppCopy

test('zone discovery restores the center reveal with population findings', () => {
  const reveal = Object.freeze({ id: 'nauvis:97:98:s7', zx: 97, zz: 98, mobs: 3, resources: 9, dungeon: true })
  const html = renderToStaticMarkup(<ZoneRevealContent copy={copy} reveal={reveal} />)

  expect(html).toContain('gw-reveal')
  expect(html).toContain('ZONE REVEALED')
  expect(html).toContain('SECTOR 97 · 98')
  expect(html).toContain('3 MOBS FOUND · 9 RESOURCES FOUND · DUNGEON SPOTTED')
})

test('zone discovery has no generic toast-shaped fallback', () => {
  expect(renderToStaticMarkup(<ZoneRevealContent copy={copy} reveal={null} />)).toBe('')
})
