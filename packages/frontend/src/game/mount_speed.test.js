// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CF-B (client half) — proves the mount roam-speed SELECTION: a character with a mount equipped scales
// ×1.5, everyone else ×1.0. This is the pure selection the controller's ground-speed knob consumes; the
// engine applies it (controller.js ground_speed). Guards the "only an item-like slot counts" contract so a
// null/absent slot — or a stray scalar named `mount` — never grants the bonus.
import { describe, expect, test } from 'bun:test'

import { mount_speed_multiplier, MOUNT_SPEED_MULTIPLIER } from './mount_speed.js'

describe('mount_speed_multiplier — mount equipped ⇒ ×1.5, else ×1.0', () => {
  test('mount equipped (item-like object with id) → 1.5', () => {
    expect(mount_speed_multiplier({ id: 'c1', mount: { id: 'mount_1', item_type: 'mount' } })).toBe(
      MOUNT_SPEED_MULTIPLIER,
    )
    expect(MOUNT_SPEED_MULTIPLIER).toBe(1.5)
  })

  test('no mount slot / empty slot → 1.0', () => {
    expect(mount_speed_multiplier({ id: 'c1' })).toBe(1)
    expect(mount_speed_multiplier({ id: 'c1', mount: null })).toBe(1)
    expect(mount_speed_multiplier({ id: 'c1', mount: undefined })).toBe(1)
  })

  test('null / partial character → 1.0 (never throws)', () => {
    expect(mount_speed_multiplier(null)).toBe(1)
    expect(mount_speed_multiplier(undefined)).toBe(1)
  })

  test('a non-item value in the slot (scalar / object without id) never grants the bonus', () => {
    expect(mount_speed_multiplier({ id: 'c1', mount: 1 })).toBe(1)
    expect(mount_speed_multiplier({ id: 'c1', mount: 'mount' })).toBe(1)
    expect(mount_speed_multiplier({ id: 'c1', mount: {} })).toBe(1)
  })
})
