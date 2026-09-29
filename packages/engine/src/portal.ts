// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The portal is a refractive membrane fitted to the shared voxel arch profile.
// Local-space flow bends the scene behind it; depth rejection protects foreground silhouettes.

import {
  BufferAttribute,
  BufferGeometry,
  DepthTexture,
  FramebufferTexture,
  DoubleSide,
  Mesh,
  Vector3,
  type Scene,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  cameraFar,
  cameraNear,
  cameraPosition,
  float,
  fwidth,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  mx_fractal_noise_vec3,
  output,
  perspectiveDepthToViewZ,
  positionLocal,
  positionView,
  positionWorld,
  screenUV,
  smoothstep,
  time,
  vec2,
  vec3,
  vec4,
  viewportTexture,
} from 'three/tsl'

import { create_viewport_capture } from './viewport_capture.ts'
import { PORTAL_ARCH, portal_opening_columns } from './portal_shape.ts'
import { sample_world_column, type CompiledWorld } from './world_recipe.ts'

/** past this range the disc hides entirely — a full-screen fractal shader is never free */
const CULL_RANGE_SQUARED = 120 * 120
const EMISSION_COLOR = [0.06, 0.38, 1] as const
const GAIN = 1.9

export const create_portal_material = ({
  emission_color,
  gain = GAIN,
}: Readonly<{
  emission_color: readonly [number, number, number]
  gain?: number
}>) => {
  const arch_height = PORTAL_ARCH.spring_height + PORTAL_ARCH.half_width
  const uv = positionLocal.xy.sub(vec2(0, arch_height / 2)).div(vec2(PORTAL_ARCH.half_width, arch_height / 2))
  const flow = mx_fractal_noise_vec3(
    vec3(uv.mul(vec2(1.7, 2.5)).add(vec2(time.mul(0.07), time.mul(-0.34))), time.mul(0.13)),
    2,
    2,
    0.5
  ).toVar()
  const column_x = positionLocal.x.floor().add(0.5)
  const roof = float(PORTAL_ARCH.half_width ** 2)
    .sub(column_x.pow(2))
    .max(0)
    .sqrt()
    .floor()
    .add(PORTAL_ARCH.spring_height)
  const edge = float(PORTAL_ARCH.half_width)
    .sub(positionLocal.x.abs())
    .min(roof.sub(positionLocal.y))
    .min(positionLocal.y)
  const seal = smoothstep(0, 0.22, edge)
  const distortion_gate = smoothstep(0.08, 0.7, edge)
  const perturbation = vec3(flow.xy.mul(0.45), 0)
  const view_flow = modelViewMatrix.mul(vec4(perturbation, 0)).xy
  const screen_edge = screenUV.min(screenUV.oneMinus()).x.min(screenUV.min(screenUV.oneMinus()).y)
  const offset = vec2(view_flow.x, view_flow.y.negate())
    .mul(0.035)
    .mul(distortion_gate)
    .mul(smoothstep(0, 0.06, screen_edge))
  const candidate_uv = screenUV.add(offset).clamp(0.001, 0.999)

  // Thin moving folds replace the opaque pinwheel. Derivatives soften subpixel ribbons at distance.
  const field = flow.x.add(uv.y.mul(5).sub(time.mul(0.8)).add(flow.y).sin().mul(0.22)).abs()
  const feather = fwidth(field).max(0.035)
  const ribbons = smoothstep(float(0.035).sub(feather), float(0.035).add(feather), field).oneMinus()
  const normal = modelWorldMatrix.mul(vec4(perturbation.add(vec3(0, 0, 1)).normalize(), 0)).xyz.normalize()
  const facing = cameraPosition.sub(positionWorld).normalize().dot(normal).abs().clamp(0, 1)
  const fresnel = facing.oneMinus().pow(3)
  const rim = edge.max(0).mul(-5).exp()
  const highlights = ribbons.mul(0.4).add(rim.mul(0.5)).add(fresnel.mul(0.25)).clamp(0, 1)
  const tint = vec3(...emission_color)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  material.forceSinglePass = true
  material.colorNode = tint.mul(highlights.mul(0.9).add(0.12)).mul(gain)
  material.opacityNode = seal
  material.alphaTest = 0.02
  material.fog = true
  const color_copy = create_viewport_capture(viewportTexture(screenUV, null, new FramebufferTexture(1, 1)))
  const depth_copy = create_viewport_capture(viewportTexture(screenUV, null, new DepthTexture(1, 1)))
  const destination_depth = perspectiveDepthToViewZ(depth_copy.sample(candidate_uv), cameraNear, cameraFar).negate()
  const behind = destination_depth.sub(positionView.z.negate())
  const sample_uv = screenUV.add(offset.mul(smoothstep(0.03, 0.3, behind)))
  const transmitted = color_copy.sample(sample_uv).rgb
  // Captured pixels are already lit and fogged; only the membrane's own glow receives fog.
  const film = highlights.mul(0.48).add(0.12).clamp(0, 0.75)
  material.outputNode = vec4(mix(output.rgb, transmitted.mul(tint.mul(0.12).add(0.88)), film.oneMinus()), output.a)
  material.addEventListener('dispose', () => {
    color_copy.dispose()
    depth_copy.dispose()
  })

  return material
}

