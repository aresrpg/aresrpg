// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterAppearanceRender, EntityRender, WorldCaption } from '@aresrpg/engine'

import { create_dungeon_guides, dungeon_guide_id } from '../../src/game/dungeon_guides.ts'

const appearance: CharacterAppearanceRender = {
  body_url: 'sceat.glb',
  hair_url: null,
  colors: ['#e8dfc7', '#433946', '#94704d'],
  worn: { head: null, back: null },
}

test('one tutorial appearance serves the current dungeon guides; retired guides and late loads cannot return', async () => {
  const frames: (readonly EntityRender[])[] = []
  const captions = new Map<string, WorldCaption | null>()
  let finish: (appearance: CharacterAppearanceRender) => void = () => {}
  let loads = 0
  const guides = create_dungeon_guides({
    submit: (entities) => frames.push(entities),
    caption: (id, value) => captions.set(id, value),
    ground_height: () => 42,
    load: async (source) => {
      loads += 1
      expect(source.classe).toBe('yajin')
      expect(source.loadout.hat).toBe('solomonk')
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })
  guides.set_markers([{ id: 'old', x: 0, z: 0 }])
  guides.set_markers([{ id: 'current', x: 10, z: 20 }])
  finish(appearance)
  await Bun.sleep(0)
  expect(loads).toBe(1)
  expect(frames.at(-1)?.map(({ id }) => id)).toEqual([dungeon_guide_id('current')])
  expect(captions.get(dungeon_guide_id('old'))).toBeNull()
  guides.speak('current', 'Bring the key.')
  expect(captions.get(dungeon_guide_id('current'))?.speech).toBe('Bring the key.')
  guides.set_markers([])
  expect(frames.at(-1)).toEqual([])
  const removed = frames.length
  guides.face_player([20, 0, 30])
  expect(frames).toHaveLength(removed)
  expect(frames.at(-1)).toEqual([])
  guides.dispose()
  const before = frames.length
  guides.set_markers([{ id: 'retired', x: 0, z: 0 }])
  expect(frames.length).toBe(before)
})

test('disposing during appearance loading cannot publish a character afterwards', async () => {
  const frames: (readonly EntityRender[])[] = []
  let finish: (appearance: CharacterAppearanceRender) => void = () => {}
  const guides = create_dungeon_guides({
    submit: (value) => frames.push(value),
    caption: () => {},
    ground_height: () => 0,
    load: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  guides.set_markers([{ id: 'gate', x: 0, z: 0 }])
  guides.dispose()
  finish(appearance)
  await Bun.sleep(0)
  expect(frames).toEqual([[]])
})

test('guides continuously face the local player without dialogue or stationary resubmission', async () => {
  const frames: (readonly EntityRender[])[] = []
  let ground_reads = 0
  const guides = create_dungeon_guides({
    submit: (entities) => frames.push(entities),
    caption: () => {},
    ground_height: () => {
      ground_reads++
      return 0
    },
    load: async () => appearance,
  })
  guides.set_markers([{ id: 'gate', x: 0, z: 0 }])
  guides.face_player([5, 0, 0])
  await Bun.sleep(0)
  expect(frames.at(-1)?.[0]?.facing).toEqual({ kind: 'yaw', yaw: Math.PI / 2 })
  guides.face_player([-5, 0, 0])
  expect(frames.at(-1)?.[0]?.facing).toEqual({ kind: 'yaw', yaw: -Math.PI / 2 })
  const before = frames.length
  guides.face_player([-5, 10, 0])
  expect(frames).toHaveLength(before)
  guides.face_player([0, 0, 0])
  expect(frames.at(-1)?.[0]?.facing).toEqual({ kind: 'yaw', yaw: -Math.PI / 2 })
  expect(ground_reads).toBe(1)
  guides.dispose()
  const after = frames.length
  guides.face_player([0, 0, 5])
  expect(frames).toHaveLength(after)
})
