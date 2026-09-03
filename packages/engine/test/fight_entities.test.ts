// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial, NumberKeyframeTrack, Scene, Vector3 } from 'three'

import type { CharacterAnimationName } from '../src/types.ts'
import {
  character_entity_scale,
  cardinal_target_yaw,
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
  test('retains every legacy scale, gait, facing, and envelope pin', () => {
    const origin = new Vector3(0, 0, 0)
    const pins: readonly { why: string; actual: unknown; expected: unknown }[] = [
      { why: 'world height is unscaled', actual: character_entity_scale('world'), expected: 1 },
      { why: 'the fight-only player scale', actual: character_entity_scale('fight_cell'), expected: 0.7 },
      {
        why: 'the path-length gait boundary',
        actual: [1, 2, 3, 4].map(fight_path_gait),
        expected: ['walk', 'walk', 'run', 'run'],
      },
      { why: 'the walk pace', actual: fight_gait_cell_ms('walk'), expected: 480 },
      { why: 'the run pace', actual: fight_gait_cell_ms('run'), expected: 170 },
      { why: 'facing quantizes east', actual: cardinal_target_yaw(origin, new Vector3(1, 0, 4)), expected: 0 },
      { why: 'facing quantizes south', actual: cardinal_target_yaw(origin, new Vector3(1, 0, -4)), expected: Math.PI },
      { why: 'the reaction envelope opens at rest', actual: fight_reaction_envelope(0), expected: 0 },
      { why: 'the reaction envelope peaks', actual: fight_reaction_envelope(0.32), expected: 1 },
      { why: 'the reaction envelope closes', actual: fight_reaction_envelope(1), expected: 0 },
      { why: 'the flash envelope peaks', actual: fight_flash_envelope(0.15), expected: 1 },
      { why: 'the flash envelope closes', actual: fight_flash_envelope(0.4), expected: 0 },
    ]

    pins.forEach(({ why, actual, expected }) => {
      expect(actual, why).toEqual(expected)
    })

    // The two diagonal quadrants land on a half-turn, so they are compared loosely.
    expect(cardinal_target_yaw(origin, new Vector3(4, 0, 1))).toBeCloseTo(Math.PI / 2)
    expect(cardinal_target_yaw(origin, new Vector3(-4, 0, 1))).toBeCloseTo(-Math.PI / 2)
  })

  test('resolves a locomotion clip through the complete legacy fallback order', () => {
    const clips = Object.freeze([
      new AnimationClip('JUMP_RUN', 1),
      new AnimationClip('RUN', 1),
      new AnimationClip('Armature|WALK', 1),
    ])
    const namespaced = Object.freeze([
      new AnimationClip('Armature|JUMP_RUN', 1),
      new AnimationClip('Armature|JUMP', 1),
      new AnimationClip('Armature|FALL', 1),
      new AnimationClip('Armature|WALK', 1),
      new AnimationClip('IDLE', 1),
      new AnimationClip('DANCE', 1),
    ])
    const cases: readonly { clips: readonly AnimationClip[]; requested: CharacterAnimationName; resolved: string }[] = [
      // The requested clip wins over an earlier compound jump clip.
      { clips, requested: 'RUN', resolved: 'RUN' },
      { clips, requested: 'WALK', resolved: 'Armature|WALK' },
      { clips: [new AnimationClip('IDLE', 1)], requested: 'RUN', resolved: 'IDLE' },
      { clips: namespaced, requested: 'JUMP_RUN', resolved: 'Armature|JUMP_RUN' },
      { clips: namespaced, requested: 'FALL', resolved: 'Armature|FALL' },
      { clips: namespaced, requested: 'SWIM', resolved: 'Armature|WALK' },
      { clips: namespaced, requested: 'SIT', resolved: 'IDLE' },
      { clips: namespaced, requested: 'DANCE', resolved: 'DANCE' },
    ]

    cases.forEach(({ clips: available, requested, resolved }) => {
      expect(resolve_entity_locomotion_clip(available, requested)?.name, requested).toBe(resolved)
    })
  })

  test('attaches and clears invisibility without remounting the model', async () => {
    const scene = new Scene()
    const root = new Group()
    let attached = 0
    let disposed = 0
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
      attach_invisibility: () => {
        attached += 1
        return Object.freeze({
          update: () => undefined,
          dispose: () => {
            disposed += 1
          },
        })
      },
    })
    const fighter = Object.freeze({
      id: 'mob_10',
      kind: 'mob' as const,
      model_url: '/bunny.glb',
      anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
      visual_effect: Object.freeze({ kind: 'invisibility' as const }),
    })
    layer.set_board(board)
    layer.set([fighter])
    await Promise.resolve()
    await Promise.resolve()

    expect(attached).toBe(1)
    layer.set([Object.freeze({ ...fighter, visual_effect: undefined })])
    expect(disposed).toBe(1)
    expect(scene.getObjectByName('entity:mob_10')).toBeDefined()
    layer.dispose()
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
    const object = scene.getObjectByName(`entity:${fighter.id}`)!
    const rest = object.position.clone()
    // The beat animates only the inner wobble node; the root's position never leaves the
    // anchor — that single ownership is what keeps a mid-beat snap (swap) from rolling back.
    const wobble = object.children[0]!

    const hit = layer.beat(fighter.id, 'hit', undefined, true)
    layer.tick(performance.now() + 96)
    expect(object.position.toArray()).toEqual(rest.toArray())
    expect(Math.hypot(wobble.position.x, wobble.position.z)).toBeGreaterThan(0.1)
    expect(wobble.scale.y).toBeLessThan(1)
    layer.tick(Number.MAX_SAFE_INTEGER)

    expect(await hit).toBeTrue()
    expect(object.position.toArray()).toEqual(rest.toArray())
    expect([wobble.position.x, wobble.position.z]).toEqual([0, 0])
    expect(wobble.scale.toArray()).toEqual([1, 1, 1])
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
    expect(scene.getObjectByName(`entity:${fighter.id}`)?.visible).toBeFalse()
    layer.set_board(board)
    expect(scene.getObjectByName(`entity:${fighter.id}`)?.visible).toBeFalse()
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

    expect(scene.getObjectByName('entity:character_20')?.rotation.y).toBeCloseTo(Math.atan2(2, 1))
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

    expect(layer.world_anchor('mob_10')?.toArray()).toEqual([-1, 5.7, 0])
    expect(layer.entity_height('mob_10')).toBeCloseTo(1.4)
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
    const object = scene.getObjectByName(`entity:${start.id}`)!
    expect(object.position.x).toBe(-1)
    layer.tick(Number.MAX_SAFE_INTEGER)

    expect(await moved).toBeTrue()
    expect(object.position.x).toBe(1)
    layer.set([Object.freeze({ ...start, anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 11 }) })])
    expect(object.rotation.y).toBeCloseTo(Math.PI / 2)
    layer.dispose()
  })

  test('a slide displacement travels without ever turning the entity', async () => {
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
      facing: Object.freeze({ kind: 'yaw' as const, yaw: Math.PI }),
    })
    layer.set_board(board)
    layer.set([start])
    await Promise.resolve()
    await Promise.resolve()
    const object = scene.getObjectByName(`entity:${start.id}`)!
    const facing_before = object.rotation.y

    const pushed = layer.animate(Object.freeze({ id: start.id, cells: Object.freeze([11]), gait: 'slide' as const }))
    layer.tick(performance.now() + 55)
    // mid-slide: moving, not reorienting toward the travel direction
    expect(object.rotation.y).toBe(facing_before)
    layer.tick(Number.MAX_SAFE_INTEGER)

    expect(await pushed).toBeTrue()
    expect(object.position.x).toBe(1)
    expect(object.rotation.y).toBe(facing_before)
    expect(fight_gait_cell_ms('slide')).toBeLessThan(fight_gait_cell_ms('run'))
    layer.dispose()
  })

  test('finishes each accepted movement cue at that cue endpoint rather than the future checkpoint anchor', async () => {
    const scene = new Scene()
    const root = new Group()
    const path_board = Object.freeze({
      width: 3,
      height: 1,
      cell_size: 2,
      origin: Object.freeze({ x: -3, y: 4, z: -1 }),
      cells: Object.freeze([
        Object.freeze({ cell: 10, x: 0, y: 0, kind: 'start_a' as const }),
        Object.freeze({ cell: 11, x: 1, y: 0, kind: 'floor' as const }),
        Object.freeze({ cell: 12, x: 2, y: 0, kind: 'start_b' as const }),
      ]),
    })
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
    })
    const start = Object.freeze({
      id: 'mob_trap_walk',
      kind: 'mob' as const,
      model_url: '/bunny.glb',
      anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
    })
    layer.set_board(path_board)
    layer.set([start])
    await Promise.resolve()
    await Promise.resolve()

    const first_cue = layer.animate(Object.freeze({ id: start.id, cells: Object.freeze([11]), gait: 'walk' as const }))
    layer.set([Object.freeze({ ...start, anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 12 }) })])
    layer.tick(Number.MAX_SAFE_INTEGER)

    expect(await first_cue).toBeTrue()
    expect(scene.getObjectByName(`entity:${start.id}`)?.position.x).toBe(0)
    layer.dispose()
  })

  test('snaps teleport cues to their event cell rather than the future checkpoint anchor', async () => {
    const scene = new Scene()
    const root = new Group()
    const path_board = Object.freeze({
      width: 3,
      height: 1,
      cell_size: 2,
      origin: Object.freeze({ x: -3, y: 4, z: -1 }),
      cells: Object.freeze([
        Object.freeze({ cell: 10, x: 0, y: 0, kind: 'start_a' as const }),
        Object.freeze({ cell: 11, x: 1, y: 0, kind: 'floor' as const }),
        Object.freeze({ cell: 12, x: 2, y: 0, kind: 'start_b' as const }),
      ]),
    })
    const start = Object.freeze({
      id: 'mob_trap_teleport',
      kind: 'mob' as const,
      model_url: '/bunny.glb',
      anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
    })
    const layer = create_entity_layer({
      scene,
      load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
    })
    layer.set_board(path_board)
    layer.set([start])
    await Promise.resolve()
    await Promise.resolve()
    layer.set([Object.freeze({ ...start, anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 12 }) })])

    expect(layer.snap(start.id, 11)).toBeTrue()
    expect(scene.getObjectByName(`entity:${start.id}`)?.position.x).toBe(0)
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

    const run_object = scene.getObjectByName('entity:run')!
    const walk_object = scene.getObjectByName('entity:walk')!
    expect(run_object.position.x).toBe(1)
    expect(walk_object.position.x).toBeGreaterThan(-1)
    expect(walk_object.position.x).toBeLessThan(0)
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
    const object = scene.getObjectByName('entity:player_1')!
    expect(object.position.toArray()).toEqual([7, 3, 11])
    expect(root.parent?.position.toArray()).toEqual([0, 0.2, 0])
    expect(object.rotation.y).toBe(Math.PI / 3)
    expect(root.parent?.parent).toBe(object)
    layer.set([Object.freeze({ ...spec, visible: false })])
    expect(object.visible).toBeFalse()
    expect(loaded).toHaveLength(1)
    layer.set([Object.freeze({ ...spec, visible: true })])
    expect(object.visible).toBeTrue()
    expect(loaded).toHaveLength(1)
    layer.dispose()
  })

  test('advances world character animation without moving its entity anchor', async () => {
    const scene = new Scene()
    const model_root = new Group()
    const clip = new AnimationClip('RUN', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])])
    const layer = create_entity_layer({
      scene,
      load_model: () =>
        Promise.resolve({ root: model_root, clips: Object.freeze([clip]), min_y: 0, dispose: () => {} }),
    })
    const spec = Object.freeze({
      id: 'player_1',
      kind: 'character' as const,
      appearance: Object.freeze({
        body_url: '/senshi_male.glb',
        hair_url: null,
        colors: Object.freeze(['#112233', '#445566', '#778899'] as const),
        worn: Object.freeze({ head: null, back: null }),
      }),
      anchor: Object.freeze({ kind: 'world' as const, position: Object.freeze([7, 3, 11] as const) }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
      animation: Object.freeze({ name: 'RUN' as const, time_scale: 1 }),
    })

    layer.set([spec])
    await Promise.resolve()
    await Promise.resolve()
    const start = performance.now()
    layer.tick(start + 100)
    layer.set([spec])
    layer.tick(start + 200)

    expect(scene.getObjectByName('entity:player_1')?.position.toArray()).toEqual([7, 3, 11])
    expect(model_root.position.x).toBeGreaterThan(0)
    layer.dispose()
  })
})
