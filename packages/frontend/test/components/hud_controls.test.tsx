// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FpsPanel } from '../../src/components/FpsPanel.tsx'

const copy = {
  quality: 'Quality',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  flat_mode: 'Flat',
  world_hud: { dungeon_public: 'Public', dungeon_group: 'Party' },
} as never

test('the rounded FPS card owns the persistent public/party fight toggle', () => {
  const html = renderToStaticMarkup(
    <FpsPanel
      active={false}
      change_quality={() => undefined}
      copy={copy}
      fight_access={1}
      flatten_locked
      flattened
      party_available
      quality="medium"
      toggle_fight_access={() => undefined}
      toggle_flattened={() => undefined}
    />
  )
  expect(html).toContain('data-fight-access=""')
  expect(html).toContain('Party')
  expect(html).toContain('rounded-[9px]')
  expect(html).toContain('w-6 text-right')
  expect(html).toContain('data-flat-locked="true"')
  expect(html).toContain('disabled=""')
})
