// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Baked once so the double-jump dust uses one renderer-neutral sprite path on WebGPU and WebGL.

import { DataTexture, RGBAFormat, UnsignedByteType } from 'three'

const SIZE = 32
const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)
const smoothstep = (from: number, to: number, value: number): number => {
  const position = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return position * position * (3 - 2 * position)
}

export const create_dust_texture = (): DataTexture => {
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y += 1)
    for (let x = 0; x < SIZE; x += 1) {
      const u = (x + 0.5) / SIZE
      const v = (y + 0.5) / SIZE
      const radius = Math.hypot(u - 0.5, v - 0.5)
      const billow = Math.sin(u * 19 + v * 23) * 0.045 + Math.sin(u * -31 + v * 13) * 0.025
      const body = 1 - smoothstep(0.2, 0.52, radius + billow)
      const offset = (y * SIZE + x) * 4
      data[offset] = byte(0.4 + 0.24 * body)
      data[offset + 1] = byte(0.35 + 0.23 * body)
      data[offset + 2] = byte(0.29 + 0.18 * body)
      data[offset + 3] = byte(body)
    }
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType)
  texture.needsUpdate = true
  return texture
}