export type Portal = Readonly<{
  /** where the approach tooltip anchors (a fixed point above the disc's crown) */
  label_anchor: () => Vector3
  /** per-frame viewer update — the disc hides entirely past CULL range (a full-screen
   *  fractal-noise shader is never free; it must not shade pixels it cannot earn) */
  tick: (viewer_x: number, viewer_y: number, viewer_z: number) => void
  /** World dressing leaves the scene for the entire fight-board lifetime. */
  set_active: (active: boolean) => void
  dispose: () => void
}>

/** Spawn and dungeon membranes share the exact stepped voxel opening. */
export const create_portal_geometry = (): BufferGeometry => {
  const geometry = new BufferGeometry(),
    positions: number[] = []
  portal_opening_columns().forEach(({ x, height }) =>
    positions.push(x, 0, 0, x + 1, 0, 0, x + 1, height, 0, x, 0, 0, x + 1, height, 0, x, height, 0)
  )
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeBoundingSphere()
  return geometry
}

export const create_portal = ({
  scene,
  world,
}: Readonly<{
  scene: Scene
  world: CompiledWorld
}>): Portal => {
  if (world.recipe.portal === false)
    return Object.freeze({
      label_anchor: () => new Vector3(),
      tick: () => {},
      set_active: () => {},
      dispose: () => {},
    })
  const base_y = sample_world_column(world, 0, 0).surface_y
  const arch_height = PORTAL_ARCH.spring_height + PORTAL_ARCH.half_width
  const center_y = base_y + arch_height / 2
  let active = true

  const material = create_portal_material({
    emission_color: EMISSION_COLOR,
  })

  const geometry = create_portal_geometry()
  const disc = new Mesh(geometry, material)
  disc.position.set(0, base_y, 0)
  // Terrain owns the first presented frame. The backend reveals dressing only after that frame;
  // compiling this multi-octave material before ground exists stalls the whole scene boot.
  disc.visible = false
  disc.renderOrder = 2
  disc.matrixAutoUpdate = false
  disc.updateMatrix()
  scene.add(disc)

  return Object.freeze({
    label_anchor: () => new Vector3(0, base_y + arch_height + 1, 0),
    tick: (viewer_x: number, viewer_y: number, viewer_z: number): void => {
      const dx = viewer_x - disc.position.x
      const dy = viewer_y - center_y
      const dz = viewer_z - disc.position.z
      disc.visible = active && dx * dx + dy * dy + dz * dz < CULL_RANGE_SQUARED
    },
    set_active: (next: boolean) => {
      active = next
      if (!active) disc.visible = false
    },
    dispose: () => {
      scene.remove(disc)
      geometry.dispose()
      material.dispose()
    },
  })
}
