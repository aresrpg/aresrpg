// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  AgXToneMapping,
  Matrix4,
  SRGBColorSpace,
  Vector3,
  type DirectionalLight,
  type PerspectiveCamera,
  type Scene,
} from 'three'
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { float, luminance, pass, renderOutput, rtt, screenUV, uniform, vec2, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js'

import { create_grade_node } from './grading.ts'
import { create_lens_water } from './lens_water.ts'
import type { LiquidPalette } from './liquid_palette.ts'
import { get_quality_profile, uses_world_post_processing } from './quality.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import { create_sun_shafts } from './sun_shafts.ts'
import type { EnginePresentation, EngineQuality } from './types.ts'
import { create_underwater_pass, type UnderwaterFrameState, type UnderwaterPass } from './underwater.ts'

type FramePipeline = Readonly<{
  render: () => void
  set_underwater: (state: UnderwaterFrameState) => void
  dispose: () => void
}>

export type FrameRenderer = Readonly<{
  render: () => void
  /** Per-frame push of the eye's submerged state — drives the refraction wobble and, on the
   * exit edge, the droplets-on-glass splash. The blue itself is per-pixel and needs no push. */
  set_underwater: FramePipeline['set_underwater']
  set_quality: (quality: EngineQuality) => void
  dispose: () => void
}>

/** The SCENE camera as post-pass nodes. A post graph is built against the fullscreen-quad
 * camera, so the ambient `cameraPosition` / `cameraWorldMatrix` accessors describe the QUAD,
 * not the player's view (measured 2026-08-15: eye height read as 0 and every view ray came out
 * unrotated). Any post effect that needs the real view reads it from these uniforms, pushed
 * once per frame. `ray` is the per-pixel world view direction (WebGPU: uv.y = 0 at the top of
 * the frame, NDC y up — hence the flip). */
const create_scene_view = (camera: PerspectiveCamera) => {
  const eye = uniform(new Vector3())
  const world_matrix = uniform(new Matrix4())
  const projection_inverse = uniform(new Matrix4())
  const ndc = vec2(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y).mul(2).sub(1))
  const view_point = projection_inverse.mul(vec4(ndc, 0, 1))
  const view_direction = view_point.xyz.div(view_point.w).normalize()
  return Object.freeze({
    ray: world_matrix.mul(vec4(view_direction, 0)).xyz.normalize() as unknown as Node<'vec3'>,
    eye_y: eye.y as unknown as Node<'float'>,
    sync: () => {
      eye.value.copy(camera.position)
      world_matrix.value.copy(camera.matrixWorld)
      projection_inverse.value.copy(camera.projectionMatrixInverse)
    },
  })
}

