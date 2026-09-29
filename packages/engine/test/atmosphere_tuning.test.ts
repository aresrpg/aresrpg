// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { PerspectiveCamera } from 'three'
import type { Renderer } from 'three/webgpu'

import { resolve_atmosphere_tuning } from '../src/atmosphere_tuning.ts'
import { create_hillaire_sky } from '../src/sky/hillaire/hillaire_sky.ts'

test('preview settings reject non-finite inputs, bound coefficients and keep the haze range ordered', () => {
  const defaults = resolve_atmosphere_tuning('clear')
  const value = resolve_atmosphere_tuning('clear', { density: NaN, near: 900, full: 100, mie_g: 1, exposure: -3 })
  expect(value.density).toBe(defaults.density)
  expect(value.full).toBeGreaterThan(value.near)
  expect(value.mie_g).toBeLessThan(1)
  expect(value.exposure).toBeGreaterThan(0)
  expect(resolve_atmosphere_tuning('clear')).toEqual(defaults)
})

test('live controls reach Hillaire uniforms and reset to the current world preset', () => {
  const sky = create_hillaire_sky({ tier: 'high', atmosphere: 'clear' })
  try {
    const defaults = resolve_atmosphere_tuning('clear')
    expect(sky.U.exposure.value).toBe(defaults.exposure)
    expect(sky.U.mie_scattering.value).toBe(defaults.mie_scattering)
    sky.set_tuning({ density: 6, height_density: 0.002, height_falloff: 50, horizon_cap: 0.7, exposure: 4, mie_g: 0.6 })
    expect(sky.art.haze_density.value).toBe(6)
    expect(sky.art.height_density.value).toBe(0.002)
    expect(sky.art.height_falloff.value).toBe(1 / 50)
    expect(sky.art.horizon_cap.value).toBe(0.7)
    expect(sky.U.exposure.value).toBe(4)
    expect(sky.U.mie_g.value).toBe(0.6)
    sky.set_tuning(null)
    expect(sky.art.haze_density.value).toBe(defaults.density)
    expect(sky.art.height_density.value).toBe(defaults.height_density)
    expect(sky.U.exposure.value).toBe(defaults.exposure)
    expect(sky.U.mie_g.value).toBe(defaults.mie_g)
  } finally {
    sky.dispose()
  }
})

test('dragging haze controls does not rebuild physical LUTs; scattering changes do', async () => {
  let dispatches = 0
  const renderer = {
    computeAsync: async () => {},
    compute: () => {
      dispatches += 1
    },
  } as unknown as Renderer
  const sky = create_hillaire_sky({ tier: 'high', atmosphere: 'clear' })
  const camera = new PerspectiveCamera()
  camera.position.y = 80
  camera.updateMatrixWorld()
  try {
    await sky.bake(renderer)
    sky.tick(renderer, camera, 0)
    dispatches = 0
    sky.set_tuning({ density: 8, horizon_cap: 0.6 })
    sky.tick(renderer, camera, 0)
    expect(dispatches).toBe(0)
    sky.set_tuning({ mie_g: 0.5 })
    sky.tick(renderer, camera, 0)
    expect(dispatches).toBe(4)
  } finally {
    sky.dispose()
  }
})
