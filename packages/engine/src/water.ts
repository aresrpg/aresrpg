// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Genshin-inspired calm water. Rendered terrain depth owns the shore, transmission and
// caustics. One surface shader serves world seas and fight basins on every quality tier.

import { PlaneGeometry, DoubleSide, Mesh, type Scene, type DirectionalLight, type HemisphereLight } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  getViewPosition,
  positionView,
  screenUV,
  clamp,
  float,
  max,
  mix,
  output,
  positionWorld,
  pow,
  reflect,
  reference,
  smoothstep,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'

import { TRANSPARENT_ORDER } from './transparent_order.ts'
import { frozen_shore } from './frozen_water.ts'
import { create_water_reflection } from './water_reflection.ts'
import { water_glow_reflections } from './water_glows.ts'
import type { SceneryGlow } from './scenery_data.ts'
import type { Clouds } from './clouds.ts'
import { occlusion_fade_node, type BoardOcclusion } from './board_occlusion.ts'
import type { LiquidPalette } from './liquid_palette.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import type { EngineQuality } from './types.ts'
import { create_water_optics } from './water_optics.ts'
import type { CompiledWorld } from './world_recipe.ts'

type WaterLights = Readonly<{ key: DirectionalLight; ambient: HemisphereLight }>

type WaterSky = Pick<ReturnType<typeof create_sky_node>, 'sample_sky_dome' | 'sun_direction'>

export type Water = Readonly<{
  illumination: Node<'vec3'>
  set_sky: (sample: WaterSky['sample_sky_dome']) => void
  set_visible: (visible: boolean) => void
  set_focus: (x: number, z: number) => void
  set_quality: (quality: EngineQuality) => void
  dispose: () => void
}>

const WATER_SIGMA = [0.18, 0.045, 0.025] as const
const build_material = (
  sky: WaterSky,
  cloud_light: Node<'float'>,
  palette: LiquidPalette,
  optics: ReturnType<typeof create_water_optics>,
  visibility: Node<'float'>,
  glows: readonly SceneryGlow[],
  reflection: ReturnType<typeof create_water_reflection> | null,
  frozen: boolean,
  illumination: Node<'vec3'>
): MeshBasicNodeMaterial => {
  // The same surface remains visible from below when diving.
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  material.forceSinglePass = true
  // Every diffuse constituent follows this one illumination term, including Low, foam and ice.
  // Reflections and authored lights already carry radiance and must not be multiplied twice.
  const daylight = smoothstep(-0.08, 0.18, sky.sun_direction.y)
  const diffuse_light = illumination
  const { normal, ripple } = optics
  // Unproject the near plane so perspective, orthographic and blended fight cameras agree.
  const view = cameraWorldMatrix
    .mul(vec4(getViewPosition(screenUV, float(0), cameraProjectionMatrixInverse).sub(positionView), 0))
    .xyz.normalize()
  // Reconstructed WORLD depth keeps the shore fixed while the camera moves and includes
  // actual voxel ledges and props. No interpolated heightfield can paint water onto dry sand.
  const { depth: optical_depth, scene_color, caustics, foam } = optics.sample()
  const tint_t = float(1).sub(optical_depth.mul(-0.3).exp())
  const body = mix(vec3(...palette.shallow), vec3(...palette.body), tint_t)
  const absorption = vec3(
    optical_depth.mul(-WATER_SIGMA[0]).exp(),
    optical_depth.mul(-WATER_SIGMA[1]).exp(),
    optical_depth.mul(-WATER_SIGMA[2]).exp()
  )

  // Reflection rises only at grazing angles. A fixed sky floor washed out the turquoise shallows.
  const reflected = reflect(view.negate(), normal).normalize()
  // The sky LUT has no terrain below its horizon. Grazing ripple rays sample the horizon;
  // worlds with scene reflections instead resolve their actual reflected geometry.
  const sky_color =
    reflection?.sample(normal) ??
    sky.sample_sky_dome(vec3(reflected.x, max(reflected.y, 0.02), reflected.z).normalize())
  const facing = clamp(view.dot(normal).abs(), 0, 1)
  const fresnel = pow(float(1).sub(facing), 6).mul(0.813).add(0.02).clamp(0, 0.82)

  // Small normal-driven highlights keep the calm surface legible without broad sine bands.
  const road_power = float(160)
  const road_gain = float(2.4)
  const crest = pow(clamp(ripple.mul(0.2).add(0.5), 0, 1), 5)
  const glint = pow(max(reflected.dot(sky.sun_direction), 0), road_power)
    .mul(crest)
    .mul(daylight)
    .mul(cloud_light)
    .mul(road_gain)
  const moon_glint = pow(max(reflected.dot(sky.sun_direction.negate()), 0), road_power)
    .mul(crest)
    .mul(float(1).sub(daylight))
    .mul(cloud_light)
    .mul(0.8)
  const water_color = mix(
    mix(body.mul(diffuse_light), sky_color, fresnel)
      .add(vec3(glint))
      .add(vec3(0.48, 0.65, 0.95).mul(moon_glint))
      .add(water_glow_reflections(glows, normal, view, ripple)),
    vec3(0.9, 0.98, 1).mul(diffuse_light),
    foam
  )
  const ice = frozen_shore(optical_depth, sky_color, diffuse_light)
  material.colorNode = frozen ? mix(water_color, ice.color, ice.amount) : water_color
  // Water exits during the first projection phase; terrain does not move until it is gone.
  material.opacityNode = smoothstep(0.02, 0.2, optical_depth).mul(visibility)
  const liquid = frozen ? float(1).sub(ice.amount) : float(1)
  const transmission = float(1)
    .sub(mix(float(0.098), float(0.98), tint_t))
    .mul(float(1).sub(fresnel))
    .mul(float(1).sub(foam))
    .mul(liquid)
  // The captured scene is already lit and fogged. Mix after surface fog so the seabed is
  // neither lit nor fogged twice. Opaque output avoids a second unwarped alpha-blended bed.
  const transmitted = scene_color.mul(absorption).add(vec3(caustics).mul(diffuse_light).mul(daylight))
  material.outputNode = vec4(mix(output.rgb, transmitted, transmission), output.a)
  material.alphaTest = 0.02
  material.fog = true
  return material
}

