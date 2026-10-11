// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import scene from '../../../../seed/scenes/adventure.json'
import { load_adventure_scene } from '../../src/adventure/scene.ts'

test('the shipped adventure sends bounded named structures to workers rather than raw authored voxel tuples', () => {
  expect(scene.world.fixed_structures.every(({ source }) => typeof source === 'string')).toBeTrue()
  expect(JSON.stringify(scene.world).length).toBeLessThan(256 * 1024)
})

test('the scene request forwards cancellation and rejects failed or malformed responses', async () => {
  const controller = new AbortController()
  const loaded = await load_adventure_scene(controller.signal, async (url, options) => {
    expect(String(url)).toEndWith('/seed/scenes/adventure.json')
    expect(options.signal).toBe(controller.signal)
    return Response.json(scene)
  })
  expect(loaded).toEqual(scene)
  await expect(
    load_adventure_scene(controller.signal, async () => new Response(null, { status: 503 }))
  ).rejects.toThrow('503')
  await expect(load_adventure_scene(controller.signal, async () => new Response('broken'))).rejects.toThrow()
  const pending = load_adventure_scene(
    controller.signal,
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
  )
  controller.abort(new Error('scene disposed'))
  await expect(pending).rejects.toThrow('scene disposed')
})
