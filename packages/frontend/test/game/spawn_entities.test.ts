// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { EntityRender } from '@aresrpg/engine'

import { publish_observed_pose, publish_pose, type WorldPose } from '../../src/game/core/pose_feed.ts'
import type { WorldMobGroup } from '../../src/game/core/spawn_residency.ts'
import { create_spawn_renderer } from '../../src/game/spawn_entities.ts'

const pose = (character_id: string, x: number): WorldPose =>
  Object.freeze({ character_id, x, y: 0, z: 0, yaw: 0, riding: false, gliding: false, time_of_day: 0.5 })
const group = (id: string, x: number): WorldMobGroup =>
  Object.freeze({ id, x, z: 0, members: Object.freeze([{ mob_type: 'goblin', level_scalar: 0 }]) })
const groups = Object.freeze([group('inside', 50), group('outside', 150)])

const original_frame = globalThis.requestAnimationFrame
const renderers: ReturnType<typeof create_spawn_renderer>[] = []

const renderer_under = (own: WorldPose | null, observed: WorldPose | null) => {
  publish_pose(own)
  publish_observed_pose(observed)
  const submitted: (readonly EntityRender[])[] = []
  const renderer = create_spawn_renderer({
    submit: (entities) => submitted.push(entities),
    ground_height: () => 0,
    walk_step: () => null,
    entity_height: () => 2,
    label: () => undefined,
    model_for: () => ({ model_url: 'goblin.glb', variant: null }),
  })
  renderers.push(renderer)
  return {
    renderer,
    bodies: () => (submitted.at(-1) ?? []).map(({ id }) => id),
    animations: () => (submitted.at(-1) ?? []).map(({ animation }) => animation?.time_scale),
  }
}

beforeEach(() => {
  // The wander loop stays parked: these tests read the residency submissions only.
  globalThis.requestAnimationFrame = () => 0
  publish_pose(null)
  publish_observed_pose(null)
})

afterEach(() => {
  renderers.splice(0).forEach((renderer) => renderer.dispose())
  globalThis.requestAnimationFrame = original_frame
  publish_pose(null)
  publish_observed_pose(null)
})

test('a watched hero keeps the mob groups inside its render range and drops the others', () => {
  const { renderer, bodies } = renderer_under(null, pose('watched', 0))
  renderer.update(groups)
  expect(bodies()).toEqual(['inside:0'])
})

test('a controlled hero renders the same mob groups as before', () => {
  const { renderer, bodies } = renderer_under(pose('own', 0), null)
  renderer.update(groups)
  expect(bodies()).toEqual(['inside:0'])
})

test('the rendered groups follow the watched hero as it walks', () => {
  const { renderer, bodies } = renderer_under(null, pose('watched', 0))
  renderer.update(groups)
  publish_observed_pose(null)
  publish_observed_pose(pose('watched', 200))
  renderer.refresh()
  expect(bodies()).toEqual(['outside:0'])
})

test('a mob far from the watched hero freezes its animation', () => {
  const near = renderer_under(null, pose('watched', 0))
  near.renderer.update([group('pack', 50)])
  expect(near.animations()).toEqual([1])
  const far = renderer_under(null, pose('watched', 0))
  far.renderer.update([group('pack', 99)])
  expect(far.animations()).toEqual([0])
})

test('no displayed hero renders no mob group', () => {
  const { renderer, bodies } = renderer_under(null, null)
  renderer.update(groups)
  expect(bodies()).toEqual([])
})