const create_pipeline = (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  quality: EngineQuality,
  presentation: EnginePresentation,
  sun: DirectionalLight,
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  water_gate: Node<'float'>,
  water_level: Node<'float'>,
  liquid_palette: LiquidPalette
): FramePipeline => {
  // Fights and low-quality worlds render directly. Higher world tiers pay for the common display
  // grammar; scene fog remains the sole exploration-atmosphere owner.
  if (!uses_world_post_processing(quality, presentation))
    return Object.freeze({
      render: () => renderer.render(scene, camera),
      set_underwater: () => {},
      dispose: () => {},
    })
  const profile = get_quality_profile(quality)
  const { bloom: bloom_config, sun_shafts: shaft_config } = profile.effects
  // One scene sample is the proven legacy path. Quality scales reconstruction; one final
  // display-space FXAA pass stabilizes voxel silhouettes without multisampling the world.
  const scene_pass = pass(scene, camera)
  scene_pass.setResolutionScale(profile.render.scene_scale)
  // Underwater immersion weaves INTO the HDR chain: the scene is sampled at the (gated) wobbled
  // uv, then the blue depth fog composes before display mapping. Dry frames are
  // identity — every hook is uniform-driven, no recompile on the submerge/surface flip.
  const underwater = create_underwater_pass({ quality, water_gate, water_level, palette: liquid_palette })
  const view = create_scene_view(camera)
  const scene_color = scene_pass.getTextureNode().sample(underwater.warp_uv(screenUV as unknown as Node<'vec2'>))
  const frag_dist = scene_pass.getViewZNode().negate()
  const immersed = underwater.apply(
    scene_color.rgb as unknown as Node<'vec3'>,
    frag_dist as unknown as Node<'float'>,
    view
  )
  const shafts =
    shaft_config === null
      ? null
      : create_sun_shafts({
          camera,
          sun,
          sun_direction,
          scene_texture: scene_pass.getTextureNode() as Parameters<typeof create_sun_shafts>[0]['scene_texture'],
          config: shaft_config,
        })
  const shaft_texture = shafts === null ? null : rtt(vec4(shafts.color, 1))
  if (shaft_texture !== null) {
    shaft_texture.setResolutionScale(shaft_config!.resolution)
    shaft_texture.autoUpdate = false
  }
  const atmosphere =
    shaft_texture === null || shafts === null ? immersed : immersed.add(shaft_texture.rgb.mul(shafts.active))
  const hdr_texture = bloom_config === null ? null : rtt(vec4(atmosphere, 1))
  if (hdr_texture !== null) hdr_texture.autoUpdate = false
  const hdr_bloom =
    hdr_texture === null || bloom_config === null
      ? null
      : bloom(hdr_texture, bloom_config.strength, bloom_config.radius, bloom_config.threshold)
  const hdr_color = hdr_texture === null || hdr_bloom === null ? atmosphere : hdr_texture.rgb.add(hdr_bloom.rgb)
  const display = renderOutput(vec4(hdr_color, 1), AgXToneMapping, SRGBColorSpace)
  const low_frequency = rtt(display, 96, 54)
  const grade = create_grade_node(sun_direction.y)
  // The wet lens wraps the FINISHED display-space frame (droplets refract the graded image).
  const lens = create_lens_water({ quality })
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputColorTransform = false
  const graded = vec4(grade(display.rgb, luminance(low_frequency.rgb)), 1)
  const reconstructed =
    profile.render.sharpness === null ? graded : (sharpen(graded, profile.render.sharpness) as unknown as Node<'vec4'>)
  const final_frame = fxaa(reconstructed) as unknown as Node<'vec4'>
  const lens_dry = lens.apply(final_frame, false)
  const lens_wet = lens.apply(final_frame, true)
  pipeline.outputNode = lens_dry
  let submerged = false

  return Object.freeze({
    render: () => {
      view.sync()
      const shafts_visible = shafts?.update(submerged) ?? false
      if (shaft_texture !== null && shafts_visible) shaft_texture.textureNeedsUpdate = true
      if (hdr_texture !== null) hdr_texture.textureNeedsUpdate = true
      const lens_output = lens.update() ? lens_wet : lens_dry
      if (pipeline.outputNode !== lens_output) {
        pipeline.outputNode = lens_output
        pipeline.needsUpdate = true
      }
      pipeline.render()
    },
    set_underwater: (state: UnderwaterFrameState) => {
      ;({ submerged } = state)
      underwater.update(state)
      // The droplets fire on the EXIT edge only — never on entry, never while submerged.
      if (underwater.just_exited()) lens.splash()
    },
    dispose: () => {
      lens.dispose()
      low_frequency.renderTarget?.dispose()
      shaft_texture?.renderTarget?.dispose()
      hdr_texture?.renderTarget?.dispose()
      scene_pass.dispose()
      pipeline.dispose()
    },
  })
}

export const create_frame_renderer = (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  initial_quality: EngineQuality,
  presentation: EnginePresentation,
  sun: DirectionalLight,
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  water_gate: Node<'float'>,
  water_level: Node<'float'>,
  liquid_palette: LiquidPalette
): FrameRenderer => {
  let quality = initial_quality
  let frame_pipeline = create_pipeline(
    renderer,
    scene,
    camera,
    quality,
    presentation,
    sun,
    sun_direction,
    water_gate,
    water_level,
    liquid_palette
  )

  return Object.freeze({
    render: () => frame_pipeline.render(),
    set_underwater: (state) => frame_pipeline.set_underwater(state),
    set_quality: (next: EngineQuality) => {
      if (next === quality) return
      quality = next
      frame_pipeline.dispose()
      frame_pipeline = create_pipeline(
        renderer,
        scene,
        camera,
        next,
        presentation,
        sun,
        sun_direction,
        water_gate,
        water_level,
        liquid_palette
      )
    },
    dispose: () => frame_pipeline.dispose(),
  })
}
