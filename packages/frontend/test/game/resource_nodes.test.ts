// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, expect, test } from 'bun:test'
import type { ResourceNodeMarker } from '@aresrpg/engine'

import { publish_observed_pose, publish_pose, type WorldPose } from '../../src/game/core/pose_feed.ts'
import { create_resource_renderer, type WorldResourcePack } from '../../src/game/resource_nodes.ts'

const pose = (character_id: string, x: number): WorldPose =>
  Object.freeze({ character_id, x, y: 0, z: 0, yaw: 0, riding: false, gliding: false, time_of_day: 0.5 })
const pack = (id: string, x: number): WorldResourcePack =>
  Object.freeze({ id, x, z: 0, item_type: 'iron_ore', job: 'MINER', tier: 1, nodes: 1 })
const packs = Object.freeze([pack('inside', 90), pack('outside', 90.5)])

const renderer_under = (own: WorldPose | null, observed: WorldPose | null) => {
  publish_pose(null)
  publish_observed_pose(null)
  publish_pose(own)
  publish_observed_pose(observed)
  const submitted: (readonly ResourceNodeMarker[])[] = []
  const renderer = create_resource_renderer({
    submit: (markers) => submitted.push(markers),
    ground_height: () => 0,
    label: () => undefined,
  })
  return { renderer, placed: () => (submitted.at(-1) ?? []).map(({ id }) => id) }
}

afterEach(() => {
  publish_pose(null)
  publish_observed_pose(null)
})

test('a watched hero keeps the resource packs inside its load range and drops the others', () => {
  const { renderer, placed } = renderer_under(null, pose('watched', 0))
  renderer.update(packs)
  expect(placed()).toEqual(['inside:n0'])
})

test('a controlled hero places the same packs as before', () => {
  const { renderer, placed } = renderer_under(pose('own', 0), null)
  renderer.update(packs)
  expect(placed()).toEqual(['inside:n0'])
})

test('a placed pack stays until the watched hero leaves its despawn range', () => {
  const { renderer, placed } = renderer_under(null, pose('watched', 0))
  renderer.update(packs)
  publish_observed_pose(null)
  publish_observed_pose(pose('watched', -30))
  renderer.update(packs)
  expect(placed()).toEqual(['inside:n0'])
  publish_observed_pose(null)
  publish_observed_pose(pose('watched', -30.5))
  renderer.update(packs)
  expect(placed()).toEqual([])
})

test('no displayed hero places no resource pack', () => {
  const { renderer, placed } = renderer_under(null, null)
  renderer.update(packs)
  expect(placed()).toEqual([])
})
