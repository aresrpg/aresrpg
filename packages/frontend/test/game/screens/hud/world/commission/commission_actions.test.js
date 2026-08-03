// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { artisans_from_rows } from '../../../../../../src/game/screens/hud/world/commission/commission_actions.js'

test('an artisan without an indexed name uses the canonical short-id fallback', () => {
  const address = '0x1234567890abcdef1234567890'
  expect(artisans_from_rows([{ address }])).toEqual([
    { address, name: `${address.slice(0, 7)}…${address.slice(-5)}`, jobs: {} },
  ])
})
