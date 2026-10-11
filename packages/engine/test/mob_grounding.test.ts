// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { DataTexture, Group, Vector3, type SkinnedMesh } from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as clone_skinned } from 'three/addons/utils/SkeletonUtils.js'

import { prepare_mob_model_root } from '../src/mob_model.ts'

test.each(['moyumi', 'cro_wani'])('%s stands on its measured floor after cloning the rig', async (name) => {
  const progress_event = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent')
  Object.defineProperty(globalThis, 'ProgressEvent', { value: Event, configurable: true })
  const draco = new DRACOLoader()
  const loader = new GLTFLoader().setDRACOLoader(draco)
  loader.register(() => ({
    name: 'GROUNDING_GEOMETRY_CHECK',
    loadTexture: async () => new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  }))
  const bytes = readFileSync(new URL(`../../../seed/models/mobs/${name}.glb`, import.meta.url))
  try {
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    const root = clone_skinned(gltf.scene)
    const floor = prepare_mob_model_root(root, gltf.animations, name, gltf.scene)
    const placed = new Group()
    placed.position.set(7, 64, -5)
    placed.scale.setScalar(0.8)
    const offset = new Group()
    offset.position.y = -floor
    offset.add(root)
    placed.add(offset)
    placed.updateMatrixWorld(true)
    let lowest = Infinity
    const point = new Vector3()
    root.traverse((object) => {
      const mesh = object as SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
        mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld)
        lowest = Math.min(lowest, point.y)
      }
    })
    expect(lowest).toBeCloseTo(64, 4)
  } finally {
    draco.dispose()
    if (progress_event) Object.defineProperty(globalThis, 'ProgressEvent', progress_event)
    else Reflect.deleteProperty(globalThis, 'ProgressEvent')
  }
})
