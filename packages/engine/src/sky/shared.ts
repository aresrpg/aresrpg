// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { NoColorSpace, Texture, TextureLoader } from 'three'
import type { Node } from 'three/webgpu'
import { vec2, vec3 } from 'three/tsl'

export type Rgb = readonly [number, number, number]
export type SkyPalette = Readonly<{ zenith: Rgb; horizon: Rgb; nadir: Rgb }>

export const SKY_NIGHT: SkyPalette = {
  zenith: [0.02, 0.03, 0.07],
  horizon: [0.05, 0.07, 0.13],
  nadir: [0.02, 0.02, 0.04],
}

export const MOON_DISC_COS = Math.cos(0.026)
export const MOON_DISC_RGB: Rgb = [0.78, 0.85, 1]
export const MOON_ANGULAR_RADIUS = Math.acos(MOON_DISC_COS)
export const MOON_DISC_INNER_COS = Math.cos(0.017)
export const MOON_LIMB_EDGE = 0.7

const MOON_TEXTURE_URL = new URL('../../../../seed/icons/world/moon.png', import.meta.url).href
let moon_texture_cache: Texture | null = null

export const moon_texture = (): Texture => {
  if (moon_texture_cache) return moon_texture_cache
  if (typeof document === 'undefined') {
    moon_texture_cache = new Texture()
    return moon_texture_cache
  }
  moon_texture_cache = new TextureLoader().load(MOON_TEXTURE_URL)
  moon_texture_cache.colorSpace = NoColorSpace
  return moon_texture_cache
}

const cross3 = (a: Rgb, b: Rgb): Rgb => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot3 = (a: Rgb, b: Rgb): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm3 = (value: Rgb): Rgb => {
  const length = Math.sqrt(dot3(value, value)) || 1e-6
  return [value[0] / length, value[1] / length, value[2] / length]
}

export const disc_space_uv_js = (view_direction: Rgb, body_direction: Rgb): readonly [number, number] => {
  const tangent_u = norm3(cross3([0, 1, 0], body_direction))
  const tangent_v = cross3(body_direction, tangent_u)
  return [dot3(view_direction, tangent_u), dot3(view_direction, tangent_v)]
}

export const disc_space_uv = (view_direction: Node<'vec3'>, body_direction: Node<'vec3'>): Node<'vec2'> => {
  const tangent_u = vec3(0, 1, 0).cross(body_direction).normalize()
  const tangent_v = body_direction.cross(tangent_u)
  return vec2(view_direction.dot(tangent_u), view_direction.dot(tangent_v))
}
