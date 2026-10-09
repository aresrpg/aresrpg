// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Normal blending, caustics and depth-checked refraction adapted from norio's Genshin
// water preset (MIT, MatrixRex / norio). Attribution: seed/textures/water/LICENSE.
import { DepthTexture, FramebufferTexture, LinearMipmapLinearFilter, RepeatWrapping, TextureLoader } from 'three'
import {
  cameraFar,
  cameraProjectionMatrixInverse,
  cameraViewMatrix,
  cameraWorldMatrix,
  cameraPosition,
  cross,
  dFdx,
  dFdy,
  float,
  mix,
  getViewPosition,
  positionView,
  positionWorld,
  screenUV,
  smoothstep,
  texture,
  time,
  vec2,
  vec3,
  vec4,
  viewportTexture,
} from 'three/tsl'
import type { Node } from 'three/webgpu'

import { create_viewport_capture } from './viewport_capture.ts'

/** Each surface owns three small repeat textures and its color/depth copy nodes. */
export const create_water_optics = () => {
  const loader = new TextureLoader()
  const load = (url: string) => {
    const map = loader.load(url, undefined, undefined, (error) =>
      console.error('[engine] water texture failed', url, error)
    )
    map.wrapS = map.wrapT = RepeatWrapping
    map.minFilter = LinearMipmapLinearFilter
    map.anisotropy = 4
    return map
  }
  const normal_map = load(new URL('../../../seed/textures/water/normal.png', import.meta.url).href)
  const caustics_map = load(new URL('../../../seed/textures/water/caustics.png', import.meta.url).href)
  const noise_map = load(new URL('../../../seed/textures/water/noise.png', import.meta.url).href)
  const color_copy = create_viewport_capture(viewportTexture(screenUV, null, new FramebufferTexture(1, 1)))
  const depth_copy = create_viewport_capture(viewportTexture(screenUV, null, new DepthTexture(1, 1)))
  const uv = positionWorld.xz.mul(0.1)
  const normal_a = texture(normal_map, uv.mul(1.5).sub(time.mul(0.065)))
    .xyz.mul(2)
    .sub(1)
  const normal_b = texture(normal_map, uv.mul(3).add(time.mul(0.13)))
    .xyz.mul(2)
    .sub(1)
  const slopes = normal_a.xy.add(normal_b.xy).mul(0.5).toVar()
  const distance = positionWorld.distance(cameraPosition)
  const detail = float(1).sub(smoothstep(25, 120, distance))
  const normal = vec3(slopes.x.mul(-0.7), 1, slopes.y.mul(-0.7)).normalize()
  const surface_normal = mix(vec3(0, 1, 0), normal, detail.mul(0.8).add(0.2)).normalize()
  const noise = texture(noise_map, uv.mul(0.91).add(vec2(0.01, 0.001).mul(time))).r
  const scene_position = (at: Node<'vec2'>) => getViewPosition(at, depth_copy.sample(at), cameraProjectionMatrixInverse)

  const sample = () => {
    const eye_depth = positionView.z.negate()
    const bed_view = scene_position(screenUV).toVar()
    const scene_eye = bed_view.z.negate()
    // Differentiate camera-relative positions. At distant world coordinates, subtracting
    // absolute positions loses subpixel precision and can collapse the reconstructed normal.
    const bed_relative = cameraWorldMatrix.mul(vec4(bed_view, 0)).xyz
    const bed_position = cameraPosition.add(bed_relative)
    const depth = scene_eye
      .greaterThan(cameraFar.mul(0.99))
      .select(float(100), positionWorld.y.sub(bed_position.y).max(0))
      .toVar()
    // Project world slopes into the current view. Texture motion is world anchored, not camera anchored.
    const view_normal = cameraViewMatrix.mul(vec4(surface_normal.sub(vec3(0, 1, 0)), 0)).xyz
    const edge = smoothstep(0, 0.08, screenUV.x)
      .mul(float(1).sub(smoothstep(0.92, 1, screenUV.x)))
      .mul(smoothstep(0, 0.08, screenUV.y))
      .mul(float(1).sub(smoothstep(0.92, 1, screenUV.y)))
    const offset = vec2(view_normal.x, view_normal.y.negate())
      .mul(0.025)
      .mul(edge)
      .mul(smoothstep(0, 0.6, depth))
      .mul(detail)
    const distorted = screenUV.add(offset).clamp(0.001, 0.999)
    const behind = scene_position(distorted).z.negate().sub(eye_depth)
    // Fade the offset at opaque foreground silhouettes instead of pulling dry objects into water.
    const refraction_uv = screenUV.add(offset.mul(smoothstep(0.05, 0.4, behind)))
    const scene_color = color_copy.sample(refraction_uv).rgb
    const bed_uv = bed_position.xz.mul(0.3)
    const bed_face = cross(dFdx(bed_relative), dFdy(bed_relative))
    // A zero-area derivative has no caustic contribution, not an undefined normalized vector.
    const bed_up = bed_face.y.abs().div(bed_face.length().max(1e-8))
    const drift = time.mul(0.02)
    const caustics = texture(caustics_map, bed_uv.add(drift).add(slopes.mul(0.025)))
      .r.min(texture(caustics_map, bed_uv.mul(1.3).sub(drift)).r)
      .mul(float(1).sub(smoothstep(0.5, 6, depth)))
      .mul(smoothstep(0.1, 0.5, depth))
      .mul(bed_up)
      .mul(detail)
      .mul(0.25)
    // Genshin has shoreline rings but no ocean-wide surface foam. Dissolve the rings into broken strokes.
    const shore_depth = depth.mul(-2).exp()
    const shore_phase = shore_depth.add(time.mul(0.05)).mul(5)
    const rings = smoothstep(-0.1665, 0.8335, shore_phase.fract()).min(
      smoothstep(-0.1665, 0.8335, shore_phase.negate().fract())
    )
    const dissolved = rings.mul(float(1).sub(noise.mul(1.17)))
    const foam = smoothstep(0.48, 0.52, mix(dissolved, rings, shore_depth.mul(0.44))).mul(
      smoothstep(0.505, 0.856, shore_depth)
    )
    return { depth, scene_color, caustics, foam }
  }

  return {
    normal: surface_normal,
    ripple: slopes.x.add(slopes.y),
    sample,
    dispose: () => {
      normal_map.dispose()
      caustics_map.dispose()
      noise_map.dispose()
      color_copy.dispose()
      depth_copy.dispose()
    },
  }
}
