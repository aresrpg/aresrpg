// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import assert from 'node:assert/strict'

import { mock } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import * as gpu from 'three/webgpu'

import type { CharacterModel } from '../src/character_model.ts'
import type { CharacterAppearanceRender } from '../src/types.ts'

const requests = new Map<string, ReturnType<typeof Promise.withResolvers<CharacterModel>>>()
const disposed: string[] = []
const colors: string[] = []
const model = (id: string): CharacterModel => {
  const root = new Group()
  const geometry = new BoxGeometry(1, 2, 1)
  const material = new MeshBasicMaterial()
  root.add(new Mesh(geometry, material))
  return {
    root,
    min_y: -1,
    clips: [],
    set_colors: ([color]) => {
      colors.push(color)
    },
    dispose: () => {
      disposed.push(id)
      geometry.dispose()
      material.dispose()
    },
  }
}
mock.module('../src/character_model.ts', () => ({
  create_character_model: ({ body_url }: CharacterAppearanceRender) => {
    const request = Promise.withResolvers<CharacterModel>()
    requests.set(body_url!, request)
    return request.promise
  },
}))
mock.module('three/webgpu', () => ({
  ...gpu,
  WebGPURenderer: new Proxy(gpu.WebGPURenderer, {
    construct: () => ({
      init: async () => {},
      setClearColor: () => {},
      setPixelRatio: () => {},
      setSize: () => {},
      dispose: () => {},
    }),
  }),
}))
Reflect.set(globalThis, 'window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} })
Reflect.set(globalThis, 'requestAnimationFrame', () => 1)
Reflect.set(globalThis, 'cancelAnimationFrame', () => {})
const { create_character_preview } = await import('../src/character_preview.ts')
const preview = await create_character_preview({
  clientWidth: 100,
  clientHeight: 100,
  addEventListener: () => {},
  removeEventListener: () => {},
} as never)
const appearance = (body_url: string): CharacterAppearanceRender => ({
  body_url,
  hair_url: null,
  worn: { head: null, back: null },
  colors: ['#ffffff', '#ffffff', '#ffffff'],
})
const first = preview.set_appearance(appearance('A'))
requests.get('A')!.resolve(model('A'))
await first
const obsolete = preview.set_appearance(appearance('B'))
await preview.set_appearance({ ...appearance('A'), colors: ['#ff0000', '#ffffff', '#ffffff'] })
requests.get('B')!.resolve(model('B'))
assert.equal(await obsolete, false, 'returning to a loaded model must invalidate an older pending replacement')
assert.deepEqual(disposed, ['B'])
assert.deepEqual(colors, ['#ff0000'])
preview.dispose()
assert.deepEqual(disposed, ['B', 'A'])
console.log('character preview latest selection passed')
