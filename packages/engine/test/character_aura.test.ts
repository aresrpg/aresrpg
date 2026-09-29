// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { PerspectiveCamera, Scene, Vector3 } from 'three'

import { advance_aura_trail, AURA_TRAIL_LIMIT } from '../src/character_aura_motion.ts'
import { create_character_aura_layer } from '../src/character_aura_layer.ts'
import { is_character_crowd_spec } from '../src/character_crowd.ts'
import type { CharacterEntityRender } from '../src/types.ts'

const spec: CharacterEntityRender = {
  id: 'player',
  kind: 'character',
  aura: 'unbroken',
  presentation: 'crowd',
  appearance: { body_url: null, hair_url: null, colors: ['#fff', '#fff', '#fff'], worn: { head: null, back: null } },
  anchor: { kind: 'world', position: [0, 0, 0] },
  facing: { kind: 'yaw', yaw: 0 },
}

test('trail emission follows travelled distance; idle, replay and teleport never create bursts', () => {
  const first = advance_aura_trail(undefined, [0, 0, 0], 0, 1)
  const idle = advance_aura_trail(first, [0, 0, 0], 16, 1)
  expect(idle.particles).toHaveLength(0)
  const moved = advance_aura_trail(idle, [1, 0, 0], 32, 1)
  expect(moved.particles.length).toBeGreaterThan(0)
  expect(moved.particles.every(({ position }) => position[0] > 0 && position[0] < 1)).toBe(true)
  expect(advance_aura_trail(moved, [1, 0, 0], 32, 1).particles).toEqual(moved.particles)
  expect(advance_aura_trail(moved, [100, 0, 0], 48, 1).particles).toHaveLength(0)
  expect(advance_aura_trail(moved, [1, 0, 0], 1000, 1).particles).toHaveLength(0)
})

test('one layer serves crowds and animated fight anchors, and hides invisible or removed actors', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  camera.position.set(0, 2, 5)
  const crown = new Vector3(0, 1.4, 0)
  const layer = create_character_aura_layer(
    scene,
    camera,
    {
      world_anchor: () => crown,
      entity_height: (id) => (id === 'fighter' ? 1.4 : 2),
    },
    'high'
  )
  expect(is_character_crowd_spec(spec)).toBe(true)
  const fighter: CharacterEntityRender = {
    ...spec,
    id: 'fighter',
    anchor: { kind: 'fight_cell', cell: 1 },
    presentation: 'individual',
  }
  layer.set([spec, fighter])
  layer.tick(0)
  expect(layer.stats()).toEqual({ auras: 2, particles: 0, tracked: 2, haze: 0 })
  crown.x = 1
  layer.tick(16)
  expect(layer.stats().particles).toBeGreaterThan(0)
  layer.set([{ ...fighter, visual_effect: { kind: 'invisibility' } }])
  layer.tick(32)
  expect(layer.stats()).toEqual({ auras: 0, particles: 0, tracked: 0, haze: 0 })
  layer.set([spec])
  layer.tick(48)
  layer.set([{ ...spec, aura: undefined }])
  layer.tick(64)
  expect(layer.stats().auras).toBe(0)
  layer.dispose()
  expect(scene.children).toHaveLength(0)
})

test('crowds share two batches and trail particles stay bounded under movement and quality changes', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const layer = create_character_aura_layer(scene, camera, { world_anchor: () => null, entity_height: () => 2 }, 'high')
  for (let frame = 0; frame < 60; frame++) {
    layer.set(
      Array.from({ length: 100 }, (_, i) => ({
        ...spec,
        id: String(i),
        anchor: { kind: 'world', position: [frame * 0.1, 0, i * 0.1] },
      }))
    )
    layer.tick(frame * 16)
  }
  expect(scene.children.filter(({ visible }) => visible)).toHaveLength(2)
  expect(layer.stats().auras).toBe(100)
  expect(layer.stats().particles).toBeLessThanOrEqual(100 * AURA_TRAIL_LIMIT)
  layer.set_quality('low')
  layer.tick(60 * 16)
  expect(layer.stats().particles).toBeLessThanOrEqual(400)
  camera.position.set(500, 500, 500)
  layer.tick(61 * 16)
  expect(layer.stats()).toEqual({ auras: 0, particles: 0, tracked: 0, haze: 0 })
  layer.dispose()
})

test('large worn cosmetics do not enlarge the aura compared with a crowded player', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const layer = create_character_aura_layer(scene, camera, { world_anchor: () => null, entity_height: () => 4 }, 'high')
  layer.set([spec])
  layer.tick(0)
  const shell = scene.getObjectByName('character-aura:shell') as import('three').Mesh
  expect(shell.geometry.getAttribute('aura_size').getX(0)).toBe(2)
  layer.dispose()
})

test('admin haze shares the bounded layer and retires independently of a nearby Unbroken aura', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const layer = create_character_aura_layer(scene, camera, { world_anchor: () => null, entity_height: () => 2 }, 'high')
  layer.set([spec, { ...spec, id: 'admin', aura: 'admin' }])
  layer.tick(0)
  expect(layer.stats()).toEqual({ auras: 2, particles: 0, tracked: 2, haze: 1 })
  layer.set([spec])
  layer.tick(16)
  expect(layer.stats()).toEqual({ auras: 1, particles: 0, tracked: 1, haze: 0 })
  expect(scene.getObjectByName('character-aura:haze')!.visible).toBe(false)
  layer.dispose()
  expect(scene.children).toHaveLength(0)
})
