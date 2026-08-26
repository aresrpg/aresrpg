// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  CANVAS_OVERLAY_CLASS,
  fight_lab_surface,
  fight_surface_visible,
  WORLD_FRAME_LAYER,
  world_frame_visibility,
} from '../../src/components/app_layout.ts'

describe('app layout', () => {
  test('keeps the persistent world at the base layer', () => {
    expect(WORLD_FRAME_LAYER).toBe('z-0')
  })

  test('shows the persistent canvas on the world and for a Kolizeum fight takeover', () => {
    expect(world_frame_visibility('world')).toContain('visible')
    expect(world_frame_visibility('encyclopedia')).toContain('invisible')
    expect(world_frame_visibility('characters')).toContain('invisible')
    expect(world_frame_visibility('kolizeum', false)).toContain('invisible')
    expect(world_frame_visibility('kolizeum', true)).toContain('visible')
  })

  test('a hydrated fight renders on the world or Kolizeum route', () => {
    expect(fight_surface_visible('world', true)).toBeTrue()
    expect(fight_surface_visible('characters', true)).toBeFalse()
    expect(fight_surface_visible('kolizeum', true)).toBeTrue()
    expect(fight_surface_visible('world', false)).toBeFalse()
  })

  test('the fight lab mounts exactly one canvas surface across the fight lifecycle', () => {
    expect(fight_lab_surface(false)).toBe('setup')
    expect(fight_lab_surface(true)).toBe('fight')
  })

  test('canvas overlays inherit one padded frame', () => {
    expect(CANVAS_OVERLAY_CLASS).toContain('absolute inset-0')
    expect(CANVAS_OVERLAY_CLASS).toContain('p-4')
  })
})
