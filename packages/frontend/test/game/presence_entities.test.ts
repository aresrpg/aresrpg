// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { CharacterAppearanceRender, EntityRender } from '@aresrpg/engine'
import { DEFAULT_ADMIN_ADDRESS, type PresenceRow } from '@aresrpg/protocol'

import { world_presence_rows } from '../../src/modules/engine_selection.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'
import { create_follow_addon } from '../../src/game/core/cameras.ts'
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
        gliding: false,
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

test('equipping and removing a title updates a remote aura without reloading models or leaving the crowd', async () => {
  const frames = new Set<(now: number) => void>()
  const submitted: (readonly EntityRender[])[] = []
  let loads = 0
  const renderer = create_presence_renderer({
    submit: (entities) => submitted.push(entities),
    pet_ground_height: () => 0,
    label: () => {},
    next_frame: (frame) => {
      frames.add(frame)
    },
    appearance_loader: async () => {
      loads++
      return appearance
    },
  })
  const frame = () => {
    const callbacks = [...frames]
    frames.clear()
    callbacks.forEach((run) => run(performance.now() + 16))
  }
  const base = rows_at(50_000).player_0!
  const latest = () => submitted.at(-1)?.find(({ id }) => id === base.character_id)
  try {
    renderer.update({ [base.character_id]: base }, null)
    await Bun.sleep(0)
    frame()
    renderer.update({ [base.character_id]: { ...base, title: 'title_veteran' } }, null)
    frame()
    expect(latest()).toMatchObject({ kind: 'character', aura: 'unbroken', presentation: 'crowd' })
    expect(loads).toBe(1)
    renderer.update({ [base.character_id]: base }, null)
    frame()
    expect(latest()).not.toHaveProperty('aura')
    expect(loads).toBe(1)
    renderer.update({ [base.character_id]: { ...base, owner: DEFAULT_ADMIN_ADDRESS } }, null)
    frame()
    expect(latest()).toMatchObject({ aura: 'admin', presentation: 'crowd' })
    renderer.update({ [base.character_id]: base }, null)
    frame()
    expect(latest()).not.toHaveProperty('aura')
    expect(loads).toBe(1)
  } finally {
    renderer.dispose()
  }
})

test('checkpoint-only presence is grounded, while actual position packets preserve height and animate', async () => {
  const frames = new Set<(now: number) => void>()
  let entities: readonly EntityRender[] = []
  const renderer = create_presence_renderer({
    submit: (next) => {
      entities = next
    },
    pet_ground_height: () => 42,
    label: () => {},
    next_frame: (frame) => {
      frames.add(frame)
    },
    appearance_loader: async () => appearance,
  })
  const frame = () => {
    const callbacks = [...frames]
    frames.clear()
    callbacks.forEach((run) => run(performance.now() + 100))
  }
  try {
    const base = rows_at(50_000).player_0!
    const state = automation_fixture()
    const rows = world_presence_rows(
      { ...state, world: { ...state.world, players: { player_0: { ...base, y: null } } } },
      () => 42
    )
    renderer.update(rows, 'alice')
    await Bun.sleep(0)
    frame()
    expect(entities[0]?.anchor).toMatchObject({ position: [0, 42, 0] })
    renderer.update({ player_0: { ...base, x: 50_002, y: 48 } }, null)
    frame()
    expect(entities[0]?.anchor).toMatchObject({ position: [2, 48, 0] })
    expect(entities[0]?.animation).toMatchObject({ name: 'RUN' })
  } finally {
    renderer.dispose()
  }
})

test('observed camera motion follows interpolation and retires on quiet, checkpoints, removal and disposal', async () => {
  let now = 1000
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  const frames: ((now: number) => void)[] = []
  const renderer = create_presence_renderer({
    submit: () => {},
    pet_ground_height: () => 0,
    label: () => {},
    next_frame: (frame) => {
      frames.push(frame)
    },
    appearance_loader: async () => appearance,
  })
  const row = (x: number, live = true) => ({ remote: { ...rows_at(x).player_0!, character_id: 'remote', live } })
  try {
    renderer.update(row(50_000), null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.motion('remote')?.speed).toBe(0)
    renderer.update(row(50_001), null)
    const moving = renderer.motion('remote')!
    expect(moving.speed).toBe(10)
    expect(moving.velocity).toEqual([10, 0, 0])
    frames.splice(0).forEach((frame) => frame(performance.now() + 50))
    expect(renderer.motion('remote')!.speed).toBeLessThan(moving.speed)
    now += 301
    expect(renderer.motion('remote')?.speed).toBe(0)
    renderer.update(row(60_000, false), null)
    expect(renderer.motion('remote')?.speed).toBe(0)
    renderer.update(row(60_010), null)
    expect(renderer.motion('remote')?.speed).toBe(0)
    renderer.update(row(60_011), null)
    expect(renderer.motion('remote')!.speed).toBeGreaterThan(0)
    renderer.update({}, null)
    expect(renderer.motion('remote')).toBeNull()
  } finally {
    renderer.dispose()
    clock.mockRestore()
  }
  expect(renderer.motion('remote')).toBeNull()
})

test('mounted presence drives the same follow-camera wind and FOV, with no speed from vertical bobbing', async () => {
  let now = 1000
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  const frames: ((time: number) => void)[] = []
  const renderer = create_presence_renderer({
    submit: () => {},
    label: () => {},
    pet_ground_height: () => 0,
    next_frame: (frame) => {
      frames.push(frame)
    },
    appearance_loader: async () => appearance,
    pet_loader: async () => ({
      model_url: 'pet',
      locomotion: 'walk',
      wings: {
        shape: 'circuit',
        trail: 'dashes',
        primary: [1, 1, 1],
        secondary: [1, 1, 1],
        shade: [0, 0, 0],
        variant: 0,
        scale: 1,
      },
    }),
  })
  const camera = create_follow_addon(() => false)
  const base = { ...rows_at(50_000).player_0!, character_id: 'remote', pet: 'test-pet', riding: true }
  const anchor = { x: 0, y: 0, z: 0, eye_height: 1.8, on_ground: true, speed: 0 }
  let time = performance.now()
  const tick = (row: typeof base) => {
    now += 1000 / 60
    time += 1000 / 60
    renderer.update({ remote: row }, null)
    frames.splice(0).forEach((frame) => frame(time))
    return camera.frame({ ...anchor, ...renderer.motion('remote') }, 1 / 60)
  }
  try {
    renderer.update({ remote: base }, null)
    await Bun.sleep(0)
    expect(renderer.motion('remote')?.riding).toBeTrue()
    let view = tick(base)
    for (let index = 1; index <= 180; index++) view = tick({ ...base, x: base.x + index / 4 })
    expect(view.fov).toBeGreaterThan(77)
    expect(view.speed_wind!).toBeGreaterThan(0.9)
    for (let index = 0; index < 180; index++) view = tick({ ...base, x: base.x + 45, y: Math.sin(index) })
    expect(renderer.motion('remote')?.speed).toBeLessThan(0.01)
    expect(view.fov).toBeCloseTo(68, 2)
    expect(view.speed_wind!).toBeLessThan(0.001)
    tick({ ...base, x: base.x + 45, riding: false })
    expect(renderer.motion('remote')?.riding).toBeFalse()
    renderer.update({}, null)
    expect(renderer.motion('remote')).toBeNull()
  } finally {
    renderer.dispose()
    clock.mockRestore()
  }
})
