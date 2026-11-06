// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRequire } from 'node:module'

const require = createRequire(new URL('../packages/frontend/package.json', import.meta.url))
const { createCanvas } = require('@napi-rs/canvas')

/** Native polygon rasterization is stable; compose alpha explicitly to avoid SIMD-specific rounding. */
export const raster_portrait_coverage = ({ polygons, exclude }) => {
  const ctx = createCanvas(1024, 1024).getContext('2d')
  const coverage = new Uint8Array(1024 * 1024)
  ctx.fillStyle = 'white'
  for (const [erase, paths] of [
    [false, polygons],
    [true, exclude],
  ]) {
    for (const points of paths) {
      ctx.clearRect(0, 0, 1024, 1024)
      ctx.beginPath()
      points.forEach(([x, y], index) => (index ? ctx.lineTo(x * 2, y * 2) : ctx.moveTo(x * 2, y * 2)))
      ctx.closePath()
      ctx.fill()
      const pixels = ctx.getImageData(0, 0, 1024, 1024).data
      for (let pixel = 0; pixel < coverage.length; pixel++) {
        const alpha = pixels[pixel * 4 + 3]
        const retained = Math.round((coverage[pixel] * (255 - alpha)) / 255)
        coverage[pixel] = retained + (erase ? 0 : alpha)
      }
    }
  }
  return coverage
}
