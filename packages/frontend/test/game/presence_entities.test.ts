// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterAppearanceRender, EntityRender } from '@aresrpg/engine'
import type { PresenceRow } from '@aresrpg/protocol'

import { create_presence_renderer } from '../../src/game/presence_entities.ts'

const appearance: CharacterAppearanceRender = {
  body_url: 'body',
  hair_url: null,
  colors: ['#fff', '#fff', '#fff'],
  worn: { head: null, back: null },
}
const rows_at = (x: number) =>
  Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      `player_${index}`,
      {
        character_id: `player_${index}`,
        owner: 'owner',
        world: 'nauvis',
        name: 'Player',
        classe: 'senshi',
        sex: 'male',
        level: 1,
        color_1: 1,
        color_2: 2,
        color_3: 3,
        x,
        y: 0,
        z: 50_000,
        riding: false,
        hat: null,
        cloak: null,
        cosmetic_hat: null,
        cosmetic_cloak: null,
        pet: null,
        title: null,
      } satisfies PresenceRow,
    ])
  )

test('asset arrivals and position bursts submit one crowd per animation frame', async () => {
  const frames = new Set<(now: number) => void>()
  const submitted: (readonly EntityRender[])[] = []
  const renderer = create_presence_renderer({
    submit: (entities) => submitted.push(entities),
    entity_height: () => 2,
    pet_ground_height: () => 0,
    label: () => {},
    next_frame: (frame) => {
      frames.add(frame)
    },
    appearance_loader: async () => appearance,
  })
  const frame = () => {
    const callbacks = [...frames]
    frames.clear()
    callbacks.forEach((run) => run(performance.now() + 16))
  }
  try {
    renderer.update(rows_at(50_000), null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(submitted).toHaveLength(0)
    expect(frames.size).toBe(1)
    frame()
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toHaveLength(100)
    for (let index = 1; index <= 20; index++) renderer.update(rows_at(50_000 + index), null)
    expect(submitted).toHaveLength(1)
    expect(frames.size).toBe(1)
    frame()
    expect(submitted).toHaveLength(2)
    expect(renderer.positions().every(({ x }) => x > 1)).toBeTrue()
  } finally {
    renderer.dispose()
  }
  const count = submitted.length
  frame()
  expect(submitted).toHaveLength(count)
})

test('scene disposal retires pending appearance loads and scheduled frames', async () => {
  let release!: (value: typeof appearance) => void
  const pending = new Promise<typeof appearance>((resolve) => {
    release = resolve
  })
  const frames: ((now: number) => void)[] = []
  const submitted: (readonly EntityRender[])[] = []
  const renderer = create_presence_renderer({
    submit: (entities) => submitted.push(entities),
    entity_height: () => 2,
    pet_ground_height: () => 0,
    label: () => {},
    next_frame: (frame) => {
      frames.push(frame)
    },
    appearance_loader: () => pending,
  })
  renderer.update(rows_at(50_000), null)
  renderer.dispose()
  release(appearance)
  await pending
  await new Promise((resolve) => setTimeout(resolve, 0))
  frames.forEach((frame) => frame(performance.now()))
  expect(submitted).toEqual([[]])
  expect(renderer.positions()).toEqual([])
})
