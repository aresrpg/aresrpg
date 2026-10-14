// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector4, WebGPUCoordinateSystem } from 'three'

import { outline_strength, outline_width_texels } from '../src/outline.ts'

// The engine's scene camera planes and a 1080p focal length: the precision the pass really gets.
const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 3000)
camera.coordinateSystem = WebGPUCoordinateSystem
camera.updateProjectionMatrix()
const FOCAL_PIXELS = 540 / Math.tan((35 * Math.PI) / 180)

/** View distance → float32 depth buffer → the inverse depth the shader unprojects. */
const stored_inverse_depth = (distance: number): number => {
  const clip = new Vector4(0, 0, -distance, 1).applyMatrix4(camera.projectionMatrix)
  const view = new Vector4(0, 0, Math.fround(clip.z / clip.w), 1).applyMatrix4(camera.projectionMatrixInverse)
  return -view.w / view.z
}

type Surface = (pixel_x: number, pixel_y: number) => number

/** A flat face `normal · point = offset` in view space, as view distance per pixel. */
const plane =
  (normal: readonly [number, number, number], offset: number): Surface =>
  (pixel_x, pixel_y) =>
    offset / (normal[0] * (pixel_x / FOCAL_PIXELS) + normal[1] * (pixel_y / FOCAL_PIXELS) - normal[2])

const strength_at = (surface: Surface, pixel_x: number, pixel_y: number): number =>
  outline_strength({
    centre: stored_inverse_depth(surface(pixel_x, pixel_y)),
    left: stored_inverse_depth(surface(pixel_x - 1, pixel_y)),
    right: stored_inverse_depth(surface(pixel_x + 1, pixel_y)),
    up: stored_inverse_depth(surface(pixel_x, pixel_y - 1)),
    down: stored_inverse_depth(surface(pixel_x, pixel_y + 1)),
  })

/** A terrace facing the camera whose rim sits at pixel column 0, with the ground `drop` behind it. */
const terrace =
  (distance: number, drop: number): Surface =>
  (pixel_x) =>
    pixel_x <= 0 ? distance : distance + drop

describe('ink outline', () => {
  test('the unprojection recovers inverse view depth from the stored depth', () => {
    for (const distance of [0.5, 12, 140]) expect(stored_inverse_depth(distance) * distance).toBeCloseTo(1, 3)
  })

  test('flat ground at a grazing angle draws no line at any range', () => {
    const ground = plane([0, 1, 0], -1.6)
    for (const pixel_y of [-400, -120, -40, -14]) expect(strength_at(ground, 37, pixel_y)).toBe(0)
  })

  test('a one-block hidden drop is fully inked on its nearer side only', () => {
    for (const distance of [6, 30, 65]) {
      expect(strength_at(terrace(distance, 1), 0, 0)).toBe(1)
      expect(strength_at(terrace(distance, 1), 1, 0)).toBe(0)
    }
  })

  test('a line keeps its CSS width in whole depth texels on every display density', () => {
    // 0.3: a huge canvas under the pixel cap. 1.2: a capped dense ultrawide. 2: an uncapped dense display.
    expect([0.3, 0.82, 1, 1.2, 2].map(outline_width_texels)).toEqual([1, 2, 2, 2, 4])
  })

  test('small relief stays clean and distant drops dissolve', () => {
    expect(strength_at(terrace(20, 0.2), 0, 0)).toBe(0)
    expect(strength_at(terrace(110, 1), 0, 0)).toBeGreaterThan(0)
    expect(strength_at(terrace(110, 1), 0, 0)).toBeLessThan(1)
    expect(strength_at(terrace(160, 1), 0, 0)).toBe(0)
  })
})
