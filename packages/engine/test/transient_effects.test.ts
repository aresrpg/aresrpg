// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { Group, Mesh, Scene, Sprite, SpriteMaterial, Vector3 } from 'three'

import { create_transient_effects, type EffectAnchors } from '../src/transient_effects.ts'
import { fight_vfx_magnitude } from '../src/fight_vfx_presets.ts'
import type { FightCastStyle, FightPresentationCue } from '../src/types.ts'

const anchors = Object.freeze({
  world_anchor: (id: string) => (id === 'caster' ? new Vector3(0, 2, 0) : null),
  cell_anchor: (cell: number) => (cell === 12 ? new Vector3(4, 1.2, 0) : null),
}) satisfies EffectAnchors

const cast = (
  element: string,
  style: FightCastStyle = 'damage'
): Extract<FightPresentationCue, Readonly<{ type: 'cast' }>> =>
  Object.freeze({
    id: `cast:${element}`,
    type: 'cast',
    caster_id: 'caster',
    self_cast: false,
    spell: 'Test',
    cast_level: 1,
    target_cell: 12,
    element,
    style,
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

  test('holds a triggered trap beat before movement can resume', async () => {
    const scene = new Scene()
    const vfx = create_transient_effects({ scene, entities: anchors })
    vfx.tick(100)

    const played = vfx.play_zone({
      id: 'trap:1',
      type: 'zone',
      action: 'trap_triggered',
      zone_id: 'zone:1',
      owner_id: 'caster',
      target_id: 'target',
      cell: 12,
      element: 'water',
    })
    let resolved = false
    void played.then(() => {
      resolved = true
    })
    expect(scene.children).not.toHaveLength(0)
    vfx.tick(749)
    await Promise.resolve()
    expect(resolved).toBeFalse()
    vfx.tick(750)
    expect(await played).toBeTrue()
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
    const earth = vfx.play_cast(cast('weapon'))
    expect(scene.children).toHaveLength(0)
    vfx.tick(650)
    expect(await earth).toBeTrue()

    const pending = vfx.play_cast(cast('water'))
    vfx.dispose()
    expect(await pending).toBeFalse()
    expect(scene.children).toHaveLength(0)
  })

  test('every authored element renders cast, falling projectile, and impact with its own silhouette', async () => {
    const silhouettes: string[] = []
    for (const element of ['fire', 'water', 'air', 'neutral', 'heal', 'earth']) {
      const scene = new Scene()
      const vfx = create_transient_effects({ scene, entities: anchors })
      vfx.tick(100)
      const played = vfx.play_cast(cast(element))
      expect(scene.getObjectByName(`cast:${element}:windup`)).toBeDefined()
      const projectile = scene.getObjectByName(`cast:${element}:projectile`)
      expect(projectile).toBeDefined()
      if (projectile instanceof Mesh) silhouettes.push(projectile.geometry.type)
      vfx.tick(650)
      expect(await played).toBeTrue()
      expect(scene.getObjectByName(`cast:${element}:impact`)).toBeDefined()
      vfx.dispose()
    }
    expect(new Set(silhouettes).size).toBe(6)
  })

  test('spell mechanics select different pack silhouettes without changing their element palette', () => {
    const scene = new Scene()
    const vfx = create_transient_effects({ scene, entities: anchors })
    vfx.tick(100)

    void vfx.play_cast(cast('fire', 'damage'))
    void vfx.play_cast(Object.freeze({ ...cast('fire', 'push'), id: 'cast:fire:push' }))
    void vfx.play_cast(Object.freeze({ ...cast('fire', 'trap'), id: 'cast:fire:trap' }))

    const geometry = (name: string): string | null => {
      const object = scene.getObjectByName(name)
      return object instanceof Mesh ? object.geometry.type : null
    }
    expect(geometry('cast:fire:projectile')).toBe('ConeGeometry')
    expect(geometry('cast:fire:push:projectile')).toBe('BoxGeometry')
    expect(geometry('cast:fire:trap:projectile')).toBe('DodecahedronGeometry')
    vfx.dispose()
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
    expect(
      smoke?.children.every((child) => child instanceof Sprite && child.material instanceof SpriteMaterial)
    ).toBeTrue()
    vfx.tick(651)
    expect(scene.children).toHaveLength(0)

    vfx.dispose()
  })
})
