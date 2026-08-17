// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_terrain_planner } from '../src/terrain_planner.ts'
import { BIOME_SLOTS, type WorldRecipe } from '../src/world_recipe.ts'

const WORLD: WorldRecipe = {
  seed: 'planner-test',
  sea_level: 0,
  materials: { stone: { color: '#777777', preset: 'stone' } },
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'test'])) as WorldRecipe['biome_slots'],
  biomes: [
    {
      name: 'test',
      landscape: [
        { x: 0, y: 1, land: { surface: 'stone', subsurface: 'stone', filler: 'stone' } },
        { x: 1, y: 1 },
      ],
    },
  ],
}

test('terrain planning keeps only one active and the latest queued focus', async () => {
  const messages: unknown[] = []
  const listeners = new Map<string, (event: MessageEvent) => void>()
  const worker = {
    postMessage: (message: unknown) => messages.push(message),
    addEventListener: ((type: string, listener: (event: MessageEvent) => void) =>
      listeners.set(type, listener)) as Worker['addEventListener'],
    terminate: () => {},
  }
  const planner = create_terrain_planner(WORLD, () => worker)
  const first = planner.plan([{ x: 0, z: 0 }])
  const superseded = planner.plan([{ x: 1, z: 0 }]).catch((error: Error) => error.message)
  const latest = planner.plan([{ x: 2, z: 0 }])

  expect(messages).toEqual([
    { type: 'initialize', world: WORLD },
    { type: 'plan', id: 1, columns: [{ x: 0, z: 0 }] },
  ])
  expect(await superseded).toBe('terrain plan was superseded by a newer focus')

  listeners.get('message')?.(new MessageEvent('message', { data: { id: 1, plans: [] } }))
  await first
  expect(messages.at(-1)).toEqual({ type: 'plan', id: 3, columns: [{ x: 2, z: 0 }] })

  listeners.get('message')?.(new MessageEvent('message', { data: { id: 3, plans: [] } }))
  await latest
  planner.dispose()
})
