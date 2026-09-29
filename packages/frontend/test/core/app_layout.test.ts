// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  CANVAS_OVERLAY_CLASS,
  dungeon_lobby_visible,
  fight_lab_surface,
  social_hud_visible,
  WORLD_FRAME_LAYER,
} from '../../src/components/app_layout.ts'

describe('app layout', () => {
  test('keeps the persistent world at the base layer', () => {
    expect(WORLD_FRAME_LAYER).toBe('z-0')
  })

  test('the fight lab mounts exactly one canvas surface across the fight lifecycle', () => {
    expect(fight_lab_surface(false)).toBe('setup')
    expect(fight_lab_surface(true)).toBe('fight')
  })

  test('canvas overlays inherit one padded frame', () => {
    expect(CANVAS_OVERLAY_CLASS).toContain('absolute inset-0')
    expect(CANVAS_OVERLAY_CLASS).toContain('p-4')
  })

  test('social HUD hides only behind the expedition lobby and returns during its fights', () => {
    expect(dungeon_lobby_visible('world', false, true)).toBeTrue()
    expect(social_hud_visible('world', false, true)).toBeFalse()
    expect(social_hud_visible('world', true, true)).toBeTrue()
    expect(social_hud_visible('world', true, false)).toBeTrue()
    expect(social_hud_visible('characters', false, false)).toBeFalse()
  })
})
