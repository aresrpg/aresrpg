// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { party_frame_visible } from '../../src/components/PartyFrame.tsx'

test('owned character candidates do not impersonate a created party', () => {
  expect(party_frame_visible(null, null)).toBeFalse()
  expect(party_frame_visible({ id: '0xp' } as never, null)).toBeTrue()
  expect(party_frame_visible({ id: '0xp' } as never, 'leave')).toBeFalse()
})
