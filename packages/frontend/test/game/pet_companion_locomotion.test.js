// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2172 RED-FIRST — the follower moved in world space while its private mixer stayed on the one clip chosen
// at load. Drive the real follower scene edge through a chase and a stop, mocking only the shared engine avatar
// (the real mixer needs a loaded GLB), and assert the animation STATE that shared mixer consumes.

import { afterAll, describe, expect, mock, test } from 'bun:test'

import '../../src/test_helpers/env_mock.js'
import { mob_model_fallback_url } from '../../src/game/data/mobs.js'

const avatar_updates = []
const classifier_reads = []

const object3d = {
  parent: null,
  visible: true,
  position: {
    x: 0,
    y: 0,
    z: 0,
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
    },
  },
  rotation: { y: 0 },
}

const avatar = {
  object3d,
  ready: true,
  update(anim, yaw, dt) {
    avatar_updates.push({ anim, yaw, dt })
  },
  dispose: mock(() => {}),
}

const create_character_avatar = mock(() => avatar)
const create_mob_model = mock(async () => {
  throw new Error('the avatar mock must own the model boundary')
})

// SPREAD the real module: `mock.module` is PROCESS-global with no unmock, so a partial replacement makes the
// real module unloadable for every file bun loads afterwards — listing five exports here left the rest of
// @aresrpg/engine3/player missing and the #1993 board suite died on `topmost_solid_id`. Snapshot the namespace
// BEFORE registering, since mock.module mutates the module record in place.
const real_player = { ...(await import('@aresrpg/engine3/player')) }
mock.module('@aresrpg/engine3/player', () => ({
  ...real_player,
  // Current broken implementation imports these two and waits forever on the loader. The fixed path instead
  // calls create_character_avatar, which is the player/mob animation home mocked above.
  apply_avatar_material: () => {},
  load_glb_checked: () => new Promise(() => {}),
  create_character_avatar,
  create_mob_model,
  classify_anim(state, opts) {
    classifier_reads.push({ speed: state.speed, opts })
    if (state.speed <= 0.5) return 'IDLE'
    return opts?.ground_gait === 'walk' ? 'WALK' : 'RUN'
  },
}))

const { create_pet_companion_rig } = await import('../../src/game/pet_companion.js')

afterAll(() => mock.restore())

describe('#2172 pet companion locomotion drives the shared avatar mixer state', () => {
  test('a chase consumes WALK, then a still frame consumes IDLE', () => {
    const scene = []
    const engine = {
      add_to_scene(node) {
        node.parent = engine
        scene.push(node)
      },
      remove_from_scene(node) {
        node.parent = null
      },
    }
    const rig = create_pet_companion_rig({
      engine,
      glb_url: 'https://assets.test/models/mobs/hy_bunny.glb',
      slug: 'pet_bunny',
      rng: () => 0,
    })

    expect(rig.ready).toBe(true)
    expect(scene).toEqual([object3d])
    expect(create_character_avatar).toHaveBeenCalledWith(
      expect.objectContaining({ fallback_url: mob_model_fallback_url(), mob_model_factory: create_mob_model })
    )

    rig.update(0, 4, 0, 0.1) // seed on the owner: still
    rig.update(20, 4, 0, 0.1) // beyond the dead zone: chase
    const stopped_at = { x: object3d.position.x, z: object3d.position.z }
    rig.update(stopped_at.x, 4, stopped_at.z, 0.1) // target is exactly here: no travel

    expect(avatar_updates.map(({ anim }) => anim)).toEqual(['IDLE', 'WALK', 'IDLE'])
    expect(classifier_reads.map(({ opts }) => opts?.ground_gait)).toEqual(['walk', 'walk', 'walk'])
    expect(classifier_reads[1].speed).toBeGreaterThan(0.5)
    expect(classifier_reads[2].speed).toBe(0)
  })
})
