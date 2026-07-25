// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAM S4 — the model-miss body. Both halves are provable with no GLB on disk (the reason the policy is a
// pure function and not an inline branch inside board_entities): WHO gets a stand-in, and that the stand-in
// stands on its feet at the group origin, at the height the real avatar would have had.

import { test, expect, describe } from 'bun:test'
import { Box3, Group } from 'three'

import {
  BOARD_PLAYER_HEIGHT,
  MOB_PLACEHOLDER_HEIGHT,
  create_capsule_placeholder,
  dispose_capsule_placeholder,
  placeholder_body_of,
} from './entity_placeholder.js'

describe('the model-miss policy', () => {
  test('a fighter WITH a resolved glb gets no placeholder — the real avatar loads', () => {
    expect(
      placeholder_body_of({ glb_variant: '/models/senshi_male.glb', kind: 'player', outline: 0x5db4ff })
    ).toBeNull()
  })

  test('a model-less PLAYER gets a body at the fight player height, tinted by its team color', () => {
    expect(placeholder_body_of({ kind: 'player', outline: 0x5db4ff })).toEqual({
      height: BOARD_PLAYER_HEIGHT,
      color: 0x5db4ff,
    })
  })

  test('a model-less MOB gets one too — mobs wear no outline shell, but they DO get a body', () => {
    expect(placeholder_body_of({ kind: 'mob', outline: 0xff6b6b })).toEqual({
      height: MOB_PLACEHOLDER_HEIGHT,
      color: 0xff6b6b,
    })
  })

  test('no team color ⇒ a neutral body, never a crash', () => {
    expect(placeholder_body_of({ kind: 'mob' })).toEqual({ height: MOB_PLACEHOLDER_HEIGHT, color: null })
  })
})

describe('the capsule body', () => {
  test('stands on its FEET at the group origin, at the requested height', () => {
    const mesh = create_capsule_placeholder({ height: BOARD_PLAYER_HEIGHT, color: 0x5db4ff })
    const group = new Group()
    group.add(mesh)
    group.updateMatrixWorld(true)
    const box = new Box3().setFromObject(mesh)
    expect(box.min.y).toBeCloseTo(0, 2) // feet on the slab, exactly like a loaded avatar's model
    expect(box.max.y - box.min.y).toBeCloseTo(BOARD_PLAYER_HEIGHT, 2)
    dispose_capsule_placeholder(mesh)
  })

  test('is a CAPSULE (not the old debug cube) and carries the team tint', () => {
    const mesh = create_capsule_placeholder({ height: MOB_PLACEHOLDER_HEIGHT, color: 0xff6b6b })
    expect(mesh.geometry.type).toBe('CapsuleGeometry')
    expect(/** @type {import('three').MeshStandardMaterial} */ (mesh.material).color.getHex()).toBe(0xff6b6b)
    expect(mesh.name).toBe('entity_placeholder')
    dispose_capsule_placeholder(mesh)
  })

  test('disposal unparents it and frees its own buffers (nothing is shared with the avatar tree)', () => {
    const mesh = create_capsule_placeholder({ height: 1.4 })
    const group = new Group()
    group.add(mesh)
    let freed = 0
    const material = /** @type {import('three').MeshStandardMaterial} */ (mesh.material)
    mesh.geometry.addEventListener('dispose', () => (freed += 1))
    material.addEventListener('dispose', () => (freed += 1))
    dispose_capsule_placeholder(mesh)
    expect(mesh.parent).toBeNull()
    expect(freed).toBe(2)
    // idempotent: a second removal (the death belt racing an adapter despawn) must not throw
    expect(() => dispose_capsule_placeholder(null)).not.toThrow()
  })
})
