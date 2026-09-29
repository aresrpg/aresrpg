// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import { DepthTexture, DirectionalLight, PerspectiveCamera, RenderTarget, Vector3 } from 'three'
import { NodeMaterial } from 'three/webgpu'
import { float, texture, uniform } from 'three/tsl'

import { create_local_shafts } from '../src/local_shafts.ts'
import { local_shaft_depth_weight, local_shaft_interval } from '../src/local_shafts_math.ts'
import { QUALITY_PROFILES } from '../src/quality.ts'
import { validate_scenery, type SceneryVolume } from '../src/scenery_data.ts'

const volume: SceneryVolume = { center: [128, 83, 123], size: [64, 28, 54] }

test('the integration stops at opaque depth, volume bounds, and the hard distance limit', () => {
  expect(local_shaft_interval([128, 74, 108], [0, 0, 1], volume, 8)).toEqual([0, 8])
  expect(local_shaft_interval([128, 74, 108], [0, 0, 1], volume, 80)).toEqual([0, 42])
  expect(local_shaft_interval([128, 74, 108], [0, 1, 0], volume, 6)).toEqual([0, 6])
  expect(local_shaft_interval([128, 74, 50], [0, 0, 1], volume, 80)).toEqual([46, 80])
  expect(local_shaft_interval([128, 74, 50], [0, 0, -1], volume, 80)).toBeNull()
  expect(local_shaft_interval([0, 74, 108], [0, 0, 1], volume, 80)).toBeNull()
  expect(local_shaft_interval([128, 74, 108], [0, 0, 1], volume, 0)).toBeNull()
})

test('depth-aware reconstruction rejects light from behind nearby opaque silhouettes', () => {
  expect(local_shaft_depth_weight(8, 8)).toBe(1)
  expect(local_shaft_depth_weight(8.1, 8)).toBeGreaterThan(0.9)
  expect(local_shaft_depth_weight(40, 8)).toBe(0)
  expect(local_shaft_depth_weight(8, 40)).toBe(0)
})

test('only High budgets the bounded pass and seed cannot author sampling costs', () => {
  expect(QUALITY_PROFILES.low.effects.local_shafts).toBeNull()
  expect(QUALITY_PROFILES.medium.effects.local_shafts).toBeNull()
  expect(QUALITY_PROFILES.high.effects.local_shafts.samples).toBeLessThanOrEqual(32)
  expect(QUALITY_PROFILES.high.effects.local_shafts.resolution).toBeLessThanOrEqual(0.35)
  const scenery = { waterfalls: [], vines: [], spores: [], light_shafts: [volume] }
  expect(validate_scenery(scenery)).toEqual([])
  expect(validate_scenery({ ...scenery, light_shafts: Array(5).fill(volume) })).toHaveLength(1)
  expect(validate_scenery({ ...scenery, light_shafts: null })).toHaveLength(1)
  expect(validate_scenery({ ...scenery, light_shafts: [{ ...volume, size: [1000, 1, 1] }] })).toHaveLength(1)
})

test('quality changes and teardown never dispose or resize the borrowed sun shadow map', () => {
  const camera = new PerspectiveCamera(68, 1.6, 0.1, 3000)
  camera.position.set(128, 74, 108)
  camera.lookAt(128, 83, 130)
  camera.updateMatrixWorld()
  const sun = new DirectionalLight()
  sun.castShadow = true
  const borrowed = new RenderTarget(2048, 2048, { depthTexture: new DepthTexture(2048, 2048) })
  sun.shadow.map = borrowed
  let disposed = 0
  borrowed.addEventListener('dispose', () => {
    disposed += 1
  })
  borrowed.depthTexture!.addEventListener('dispose', () => {
    disposed += 1
  })
  const scene_depth = texture(new DepthTexture(16, 16))

  const options = {
    camera,
    sun,
    scene_depth,
    sun_direction: uniform(new Vector3(0, 1, 0)),
    environment: {
      scenery: { waterfalls: [], vines: [], spores: [], light_shafts: [volume] },

      clouds: { shadow_at: () => float(1) },
    },
  }
  const release_material = spyOn(NodeMaterial.prototype, 'dispose')
  const release_target = spyOn(RenderTarget.prototype, 'dispose')
  try {
    for (const quality of ['high', 'medium', 'low', 'high'] as const) {
      const effect = create_local_shafts({ ...options, config: QUALITY_PROFILES[quality].effects.local_shafts })
      effect.update(false)
      expect(effect.active.value).toBe(Number(quality === 'high'))
      sun.shadow.intensity = 0
      effect.update(false)
      expect(effect.active.value).toBe(0)
      sun.shadow.intensity = 1
      sun.shadow.map = null
      effect.update(false)
      expect(effect.active.value).toBe(0)
      sun.shadow.map = borrowed
      options.sun_direction.value.set(0, -1, 0)
      effect.update(false)
      expect(effect.active.value).toBe(0)
      options.sun_direction.value.set(0, 1, 0)
      effect.update(true)
      expect(effect.active.value).toBe(0)
      effect.dispose()
    }
    expect(release_material).toHaveBeenCalledTimes(2)
    expect(release_target).toHaveBeenCalledTimes(2)
  } finally {
    release_material.mockRestore()
    release_target.mockRestore()
  }
  expect(disposed).toBe(0)
  expect(sun.shadow.map).toBe(borrowed)
  expect([borrowed.width, borrowed.height]).toEqual([2048, 2048])
  scene_depth.value.dispose()
  borrowed.dispose()
})
