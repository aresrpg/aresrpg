// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The STAR GATE — every world's portal stands at its center (client 0;0, the chain's own
// travel law). One vertical emissive disc: a log-polar swirl of fractal simplex noise ported
// from the owner's reference shader (cmzw_ — celestianmaze), unlit and fullbright so it reads
// as a hole in the world at any hour. It RIDES the flatten projection — its ground follows the
// flattened surface, so the gate stands in every mode; dressing never fights the grid.

import { CircleGeometry, DoubleSide, Mesh, Vector3, type Scene } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { float, mix, mx_fractal_noise_vec3, positionLocal, smoothstep, time, vec3 } from 'three/tsl'

import { flat_terrain_amount, project_height } from './flatten.ts'
import { sample_world_column, type CompiledWorld } from './world_recipe.ts'

const PORTAL_RADIUS = 7
/** the disc's bottom two fifths sit under the terrain — rooted in the world, not floating */
const SUNK_FRACTION = 0.4
/** past this range the disc hides entirely — a full-screen fractal shader is never free */
const CULL_RANGE_SQUARED = 120 * 120
const FREQUENCY = 1.4
/** 5 octaves read as mush through motion anyway — each octave is a full 3D simplex pass per
 *  FRAGMENT, and the disc covers the spawn view: octaves are the whole perf story here */
const OCTAVES = 3
const DISTORTION = 0.01
const EMISSION_COLOR = [0.961, 0.592, 0.078] as const
/** AgX tone mapping compresses brights — the reference's raw output needs this to stay molten */
const GAIN = 1.9

export const create_portal_material = ({
  radius,
  emission_color,
  gain = GAIN,
}: Readonly<{ radius: number; emission_color: readonly [number, number, number]; gain?: number }>) => {
  const uv = positionLocal.xy.div(radius)
  const dir = vec3(uv.x, uv.y, float(0.5)).normalize()
  const spun = dir.z.sub(time.mul(0.2))
  const angle = uv.length().max(1e-4).log().div(Math.LN2).negate()
  const cos_a = angle.cos()
  const sin_a = angle.sin()
  const rotated = vec3(dir.x.mul(cos_a).sub(dir.y.mul(sin_a)), dir.x.mul(sin_a).add(dir.y.mul(cos_a)), spun)
  const noise = mx_fractal_noise_vec3(rotated.mul(FREQUENCY), OCTAVES, 2, 0.5).add(DISTORTION)
  const glow_field = noise
    .mul(2)
    .sub(0.1)
    .mul(0.188)
    .add(vec3(uv.x, uv.y, 0))
  const strength = float(0.77).sub(glow_field.length()).mul(4.2)
  const emission = vec3(...emission_color).mul(strength.mul(0.4))
  const fracture = noise.add(0.32).normalize()
  const fac = uv.length().sub(fracture.x.max(fracture.y).max(fracture.z)).add(0.1).mul(3.0)
  const color = mix(emission, vec3(fac), fac.add(1.2))
  const rim = smoothstep(0.86, 1.0, uv.length()).oneMinus()
  const white_wash = fac.add(1.2).clamp(0, 1)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  material.colorNode = color.mul(gain)
  material.opacityNode = rim.mul(white_wash.oneMinus())
  material.alphaTest = 0.02
  material.fog = true
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
  set_flatten: (amount: number) => void
  dispose: () => void
}>

export const create_portal = ({
  scene,
  world,
}: Readonly<{
  scene: Scene
  world: CompiledWorld
}>): Portal => {
  const base_y = sample_world_column(world, 0, 0).surface_y
  let center_y = base_y + PORTAL_RADIUS * (1 - 2 * SUNK_FRACTION)
  let active = true

  const material = create_portal_material({ radius: PORTAL_RADIUS, emission_color: EMISSION_COLOR })

  const geometry = new CircleGeometry(PORTAL_RADIUS, 64)
  const disc = new Mesh(geometry, material)
  disc.position.set(0, center_y, 0)
  // Terrain owns the first presented frame. The backend reveals dressing only after that frame;
  // compiling this multi-octave material before ground exists stalls the whole scene boot.
  disc.visible = false
  disc.renderOrder = 2
  disc.matrixAutoUpdate = false
  disc.updateMatrix()
  scene.add(disc)

  return Object.freeze({
    label_anchor: () => new Vector3(0, center_y + PORTAL_RADIUS * 0.35 + 1.0, 0),
    /** the disc's ground follows the flatten projection — the gate stands in flat mode too */
    set_flatten: (amount: number): void => {
      center_y = project_height(base_y, flat_terrain_amount(amount)) + PORTAL_RADIUS * (1 - 2 * SUNK_FRACTION)
      disc.position.y = center_y
      disc.updateMatrix()
    },
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
