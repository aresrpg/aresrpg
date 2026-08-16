// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { CANVAS_OVERLAY_CLASS, WORLD_FRAME_LAYER, world_frame_visibility } from '../../src/components/app_layout.ts'

describe('app layout', () => {
  test('keeps the persistent world at the base layer', () => {
    expect(WORLD_FRAME_LAYER).toBe('z-0')
  })

  test('shows the persistent canvas only on the world page', () => {
    expect(world_frame_visibility('world')).toContain('visible')
    expect(world_frame_visibility('encyclopedia')).toContain('invisible')
    expect(world_frame_visibility('characters')).toContain('invisible')
  })

  test('canvas overlays inherit one padded frame', () => {
    expect(CANVAS_OVERLAY_CLASS).toContain('absolute inset-0')
    expect(CANVAS_OVERLAY_CLASS).toContain('p-4')
  })
})
