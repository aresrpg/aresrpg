// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { hud_key_action } from '../../src/game/core/hud_input.ts'

test('Escape belongs to an open modal first; otherwise it requests the exit confirmation', () => {
  expect(hud_key_action({ code: 'Escape', blocked: true, panel: true, fighting: false })).toBeNull()
  expect(hud_key_action({ code: 'Escape', blocked: false, panel: false, fighting: false })).toBe('leave')
})
test('inventory toggles with E and cannot open over combat or another dialog', () => {
  expect(hud_key_action({ code: 'KeyE', blocked: false, panel: false, fighting: false })).toBe('inventory')
  expect(hud_key_action({ code: 'KeyE', blocked: true, panel: true, fighting: false })).toBe('close')
  expect(hud_key_action({ code: 'KeyE', blocked: false, panel: false, fighting: true })).toBeNull()
  expect(hud_key_action({ code: 'KeyF', blocked: false, panel: false, fighting: false })).toBeNull()
})
