// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { AnimationMixer, Vector3, type SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

test('Pampkin exports animated candle wings, a carried mount socket and seamless flight loops', async () => {
  const bytes = readFileSync(new URL('../../../seed/models/pets/pampkin.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  )
  const mixer = new AnimationMixer(gltf.scene)
  const mount = gltf.scene.getObjectByName('Mount')!
  expect(mount.parent?.type).toBe('Bone')
  expect(gltf.animations.map(({ name }) => name).sort()).toEqual(['ATTACK', 'DEATH', 'IDLE', 'RUN'])
  expect(gltf.animations.find(({ name }) => name === 'DEATH')!.duration).toBe(1)
  for (const name of ['IDLE', 'RUN']) {
    const clip = gltf.animations.find((entry) => entry.name === name)!
    for (const track of clip.tracks) {
      const size = track.getValueSize()
      for (let index = 0; index < size; index += 1) {
        expect(track.values[index]!).toBeCloseTo(track.values[track.values.length - size + index]!, 5)
      }
    }
    mixer.stopAllAction()
    mixer.clipAction(clip).play()
    mixer.setTime(0)
    gltf.scene.updateMatrixWorld(true)
    if (name === 'IDLE') {
      // Glide shaders read this socket basis; a bone-axis rotation points trails into the sky.
      const up = new Vector3().setFromMatrixColumn(mount.matrixWorld, 1).normalize()
      const forward = new Vector3().setFromMatrixColumn(mount.matrixWorld, 2).normalize()
      expect(up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(0.0001)
      expect(forward.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(0.0001)
    }
    const start = mount.getWorldPosition(new Vector3())
    const wing = gltf.scene.getObjectByName('WingL') ?? gltf.scene.getObjectByName('Wing.L')!
    const rotation = wing.quaternion.clone()
    mixer.setTime(clip.duration / 8)
    gltf.scene.updateMatrixWorld(true)
    expect(mount.getWorldPosition(new Vector3()).distanceTo(start)).toBeGreaterThan(0.001)
    expect(wing.quaternion.angleTo(rotation)).toBeGreaterThan(0.1)
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(gltf.scene)
  gltf.scene.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
    mesh.skeleton.dispose()
  })
})
