// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Node } from 'three/webgpu'
import { cos, float, Fn, If, mix, sin, uint, varying, vec2, vec3 } from 'three/tsl'

import { canopy_light_visibility } from './canopy_lighting.ts'
import { CANOPY_TILT, CANOPY_YAW_OFFSET, CANOPY_YAW_STEP } from './canopy_transforms.ts'

/** Six outward-facing quads form a compact, opaque leaf volume in the existing terrain pool. */
export const opaque_leaf_nodes = (
  word_a: Node<'uint'>,
  word_b: Node<'uint'>,
  corner_u: Node<'float'>,
  corner_v: Node<'float'>,
  origin: Node<'vec3'>
) => {
  const face = word_a.shiftRight(uint(28)).bitAnd(uint(7))
  const amount = face.greaterThanEqual(uint(6)).select(float(1), float(0))
  const back = face.equal(uint(7))
  const u = back.select(float(1).sub(corner_u), corner_u)
  const axis = word_b.shiftRight(uint(18)).bitAnd(uint(3))
  const tex_u = u
  const tex_v = corner_v
  const leaf_uv = varying(vec2(tex_u, tex_v))
  const scale = float(word_b.shiftRight(uint(12)).bitAnd(uint(63))).mul(0.25)
  const horizontal = tex_u.sub(0.5).mul(scale)
  const vertical = float(0.5).sub(tex_v).mul(scale)
  const plane_x = axis.equal(uint(0)).select(float(1), float(0))
  const plane_y = axis.equal(uint(1)).select(float(1), float(0))
  const plane_z = axis.equal(uint(2)).select(float(1), float(0))
  const side = back.select(float(-1), float(1)).mul(scale).mul(0.5)
  const offset = vec3(
    horizontal.mul(plane_x.add(plane_z)).add(plane_y.mul(side)),
    vertical.mul(plane_x.add(plane_y)).add(plane_z.mul(side)),
    horizontal.mul(plane_y).add(vertical.mul(plane_z)).sub(plane_x.mul(side))
  )
  const center = vec3(
    float(word_a.bitAnd(uint(63))),
    float(word_a.shiftRight(uint(6)).bitAnd(uint(63))),
    float(word_a.shiftRight(uint(12)).bitAnd(uint(63)))
  ).add(origin)
  const yaw = float(word_b.shiftRight(uint(28)))
    .mul(CANOPY_YAW_STEP)
    .add(CANOPY_YAW_OFFSET)
  const tilted = vec3(
    vec3(...CANOPY_TILT[0]!).dot(offset),
    vec3(...CANOPY_TILT[1]!).dot(offset),
    vec3(...CANOPY_TILT[2]!).dot(offset)
  )
  const rotated = vec3(
    tilted.x.mul(cos(yaw)).add(tilted.z.mul(sin(yaw))),
    tilted.y,
    tilted.z.mul(cos(yaw)).sub(tilted.x.mul(sin(yaw)))
  )
  const position = center.sub(vec3(1)).add(rotated)
  // Faces share a softly rounded lighting volume. A source voxel face must not stamp
  // its normal across a whole clump, and camera motion must never reverse diffuse light.
  const leaf_normal = rotated
    .div(scale)
    .mul(vec3(0.25, 0, 0.25))
    .add(vec3(0, 1, 0))
    .normalize()

  // This is the clump's lighting volume, not the card's geometric normal. Flipping it
  // toward the camera reverses diffuse sunlight below the canopy and creates black slabs.

  const select_vec3 = (voxel: Node<'vec3'>, foliage: Node<'vec3'>): Node<'vec3'> =>
    Fn(() => {
      const result = vec3().toVar()
      If(amount.greaterThan(0.5), () => {
        result.assign(foliage)
      }).Else(() => {
        result.assign(voxel)
      })
      return result
    })() as Node<'vec3'>

  return {
    position: (voxel: Node<'vec3'>) => select_vec3(voxel, position),
    uv: (voxel: Node<'vec2'>) => mix(voxel, leaf_uv, amount),
    shadow: (voxel: Node<'float'>) =>
      mix(voxel, mix(float(canopy_light_visibility(0)), float(canopy_light_visibility(1)), voxel.clamp(0, 1)), amount),
    // Rounded, upward-facing leaf normals are an artistic diffuse basis. They cannot also
    // drive a physical specular lobe: underside views create a false grazing-sun hotspot.
    specular: (voxel: Node<'float'>) => mix(voxel, float(0), amount),
    normal: (voxel: Node<'vec3'>) => select_vec3(voxel, leaf_normal),
  }
}

const unchanged = (node: Node<'vec3'>): Node<'vec3'> => node
export const opaque_voxel_nodes = () => ({
  position: unchanged,
  normal: unchanged,
  uv: (node: Node<'vec2'>) => node,
  shadow: (node: Node<'float'>) => node,
  specular: (node: Node<'float'>) => node,
})
