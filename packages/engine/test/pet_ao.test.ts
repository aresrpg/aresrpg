// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { DataTexture, type Mesh, type MeshStandardMaterial } from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

test('Suicune carries cavity shading beyond the four directional face shades', async () => {
  const progress_event = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent')
  Object.defineProperty(globalThis, 'ProgressEvent', { value: Event, configurable: true })
  const draco = new DRACOLoader()
  const loader = new GLTFLoader().setDRACOLoader(draco)
  // Texture pixels are irrelevant here; geometry and baked colors use the actual game decoder.
  loader.register(() => ({
    name: 'AO_GEOMETRY_CHECK',
    loadTexture: async () => new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  }))
  const bytes = readFileSync(new URL('../../../seed/models/pets/suicune.glb', import.meta.url))
  try {
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    const meshes: Mesh[] = []
    gltf.scene.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh)
    })
    expect(meshes).toHaveLength(1)
    const mesh = meshes[0]!
    const colors = mesh.geometry.getAttribute('color')
    expect((mesh.material as MeshStandardMaterial).vertexColors).toBe(true)
    const shades = Array.from({ length: colors.count }, (_, index) => colors.getX(index))
    expect(new Set(shades.map((shade) => Math.round(shade * 255))).size).toBeGreaterThan(32)
    expect(Math.min(...shades)).toBeLessThan(0.5)
    expect(Math.max(...shades)).toBeGreaterThan(0.9)
    mesh.geometry.dispose()
    ;(mesh.material as MeshStandardMaterial).map?.dispose()
    ;(mesh.material as MeshStandardMaterial).dispose()
  } finally {
    draco.dispose()
    if (progress_event) Object.defineProperty(globalThis, 'ProgressEvent', progress_event)
    else Reflect.deleteProperty(globalThis, 'ProgressEvent')
  }
})
