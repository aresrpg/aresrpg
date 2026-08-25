// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { BufferGeometry, Mesh, MeshBasicMaterial, Object3D } from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

import { apply_gltf_variant } from '../src/gltf_variant.ts'

test('a named material disambiguates duplicate exporter mappings', async () => {
  const fallback = new MeshBasicMaterial({ name: 'original' })
  const selected = new MeshBasicMaterial({ name: 'shiny' })
  const mesh = new Mesh(new BufferGeometry(), fallback)
  mesh.userData.gltfExtensions = {
    KHR_materials_variants: {
      mappings: [
        { material: 0, variants: [0] },
        { material: 1, variants: [0] },
      ],
    },
  }
  const root = new Object3D()
  root.add(mesh)
  const gltf = {
    parser: {
      json: { extensions: { KHR_materials_variants: { variants: [{ name: 'shiny' }] } } },
      getDependency: (_kind: string, index: number) => Promise.resolve([fallback, selected][index]),
    },
  } as unknown as GLTF

  await apply_gltf_variant(gltf, root, 'shiny')

  expect(mesh.material).toBe(selected)
})

test('a missing model variant fails instead of silently rendering the fallback', async () => {
  const root = new Object3D()
  const gltf = {
    parser: { json: { extensions: { KHR_materials_variants: { variants: [{ name: 'base' }] } } } },
  } as unknown as GLTF

  await expect(apply_gltf_variant(gltf, root, 'missing')).rejects.toThrow('variant missing is absent')
})

test('a declared but unmapped variant also fails instead of rendering the fallback', async () => {
  const root = new Object3D()
  const gltf = {
    parser: { json: { extensions: { KHR_materials_variants: { variants: [{ name: 'empty' }] } } } },
  } as unknown as GLTF

  await expect(apply_gltf_variant(gltf, root, 'empty')).rejects.toThrow('variant empty has no material mapping')
})
