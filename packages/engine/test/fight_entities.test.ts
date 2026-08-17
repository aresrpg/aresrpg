// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene } from 'three'

import {
  create_entity_layer,
  fight_flash_envelope,
  fight_gait_cell_ms,
  fight_path_gait,
  fight_reaction_envelope,
  resolve_entity_locomotion_clip,
} from '../src/entities.ts'

const board = Object.freeze({
  width: 2,
  height: 1,
  cell_size: 2,
  origin: Object.freeze({ x: -2, y: 4, z: -1 }),
  cells: Object.freeze([
    Object.freeze({ cell: 10, x: 0, y: 0, kind: 'start_a' as const }),
    Object.freeze({ cell: 11, x: 1, y: 0, kind: 'start_b' as const }),
  ]),
})

describe('fight entity rendering', () => {
  test('prefers the requested locomotion clip over an earlier compound jump clip', () => {
    const clips = Object.freeze([
      new AnimationClip('JUMP_RUN', 1),
      new AnimationClip('RUN', 1),
      new AnimationClip('Armature|WALK', 1),
    ])

    expect(resolve_entity_locomotion_clip(clips, 'RUN')?.name).toBe('RUN')
    expect(resolve_entity_locomotion_clip(clips, 'WALK')?.name).toBe('Armature|WALK')
  })

  test('uses the legacy path-length gait boundary and pace', () => {
    expect([1, 2, 3, 4].map(fight_path_gait)).toEqual(['walk', 'walk', 'run', 'run'])
    expect(fight_gait_cell_ms('walk')).toBe(480)
    expect(fight_gait_cell_ms('run')).toBe(170)
  })

  test('retains the exact legacy hit reaction and flash timing envelopes', () => {
    expect(fight_reaction_envelope(0)).toBe(0)
    expect(fight_reaction_envelope(0.32)).toBe(1)
    expect(fight_reaction_envelope(1)).toBe(0)
    expect(fight_flash_envelope(0.15)).toBe(1)
    expect(fight_flash_envelope(0.4)).toBe(0)
  })

  test('plays a procedural hit before restoring the fighter to its exact cell anchor', async () => {
    const scene = new Scene()
    const root = new Group()
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
    })
    const fighter = Object.freeze({
      id: 'mob_10',
      kind: 'mob' as const,
      model_url: '/bunny.glb',
      anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
    })
    layer.set_board(board)
    layer.set([fighter])
    await Promise.resolve()
    await Promise.resolve()
    const rest = root.position.clone()

    const hit = layer.beat(fighter.id, 'hit', undefined, true)
    layer.tick(performance.now() + 96)
    expect(root.position.distanceTo(rest)).toBeGreaterThan(0.1)
    expect(root.scale.y).toBeLessThan(1)
    layer.tick(Number.MAX_SAFE_INTEGER)

    expect(await hit).toBeTrue()
    expect(root.position.toArray()).toEqual(rest.toArray())
    expect(root.scale.toArray()).toEqual([1, 1, 1])
    layer.dispose()
  })

  test('does not resurrect a completed death when the board checkpoint refreshes', async () => {
    const scene = new Scene()
    const root = new Group()
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
    })
    const fighter = Object.freeze({
      id: 'mob_10',
      kind: 'mob' as const,
      model_url: '/bunny.glb',
      anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
    })
    layer.set_board(board)
    layer.set([fighter])
    await Promise.resolve()
    await Promise.resolve()

    const death = layer.beat(fighter.id, 'death')
    layer.tick(Number.MAX_SAFE_INTEGER)
    expect(await death).toBeTrue()
    expect(root.visible).toBeFalse()
    layer.set_board(board)
    expect(root.visible).toBeFalse()
    layer.dispose()
  })

  test('faces a placed character toward the opposing starting band centroid', async () => {
    const scene = new Scene()
    const root = new Group()
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
    })
    layer.set_board(
      Object.freeze({
        width: 4,
        height: 2,
        cell_size: 1,
        origin: Object.freeze({ x: 0, y: 0, z: 0 }),
        cells: Object.freeze([
          Object.freeze({ cell: 20, x: 0, y: 0, kind: 'start_a' as const }),
          Object.freeze({ cell: 21, x: 1, y: 1, kind: 'start_b' as const }),
          Object.freeze({ cell: 22, x: 3, y: 1, kind: 'start_b' as const }),
        ]),
      })
    )
    layer.set([
      Object.freeze({
        id: 'character_20',
        kind: 'character' as const,
        appearance: Object.freeze({
          body_url: '/senshi.glb',
          hair_url: null,
          colors: Object.freeze(['#000000', '#000000', '#000000'] as const),
          worn: Object.freeze({ head: null, back: null }),
        }),
        anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 20 }),
        facing: Object.freeze({ kind: 'fight_opponents' as const, side: 'a' as const }),
      }),
    ])
    await Promise.resolve()
    await Promise.resolve()

    expect(root.rotation.y).toBeCloseTo(Math.atan2(2, 1))
    layer.dispose()
  })

  test('loads a mob through the shared model door and seats it on its board cell', async () => {
    const scene = new Scene()
    const root = new Group()
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: -0.25, dispose: () => {} }),
    })

    layer.set_board(board)
    layer.set([
      Object.freeze({
        id: 'mob_10',
        kind: 'mob' as const,
        model_url: '/bunny.glb',
        anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
        facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
      }),
    ])
    await Promise.resolve()
    await Promise.resolve()

    expect(root.position.toArray()).toEqual([-1, 4.55, 0])
    expect(root.rotation.y).toBe(0)
    expect(scene.getObjectByName('entity:mob_10')).toBe(root)
    layer.dispose()
  })

  test('projects a fighter nametag from the top center of its rendered model', async () => {
    const scene = new Scene()
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial()))
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: -1, dispose: () => {} }),
    })
    layer.set_board(board)
    layer.set([
      Object.freeze({
        id: 'mob_10',
        kind: 'mob' as const,
        model_url: '/bunny.glb',
        anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
        facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
      }),
    ])
    await Promise.resolve()
    await Promise.resolve()

    expect(layer.world_anchor('mob_10')?.toArray()).toEqual([-1, 6.3, 0])
    layer.dispose()
  })

  test('animates a fight entity between canonical cell anchors before settling', async () => {
    const scene = new Scene()
    const root = new Group()
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
    })
    const start = Object.freeze({
      id: 'mob_10',
      kind: 'mob' as const,
      model_url: '/bunny.glb',
      anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
    })
    layer.set_board(board)
    layer.set([start])
    await Promise.resolve()
    await Promise.resolve()

    const moved = layer.animate(Object.freeze({ id: start.id, cells: Object.freeze([11]), gait: 'walk' as const }))
    layer.set([Object.freeze({ ...start, anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 11 }) })])
    expect(root.position.x).toBe(-1)
    layer.tick(Number.MAX_SAFE_INTEGER)

    expect(await moved).toBeTrue()
    expect(root.position.x).toBe(1)
    layer.dispose()
  })

  test('run movement advances faster than walk movement', async () => {
    const scene = new Scene()
    const walk_root = new Group()
    const run_root = new Group()
    const layer = create_entity_layer({
      scene,
      load_model: (spec) =>
        Promise.resolve({
          root: spec.id === 'walk' ? walk_root : run_root,
          clips: Object.freeze([]),
          min_y: 0,
          dispose: () => {},
        }),
    })
    const fighter = (id: string) =>
      Object.freeze({
        id,
        kind: 'mob' as const,
        model_url: `/${id}.glb`,
        anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
        facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
      })
    const walkers = Object.freeze([fighter('walk'), fighter('run')])
    layer.set_board(board)
    layer.set(walkers)
    await Promise.resolve()
    await Promise.resolve()

    const walk = layer.animate(Object.freeze({ id: 'walk', cells: Object.freeze([11]), gait: 'walk' as const }))
    const run = layer.animate(Object.freeze({ id: 'run', cells: Object.freeze([11]), gait: 'run' as const }))
    layer.set(
      walkers.map((spec) =>
        Object.freeze({ ...spec, anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 11 }) })
      )
    )
    layer.tick(performance.now() + 200)

    expect(run_root.position.x).toBe(1)
    expect(walk_root.position.x).toBeGreaterThan(-1)
    expect(walk_root.position.x).toBeLessThan(0)
    expect(await run).toBeTrue()
    layer.tick(Number.MAX_SAFE_INTEGER)
    expect(await walk).toBeTrue()
    layer.dispose()
  })

  test('a removed pending entity cannot reappear after its model finishes loading', async () => {
    const scene = new Scene()
    const root = new Group()
    let finish!: (model: { root: Group; clips: readonly []; min_y: number; dispose: () => void }) => void
    let disposed = false
    const layer = create_entity_layer({
      scene,
      load_model: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })

    layer.set_board(board)
    layer.set([
      Object.freeze({
        id: 'mob_11',
        kind: 'mob' as const,
        model_url: '/late.glb',
        anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 11 }),
        facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
      }),
    ])
    layer.set([])
    finish({
      root,
      clips: Object.freeze([]),
      min_y: 0,
      dispose: () => {
        disposed = true
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(scene.getObjectByName('fight_entity:mob_11')).toBeUndefined()
    expect(disposed).toBeTrue()
    layer.dispose()
  })

  test('the same door mounts a character at a terrain position with its complete appearance', async () => {
    const scene = new Scene()
    const root = new Group()
    const loaded: unknown[] = []
    const layer = create_entity_layer({
      scene,
      load_model: (spec) => {
        loaded.push(spec)
        return Promise.resolve({ root, clips: Object.freeze([]), min_y: -0.2, dispose: () => {} })
      },
    })
    const appearance = Object.freeze({
      body_url: '/senshi_male.glb',
      hair_url: '/senshi_male_hair.glb',
      colors: Object.freeze(['#112233', '#445566', '#778899'] as const),
      worn: Object.freeze({
        head: Object.freeze({ url: '/solomonk.glb', variant: null }),
        back: Object.freeze({ url: '/cape_fuwa.glb', variant: 'black' }),
      }),
    })
    const spec = Object.freeze({
      id: 'player_1',
      kind: 'character' as const,
      appearance,
      anchor: Object.freeze({ kind: 'world' as const, position: Object.freeze([7, 3, 11] as const) }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: Math.PI / 3 }),
    })

    layer.set([spec])
    await Promise.resolve()
    await Promise.resolve()

    expect(loaded).toEqual([spec])
    expect(root.position.toArray()).toEqual([7, 3.2, 11])
    expect(root.rotation.y).toBe(Math.PI / 3)
    expect(scene.getObjectByName('entity:player_1')).toBe(root)
    layer.dispose()
  })
})