/** Shared surface optics; each mounted surface owns its viewport captures and textures. */
export const create_water_surface = ({
  sky,
  clouds,
  palette,
  lights,
  visibility = float(1),
  glows = [],
  reflection = null,
  frozen = false,
}: Readonly<{
  sky: WaterSky
  clouds: Clouds
  palette: LiquidPalette
  lights: WaterLights
  visibility?: Node<'float'>
  glows?: readonly SceneryGlow[]
  reflection?: ReturnType<typeof create_water_reflection> | null
  frozen?: boolean
}>) => {
  const optics = create_water_optics()
  // Read the same live lights as terrain. A shallow night orbit must not leave water at a fixed fraction of noon.
  const key = reference('color', 'color', lights.key).rgb.mul(reference('intensity', 'float', lights.key))
  const ambient = reference('color', 'color', lights.ambient).rgb.mul(reference('intensity', 'float', lights.ambient))
  const direct = key.mul(sky.sun_direction.y.abs())
  const illumination = ambient.add(direct).div(Math.PI)
  const cloud_light = clouds.shadow_at(positionWorld.xz, positionWorld.y)
  const surface_illumination = ambient.add(direct.mul(cloud_light)).div(Math.PI)
  const material_for = (sample_sky_dome: WaterSky['sample_sky_dome']) =>
    build_material(
      { sun_direction: sky.sun_direction, sample_sky_dome },
      cloud_light,
      palette,
      optics,
      visibility,
      glows,
      reflection,
      frozen,
      surface_illumination
    )
  const material = material_for(sky.sample_sky_dome)
  return {
    material,
    illumination,
    set_sky: (sample: WaterSky['sample_sky_dome']) => {
      const replacement = material_for(sample)
      material.copy(replacement)
      material.needsUpdate = true
      replacement.dispose()
    },
    dispose: () => {
      material.dispose()
      optics.dispose()
    },
  }
}

export const create_water = ({
  scene,
  quality,
  sky,
  clouds,
  world,
  palette,
  board_occlusion,
  lights,
}: Readonly<{
  scene: Scene
  quality: EngineQuality
  sky: WaterSky
  clouds: Clouds
  world: CompiledWorld
  palette: LiquidPalette
  board_occlusion: BoardOcclusion
  lights: WaterLights
}>): Water => {
  if (world.recipe.liquid === undefined)
    return Object.freeze({
      illumination: vec3(0),
      set_sky: () => {},
      set_focus: () => {},
      set_quality: () => {},
      set_visible: () => {},
      dispose: () => {},
    })
  const reflection =
    world.recipe.water_reflection === 'planar' ? create_water_reflection(scene, world.recipe.sea_level, quality) : null

  const surface_geometry = new PlaneGeometry(8192, 8192).rotateX(-Math.PI / 2)
  const water_surface = create_water_surface({
    sky,
    clouds,
    palette,
    lights,
    visibility: occlusion_fade_node(board_occlusion),
    glows: world.recipe.scenery?.glows ?? [],
    reflection,
    frozen: world.recipe.water_surface === 'frozen_shore',
  })
  const surface = new Mesh(surface_geometry, water_surface.material)
  surface.frustumCulled = false
  surface.matrixAutoUpdate = false
  surface.position.y = world.recipe.sea_level
  surface.renderOrder = TRANSPARENT_ORDER.water
  surface.updateMatrix()
  scene.add(surface)

  return Object.freeze({
    illumination: water_surface.illumination,
    set_sky: water_surface.set_sky,
    set_visible: (next: boolean) => {
      surface.visible = next
    },
    set_focus: (x: number, z: number) => {
      surface.position.set(x, world.recipe.sea_level, z)
      surface.updateMatrix()
    },
    set_quality: (next: EngineQuality) => {
      reflection?.set_quality(next)
    },
    dispose: () => {
      scene.remove(surface)
      reflection?.dispose()
      water_surface.dispose()
      surface_geometry.dispose()
    },
  })
}
