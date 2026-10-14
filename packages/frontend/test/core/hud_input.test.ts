// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { hud_key_action } from '../../src/game/core/hud_input.ts'

test('Escape belongs to an open modal first; otherwise it requests the exit confirmation', () => {
  expect(hud_key_action({ code: 'Escape', blocked: true, panel: 'equipment', fighting: false })).toBeNull()
  expect(hud_key_action({ code: 'Escape', blocked: false, panel: null, fighting: false })).toBe('leave')
})
test('inventory toggles with E and cannot open over combat or another dialog', () => {
  expect(hud_key_action({ code: 'KeyE', blocked: false, panel: null, fighting: false })).toBe('inventory')
  expect(hud_key_action({ code: 'KeyE', blocked: true, panel: 'equipment', fighting: false })).toBe('close')
  expect(hud_key_action({ code: 'KeyE', blocked: false, panel: null, fighting: true })).toBeNull()
  expect(hud_key_action({ code: 'KeyF', blocked: false, panel: null, fighting: false })).toBeNull()
})

test('J toggles Jobs while respecting combat and other modal owners', () => {
  expect(hud_key_action({ code: 'KeyJ', blocked: false, panel: null, fighting: false })).toBe('jobs')
  expect(hud_key_action({ code: 'KeyJ', blocked: true, panel: 'jobs', fighting: false })).toBe('close')
  expect(hud_key_action({ code: 'KeyJ', blocked: true, panel: 'spells', fighting: false })).toBeNull()
  expect(hud_key_action({ code: 'KeyJ', blocked: true, panel: null, fighting: false })).toBeNull()
  expect(hud_key_action({ code: 'KeyJ', blocked: false, panel: null, fighting: true })).toBeNull()
})
