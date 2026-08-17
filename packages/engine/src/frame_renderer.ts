// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AgXToneMapping, Matrix4, SRGBColorSpace, Vector3, type PerspectiveCamera, type Scene } from 'three'
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { float, luminance, pass, renderOutput, rtt, screenUV, uniform, vec2, vec4 } from 'three/tsl'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'

import { create_atmosphere_pass } from './atmosphere.ts'
import type { Clouds } from './clouds.ts'
import { create_grade_node } from './grading.ts'
import { create_lens_water } from './lens_water.ts'
import { get_quality_profile, uses_world_post_processing } from './quality.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import type { EnginePresentation, EngineQuality } from './types.ts'
import { create_underwater_pass, type UnderwaterPass } from './underwater.ts'

type FramePipeline = Readonly<{
  render: () => void
  set_underwater: (state: Readonly<{ submerged: boolean; dt: number }>) => void
  set_environment: (state: Readonly<{ humidity: number }>) => void
  dispose: () => void
}>

export type FrameRenderer = Readonly<{
  render: () => void
  /** Per-frame push of the eye's submerged state — drives the refraction wobble and, on the
   * exit edge, the droplets-on-glass splash. The blue itself is per-pixel and needs no push. */
  set_underwater: FramePipeline['set_underwater']
  set_environment: FramePipeline['set_environment']
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
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  water_gate: Node<'float'>,
  clouds: Clouds,
  seed: string,
  sample_sky_dome: ReturnType<typeof create_sky_node>['sample_sky_dome']
): FramePipeline => {
  // Low and the isolated fight presentation are direct paths: one scene render, no HDR post graph,
  // fullscreen sampling, or wet lens. Renderer tone mapping still produces a valid display image.
  if (!uses_world_post_processing(quality, presentation))
    return Object.freeze({
      render: () => renderer.render(scene, camera),
      set_underwater: () => {},
      set_environment: () => {},
      dispose: () => {},
    })
  const { atmosphere: atmosphere_config } = get_quality_profile(quality).effects
  if (atmosphere_config === null) throw new Error(`Atmosphere config missing for ${quality} quality.`)
  // One scene sample plus the display-space FXAA pass below is the measured 120 Hz path. Layering
  // 4x MSAA under FXAA cost ~3 ms at 1552x1042 without a useful change to the voxel silhouette.
  const scene_pass = pass(scene, camera)
  // Underwater immersion weaves INTO the HDR chain: the scene is sampled at the (gated) wobbled
  // uv, then the blue depth fog composes before display mapping. Dry frames are
  // identity — every hook is uniform-driven, no recompile on the submerge/surface flip.
  const underwater = create_underwater_pass({ quality, water_gate })
  const view = create_scene_view(camera)
  const scene_color = scene_pass.getTextureNode().sample(underwater.warp_uv(screenUV as unknown as Node<'vec2'>))
  const scene_depth = scene_pass.getTextureNode('depth').sample(screenUV).r as Node<'float'>
  const atmosphere = create_atmosphere_pass({
    camera,
    depth: scene_depth,
    steps: atmosphere_config.steps,
    seed,
    sky: { sample_sky_dome, sun_direction },
    clouds,
  })
  const atmosphere_buffer = rtt(atmosphere.output)
  atmosphere_buffer.setResolutionScale(atmosphere_config.resolution_scale)
  const exterior = scene_color.rgb.mul(atmosphere_buffer.a).add(atmosphere_buffer.rgb)
  const frag_dist = scene_pass.getViewZNode().negate()
  const immersed = underwater.apply(exterior as unknown as Node<'vec3'>, frag_dist as unknown as Node<'float'>, view)
  const display = renderOutput(vec4(immersed, 1), AgXToneMapping, SRGBColorSpace)
  const low_frequency = rtt(display, 96, 54)
  const grade = create_grade_node(sun_direction.y)
  // The wet lens wraps the FINISHED display-space frame (droplets refract the graded image).
  const lens = create_lens_water({ quality })
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputColorTransform = false
  // FXAA last, in DISPLAY space (it reasons about perceived luma, so it belongs after the tone
  // map and grade) and before the wet lens, whose droplets refract the finished frame.
  const graded = vec4(grade(display.rgb, luminance(low_frequency.rgb)), 1)
  pipeline.outputNode = lens.apply(fxaa(graded) as unknown as Node<'vec4'>)

  return Object.freeze({
    render: () => {
      view.sync()
      atmosphere.update()
      lens.update()
      pipeline.render()
    },
    set_underwater: (state: Readonly<{ submerged: boolean; dt: number }>) => {
      underwater.update(state)
      // The droplets fire on the EXIT edge only — never on entry, never while submerged.
      if (underwater.just_exited()) lens.splash()
    },
    set_environment: ({ humidity }) => atmosphere.set_humidity(humidity),
    dispose: () => {
      atmosphere.dispose()
      atmosphere_buffer.renderTarget?.dispose()
      lens.dispose()
      low_frequency.renderTarget?.dispose()
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
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  water_gate: Node<'float'>,
  clouds: Clouds,
  seed: string,
  sample_sky_dome: ReturnType<typeof create_sky_node>['sample_sky_dome']
): FrameRenderer => {
  let quality = initial_quality
  let frame_pipeline = create_pipeline(
    renderer,
    scene,
    camera,
    quality,
    presentation,
    sun_direction,
    water_gate,
    clouds,
    seed,
    sample_sky_dome
  )

  return Object.freeze({
    render: () => frame_pipeline.render(),
    set_underwater: (state) => frame_pipeline.set_underwater(state),
    set_environment: (state) => frame_pipeline.set_environment(state),
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
        sun_direction,
        water_gate,
        clouds,
        seed,
        sample_sky_dome
      )
    },
    dispose: () => frame_pipeline.dispose(),
  })
}
