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
  world_hud: { dungeon_public: 'Public', dungeon_group: 'Party' },
} as never

test('the rounded FPS card owns the persistent public/party fight toggle', () => {
  const html = renderToStaticMarkup(
    <FpsPanel
      active={false}
      change_quality={() => undefined}
      copy={copy}
      fight_access={1}

      party_available
      quality="medium"
      toggle_fight_access={() => undefined}
    />
  )
  expect(html).toContain('data-fight-access=""')
  expect(html).toContain('Party')
  expect(html).toContain('aui-panel aui-performance')
  expect(html).toContain('aui-performance-reading')
  expect(html).not.toContain('data-flat-locked')
})
