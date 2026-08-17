// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { Group, Scene, Sprite, Vector3 } from 'three'

import { create_transient_effects, type EffectAnchors } from '../src/transient_effects.ts'
import { fight_vfx_magnitude } from '../src/fight_vfx_presets.ts'
import type { FightPresentationCue } from '../src/types.ts'

const anchors = Object.freeze({
  world_anchor: (id: string) => (id === 'caster' ? new Vector3(0, 2, 0) : null),
  cell_anchor: (cell: number) => (cell === 12 ? new Vector3(4, 1.2, 0) : null),
}) satisfies EffectAnchors

const cast = (element: string): Extract<FightPresentationCue, Readonly<{ type: 'cast' }>> =>
  Object.freeze({
    id: `cast:${element}`,
    type: 'cast',
    caster_id: 'caster',
    spell: 'Test',
    cast_level: 1,
    target_cell: 12,
    element,
    placement: null,
    critical: false,
    weapon: false,
    amount: 40,
    target_max_hp: 100,
    affected_cells: Object.freeze([12]),
    killed: false,
  })

describe('transient effects', () => {
  test('scales effect magnitude within authored bounds', () => {
    expect(fight_vfx_magnitude(0, null)).toBe(0.85)
    expect(fight_vfx_magnitude(10_000, 1)).toBe(1.6)
    expect(fight_vfx_magnitude(40, 100)).toBeGreaterThan(fight_vfx_magnitude(4, 100))
  })

  test('exposes one disposable warmup object for both fight shader pipelines', () => {
    const scene = new Scene()
    const vfx = create_transient_effects({ scene, entities: anchors })
    const warmup = vfx.create_warmup()

    expect(warmup.object.children).toHaveLength(2)
    warmup.dispose()
    vfx.dispose()
  })

  test('plays the retained earth burst when a trap triggers', () => {
    const scene = new Scene()
    const vfx = create_transient_effects({ scene, entities: anchors })

    expect(
      vfx.play_zone({
        id: 'trap:1',
        type: 'zone',
        action: 'trap_triggered',
        zone_id: 'zone:1',
        owner_id: 'caster',
        target_id: 'target',
        cell: 12,
        element: 'water',
      })
    ).toBeTrue()
    expect(scene.children).not.toHaveLength(0)
    vfx.dispose()
  })

  test('resolves a cast at impact with a bounded number of drawables', async () => {
    const scene = new Scene()
    const vfx = create_transient_effects({ scene, entities: anchors })
    vfx.tick(100)
    const played = vfx.play_cast(cast('fire'))

    expect(scene.children).toHaveLength(4)
    vfx.tick(650)
    expect(await played).toBeTrue()
    expect(scene.children).toHaveLength(3)

    vfx.dispose()
    expect(scene.children).toHaveLength(0)
  })

  test('resolves delayed authored bursts and cancels pending casts on disposal', async () => {
    const scene = new Scene()
    const vfx = create_transient_effects({ scene, entities: anchors })
    vfx.tick(100)
    const earth = vfx.play_cast(cast('earth'))
    expect(scene.children).toHaveLength(0)
    vfx.tick(650)
    expect(await earth).toBeTrue()

    const pending = vfx.play_cast(cast('water'))
    vfx.dispose()
    expect(await pending).toBeFalse()
    expect(scene.children).toHaveLength(0)
  })

  test('plays the legacy double-jump dust and ring as one bounded effect', () => {
    const scene = new Scene()
    const vfx = create_transient_effects({ scene, entities: anchors })
    vfx.tick(100)

    vfx.play_jump_puff(Object.freeze([2, 3, 4]))
    expect(scene.children).toHaveLength(2)
    const smoke = scene.children.find((child): child is Group => child instanceof Group)
    expect(smoke?.children).toHaveLength(14)
    expect(smoke?.children.every((child) => child instanceof Sprite)).toBeTrue()
    vfx.tick(651)
    expect(scene.children).toHaveLength(0)

    vfx.dispose()
  })
})
