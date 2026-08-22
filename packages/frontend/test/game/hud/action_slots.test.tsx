// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ActionSlots, empty_action_slot_count } from '../../../src/game/hud/ActionSlots.tsx'

test('the HUD reserves its configured fixed action grid', () => {
  const html = renderToStaticMarkup(
    <ActionSlots capacity={20} columns={10}>
      <button type="button">ONE</button>
      <button type="button">TWO</button>
      <button type="button">THREE</button>
    </ActionSlots>
  )

  expect(html).toContain('grid-template-columns:repeat(10, 50px)')
  expect(empty_action_slot_count(20, 3)).toBe(17)
  expect(html.match(/data-empty-action-cell=/g)).toHaveLength(17)
})
