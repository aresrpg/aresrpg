// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable max-lines -- the WebGPU backend remains one cohesive device adapter pending a behavior-neutral extraction. */
import {
  AgXToneMapping,
  Matrix4,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  type CoordinateSystem,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { float } from 'three/tsl'

import type { EngineBackend } from './backend.ts'
import { create_clouds } from './clouds.ts'
import { create_far_terrain } from './far_terrain.ts'
import { create_fight_board_layer } from './fight_board.ts'
import { create_fight_sword_layer, fight_swords_visible } from './fight_swords.ts'
import { create_entity_layer } from './entities.ts'
import { create_entity_label_layer } from './entity_labels.ts'
import { create_fight_presentation } from './fight_presentation.ts'
import { create_transient_effects } from './transient_effects.ts'
import { project_screen_anchor } from './screen_projection.ts'
import { create_frame_renderer } from './frame_renderer.ts'
import { create_flatten_uniform, flat_terrain_amount } from './flatten.ts'
import type { GreedyMeshData } from './greedy_mesher.ts'
import { create_mesh_pool } from './mesh_pool.ts'
import { create_lantern } from './lantern.ts'
import { liquid_palette } from './liquid_palette.ts'
import { create_portal } from './portal.ts'
import { get_quality_profile, quality_pixel_ratio } from './quality.ts'
import type { ScatterInstance } from './scatter.ts'
import { create_scatter_layer } from './scatter_layer.ts'
import { create_resource_node_layer, resource_nodes_visible as should_show_resource_nodes } from './resource_nodes.ts'
import { chunk_origin } from './terrain_generator.ts'
import { create_terrain_pool } from './terrain_pool.ts'
import { create_board_occlusion, project_board_screen } from './board_occlusion.ts'
import { is_submerged } from './underwater.ts'
import { create_water } from './water.ts'
import { couple_lighting, fill_dir_of, is_moon_key, shadow_direction_changed } from './lighting/sky_light_coupling.ts'
import { create_sky_node, palette_for_sun } from './sky/sky_node.ts'
import { create_hillaire_sky } from './sky/hillaire/hillaire_sky.ts'
import type {
  CameraProjection,
  ChunkRenderOutcome,
  EngineIssue,
  EnginePresentation,
  EngineQuality,
  RenderChunkRequest,
  RenderedChunk,
  Vec3,
} from './types.ts'
import { compile_world_recipe, sample_world_column, type WorldRecipe } from './world_recipe.ts'

const FOG_COOL_TILT = [0.62, 0.75, 1] as const

type PendingUpload = Readonly<{
  chunk: RenderedChunk
  data: GreedyMeshData
  scatter: readonly ScatterInstance[]
  revision: number
}>

export const write_orthographic_projection = (
  target: Matrix4,
  left: number,
  right: number,
  top: number,
  bottom: number,
  near: number,
  far: number,
  coordinate_system: CoordinateSystem
): Matrix4 => target.makeOrthographic(left, right, top, bottom, near, far, coordinate_system)

export const create_webgpu_backend = async (
  canvas: HTMLCanvasElement,
  initial_quality: EngineQuality,
  world: WorldRecipe,
  report_issue: (issue?: EngineIssue) => void = () => {},
  presentation: EnginePresentation = 'world',
  initial_focus: readonly [number, number] = [0, 0]
): Promise<EngineBackend> => {
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  await renderer.init()
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 0.85

  const scene = new Scene()
  const camera = new PerspectiveCamera(70, 1, 0.1, 3000)
  const fight_board = create_fight_board_layer({ scene, camera, canvas })
  let fight_swords: ReturnType<typeof create_fight_sword_layer> | null = null
  const entities = create_entity_layer({ scene })
  const entity_labels = create_entity_label_layer({ canvas, scene, camera, entities })
  const effects = create_transient_effects({ scene, entities })
  const fight_presentation = create_fight_presentation({ entities, vfx: effects, shock: () => crit_shock() })
  const sun = new DirectionalLight(0xfff2dd, 3)
  const back_fill = new DirectionalLight(0xffd6a8, 1.35)
  const hemisphere = new HemisphereLight(0xbcb2a0, 0x977f56, 0.9)
  const analytic_sky = create_sky_node({ seed: world.seed })
  const compiled_world = compile_world_recipe(world, { structures: false })
  const liquid_material =
    world.liquid === undefined ? null : compiled_world.materials.entries[compiled_world.materials.id_for(world.liquid)]!
  const water_palette = liquid_palette(liquid_material?.color ?? [0, 0, 0])
  const light_baseline = Object.freeze({
    sun_color: [sun.color.r, sun.color.g, sun.color.b] as const,
    sun_intensity: sun.intensity,
    fill_color: [back_fill.color.r, back_fill.color.g, back_fill.color.b] as const,
    fill_intensity: back_fill.intensity,
    hemi_sky: [hemisphere.color.r, hemisphere.color.g, hemisphere.color.b] as const,
    hemi_ground: [hemisphere.groundColor.r, hemisphere.groundColor.g, hemisphere.groundColor.b] as const,
    hemi_intensity: hemisphere.intensity,
  })
  scene.add(hemisphere, back_fill, back_fill.target, sun, sun.target)
  scene.backgroundNode = analytic_sky.background_node

  const flatten = create_flatten_uniform()
  const clouds = create_clouds({ scene, quality: initial_quality, seed: world.seed, sky: analytic_sky })
  const board_occlusion = create_board_occlusion()
  let board_footprint: Readonly<{ center: readonly [number, number, number]; half_x: number; half_z: number }> | null =
    null
  // scratch, reused every frame — the draw loop allocates nothing
  const board_view_projection = new Matrix4()
  const terrain = create_terrain_pool({
    scene,
    quality: initial_quality,
    flatten,
    world,
    sun_direction: analytic_sky.sun_direction,
    clouds,
    board_occlusion,
  })
  const far_terrain = create_far_terrain({
    scene,
    quality: initial_quality,
    flatten,
    world,
    sun_direction: analytic_sky.sun_direction,
    clouds,
    initial_focus,
  })
  const scatter = create_scatter_layer({ scene, board_occlusion })
  const resource_nodes = create_resource_node_layer({ scene, wind: true })
  const lantern = create_lantern({ scene })
  const water = create_water({
    scene,
    quality: initial_quality,
    flatten,
    sky: analytic_sky,
    clouds,
    world: compiled_world,
    palette: water_palette,
  })
  // the star gate — world dressing at client 0;0; a fight-only scene has no ground to stand it on
  const portal = presentation === 'world' ? create_portal({ scene, world: compiled_world }) : null
  // Water state for the frame passes: the tint is per-pixel (the underwater pass reads the sea
  // plane itself), so the CPU only answers "does this world have water right now" — a world
  // without a liquid material, or a flattened one, has none — plus the eye's own submerged
  // flag, which the refraction wobble and the droplet exit edge need.
  const has_water = world.liquid === undefined ? 0 : 1
  const water_gate = float(has_water).mul(flatten.water_visibility)
  const water_level = float(world.sea_level)
  const water_world = world.liquid === undefined ? null : compiled_world
  let was_submerged = false
  const mesh_pool = create_mesh_pool(world)
  const frame_renderer = create_frame_renderer(
    renderer,
    scene,
    camera,
    initial_quality,
    presentation,
    sun,
    analytic_sky.sun_direction,
    water_gate,
    water_level,
    water_palette
  )
  const revisions = new Map<string, number>()
  const completions = new Map<string, Readonly<{ revision: number; resolve: (outcome: ChunkRenderOutcome) => void }>>()
  const pending_uploads = new Map<string, PendingUpload>()
  const retry_timers = new Map<string, ReturnType<typeof setTimeout>>()
  const pool_full_chunks = new Set<string>()
  const failed_chunks = new Set<string>()
  let upload_order: readonly PendingUpload[] = []
  let uploads_dirty = false
  let quality = initial_quality
  let sky_revision = 0
  let hillaire: ReturnType<typeof create_hillaire_sky> | null = null
  let sky_ready = false
  let previous_frame = performance.now()
  let render_width = 0
  let render_height = 0
  let terrain_presented = false
  let resource_nodes_visible = false
  let render_pixel_ratio = 0
  let disposed = false
  let shadow_center_x = Number.NaN
  let shadow_center_z = Number.NaN
  let has_dynamic_entities = false
  const last_shadow_direction = new Vector3()

  const settle_chunk = (key: string, revision: number, outcome: ChunkRenderOutcome): void => {
    const completion = completions.get(key)
    if (completion?.revision !== revision) return
    completions.delete(key)
    completion.resolve(outcome)
  }

  sun.shadow.autoUpdate = false
  sun.shadow.needsUpdate = true

  const apply_sky_lighting = (force_shadow_transform = false): void => {
    const direction = analytic_sky.sun_direction.value
    lantern.set_sun_elevation(direction.y)
    const lighting = couple_lighting([direction.x, direction.y, direction.z], light_baseline)
    sun.color.setRGB(lighting.sun_color[0], lighting.sun_color[1], lighting.sun_color[2])
    sun.intensity = lighting.sun_intensity
    sun.shadow.intensity = lighting.shadow_intensity
    back_fill.color.setRGB(lighting.fill_color[0], lighting.fill_color[1], lighting.fill_color[2])
    back_fill.intensity = lighting.fill_intensity
    hemisphere.color.setRGB(lighting.hemi_sky[0], lighting.hemi_sky[1], lighting.hemi_sky[2])
    hemisphere.groundColor.setRGB(lighting.hemi_ground[0], lighting.hemi_ground[1], lighting.hemi_ground[2])
    hemisphere.intensity = lighting.hemi_intensity
    const fog_color = palette_for_sun(direction.y).horizon
    scene.fog?.color.setRGB(
      fog_color[0] * FOG_COOL_TILT[0],
      fog_color[1] * FOG_COOL_TILT[1],
      fog_color[2] * FOG_COOL_TILT[2]
    )
    const key_direction = is_moon_key(direction.y) ? direction.clone().multiplyScalar(-1) : direction
    if (force_shadow_transform || shadow_direction_changed(last_shadow_direction.dot(key_direction))) {
      last_shadow_direction.copy(key_direction)
      sun.position.set(
        sun.target.position.x + key_direction.x * 350,
        sun.target.position.y + key_direction.y * 350,
        sun.target.position.z + key_direction.z * 350
      )
      if (lighting.shadow_intensity > 0) sun.shadow.needsUpdate = true
    }
    // The fill rides the key (see fill_dir_of): opposite azimuth, low — so the shaded side always
    // has form and the world never shows a lit side whose light is nowhere in the sky.
    const fill_direction = fill_dir_of([key_direction.x, key_direction.y, key_direction.z])
    back_fill.position.set(
      back_fill.target.position.x + fill_direction[0] * 300,
      back_fill.target.position.y + fill_direction[1] * 300,
      back_fill.target.position.z + fill_direction[2] * 300
    )
  }

  const use_sky_quality = async (next: EngineQuality): Promise<void> => {
    const revision = ++sky_revision
    sky_ready = false
    if (presentation === 'fight' || next === 'low') {
      hillaire?.dispose()
      hillaire = null
      scene.backgroundNode = analytic_sky.background_node
      scene.fogNode = null
      sky_ready = true
      report_issue()
      return
    }
    let replacement: ReturnType<typeof create_hillaire_sky> | null = null
    try {
      replacement = create_hillaire_sky({
        tier: next,
        seed: world.seed,
        sun_direction: analytic_sky.sun_direction,
        cool_tilt: FOG_COOL_TILT,
      })
      await replacement.bake(renderer)
      if (disposed || revision !== sky_revision) {
        replacement.dispose()
        return
      }
      hillaire?.dispose()
      hillaire = replacement
      scene.backgroundNode = replacement.background_node
      scene.fogNode = replacement.fog_node
      sky_ready = true
      report_issue()
    } catch (error) {
      replacement?.dispose()
      if (revision !== sky_revision || disposed) return
      hillaire?.dispose()
      hillaire = null
      scene.backgroundNode = analytic_sky.background_node
      scene.fogNode = null
      sky_ready = true
      report_issue({ code: 'advanced_sky_failed', detail: error instanceof Error ? error.message : String(error) })
      console.warn('[engine] Hillaire sky failed; keeping the analytic sky.', error)
    }
  }

  let render_distance: number | null = null
  const apply_quality = (next: EngineQuality, update_sky = true): void => {
    quality = next
    const profile = get_quality_profile(next)
    scene.fog = presentation === 'fight' ? null : new Fog(0x788ca8, profile.fog.near, profile.fog.far)
    renderer.shadowMap.enabled = profile.shadows.kind !== 'none'
    renderer.shadowMap.type = profile.shadows.kind === 'soft' ? PCFSoftShadowMap : PCFShadowMap
    sun.shadow.mapSize.set(profile.shadows.map_size || 1, profile.shadows.map_size || 1)
    sun.castShadow = profile.shadows.kind !== 'none'
    const shadow_extent = profile.chunks.near_radius * 32 + 24
    sun.shadow.camera.left = -shadow_extent
    sun.shadow.camera.right = shadow_extent
    sun.shadow.camera.top = shadow_extent
    sun.shadow.camera.bottom = -shadow_extent
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 520
    sun.shadow.bias = -0.00035
    // A large normal offset detaches shadows from voxel terrace edges (peter-panning).
    sun.shadow.normalBias = 0.002
    sun.shadow.needsUpdate = true
    sun.shadow.camera.updateProjectionMatrix()
    terrain.set_quality(next)
    far_terrain.set_quality(next, render_distance)
    clouds.set_quality(next)
    water.set_quality(next)
    frame_renderer.set_quality(next)
    if (update_sky) void use_sky_quality(profile.sky)
  }

  let ortho_blend = 0
  let camera_distance = 54
  let ortho_height: number | undefined
  const ortho_matrix = new Matrix4()

  // Blends the projection toward an orthographic frustum sized to match the perspective view
  // at the target's distance, so exploration <-> fight travel reads as one continuous move.
  const apply_projection = (): void => {
    camera.updateProjectionMatrix()
    if (ortho_blend <= 0) return
    const half_height = (ortho_height ?? Math.tan((camera.fov * Math.PI) / 360) * camera_distance * 2) / 2
    const half_width = half_height * camera.aspect
    write_orthographic_projection(
      ortho_matrix,
      -half_width,
      half_width,
      half_height,
      -half_height,
      camera.near,
      camera.far,
      camera.coordinateSystem
    )
    const perspective = camera.projectionMatrix.elements
    for (let index = 0; index < 16; index += 1)
      perspective[index] += (ortho_matrix.elements[index] - perspective[index]) * ortho_blend
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  }

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    const pixel_ratio = quality_pixel_ratio({
      quality,
      css_width: width,
      css_height: height,
      device_pixel_ratio: devicePixelRatio,
      presentation,
    })
    if (width === render_width && height === render_height && pixel_ratio === render_pixel_ratio) return
    render_width = width
    render_height = height
    render_pixel_ratio = pixel_ratio
    renderer.setPixelRatio(pixel_ratio)
    renderer.setSize(width, height, false)
    entity_labels.resize(width, height)
    camera.aspect = width / height
    apply_projection()
  }

  const drain_uploads = (): void => {
    if (pending_uploads.size === 0) return
    if (uploads_dirty) {
      upload_order = [...pending_uploads.values()].sort((left, right) => {
        const left_x = left.chunk.origin[0] - camera.position.x
        const left_z = left.chunk.origin[2] - camera.position.z
        const right_x = right.chunk.origin[0] - camera.position.x
        const right_z = right.chunk.origin[2] - camera.position.z
        return left_x * left_x + left_z * left_z - right_x * right_x - right_z * right_z
      })
      uploads_dirty = false
    }
    const { upload_bytes_per_frame, upload_time_ms } = get_quality_profile(quality).chunks
    const start = performance.now()
    let bytes = 0
    let uploaded = 0
    for (const entry of upload_order) {
      if (pending_uploads.get(entry.chunk.key) !== entry) continue
      if (uploaded > 0 && performance.now() - start >= upload_time_ms) break
      if (bytes > 0 && bytes + entry.data.quads.byteLength > upload_bytes_per_frame) break
      if (revisions.get(entry.chunk.key) !== entry.revision) {
        pending_uploads.delete(entry.chunk.key)
        continue
      }
      const result = terrain.upload(entry.chunk, entry.data)
      if (result === 'full') {
        if (!pool_full_chunks.has(entry.chunk.key)) {
          pool_full_chunks.add(entry.chunk.key)
          console.warn(`Terrain pool is full; chunk ${entry.chunk.key} remains queued until capacity is available.`)
        }
        continue
      }
      if (result === 'too_large') {
        pending_uploads.delete(entry.chunk.key)
        settle_chunk(entry.chunk.key, entry.revision, 'failed')
        console.error(`Terrain chunk ${entry.chunk.key} exceeds the complete GPU pool and cannot be displayed.`)
        continue
      }
      pending_uploads.delete(entry.chunk.key)
      pool_full_chunks.delete(entry.chunk.key)
      scatter.add(entry.chunk, entry.scatter)
      settle_chunk(entry.chunk.key, entry.revision, 'rendered')
      sun.shadow.needsUpdate = true
      bytes += entry.data.quads.byteLength
      uploaded += 1
    }
  }

  // one short camera shock per critical hit, whoever lands it — decays over ~260ms
  let shock_at = -10_000
  const CRIT_SHOCK_MS = 260
  const crit_shock = (): void => {
    shock_at = previous_frame
  }

  const draw = (now = performance.now()): void => {
    const delta_seconds = Math.min(0.1, Math.max(0, now - previous_frame) / 1000)
    previous_frame = now
    resize()
    drain_uploads()
    if (presentation === 'world') {
      const camera_column = sample_world_column(compiled_world, camera.position.x, camera.position.z)
      const surface_plane =
        water_world === null || flatten.flattened()
          ? null
          : camera_column.surface_y < world.sea_level
            ? world.sea_level
            : null
      const { humidity } = camera_column.climate
      clouds.set_humidity(humidity)
      hillaire?.set_ground_haze(camera_column.surface_y, humidity)
      lantern.tick(now)
      was_submerged = is_submerged(camera.position.y, surface_plane, was_submerged)
      frame_renderer.set_underwater({ submerged: was_submerged, dt: delta_seconds })
      hillaire?.tick(renderer, camera, delta_seconds)
    }
    fight_board.tick(now)
    // the peephole follows the camera: where the board lands on screen this frame decides what
    // stands between the eye and it. A board behind the eye occludes nothing, so the mask rests.
    if (board_footprint) {
      camera.updateMatrixWorld()
      board_view_projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const projected = project_board_screen(
        board_view_projection,
        camera.matrixWorldInverse,
        board_footprint.center,
        board_footprint.half_x,
        board_footprint.half_z,
        board_footprint.center[1]
      )
      if (projected)
        board_occlusion.set_frame({
          ...projected,
          floor_y: board_footprint.center[1],
          center_xz: [board_footprint.center[0], board_footprint.center[2]],
          radius: Math.hypot(board_footprint.half_x, board_footprint.half_z),
          clear_half: [board_footprint.half_x + 1, board_footprint.half_z + 1],
        })
    }
    entities.tick(now)
    effects.tick(now)
    const show_resource_nodes = should_show_resource_nodes({
      terrain_presented,
      flattened: flatten.flattened(),
      board_active: board_footprint !== null,
    })
    if (show_resource_nodes !== resource_nodes_visible) {
      resource_nodes_visible = show_resource_nodes
      resource_nodes.set_visible(show_resource_nodes)
    }
    if (terrain_presented) portal?.tick(camera.position.x, camera.position.y, camera.position.z)
    fight_swords?.tick(now)
    if (has_dynamic_entities && sun.castShadow && sun.shadow.intensity > 0) sun.shadow.needsUpdate = true
    const shock = Math.max(0, 1 - (now - shock_at) / CRIT_SHOCK_MS)
    if (shock > 0) {
      const amplitude = 0.11 * shock * shock
      const offset_x = Math.sin(now * 0.09) * amplitude
      const offset_y = Math.cos(now * 0.117) * amplitude * 0.6
      camera.position.x += offset_x
      camera.position.y += offset_y
      frame_renderer.render()
      entity_labels.render()
      if (!terrain_presented && terrain.count() > 0) terrain_presented = true
      camera.position.x -= offset_x
      camera.position.y -= offset_y
      return
    }
    frame_renderer.render()
    entity_labels.render()
    if (!terrain_presented && terrain.count() > 0) terrain_presented = true
  }

  const remove_chunk = (key: string): void => {
    const previous_revision = revisions.get(key) ?? 0
    revisions.set(key, previous_revision + 1)
    settle_chunk(key, previous_revision, 'removed')
    pending_uploads.delete(key)
    pool_full_chunks.delete(key)
    failed_chunks.delete(key)
    mesh_pool.cancel(key)
    const retry_timer = retry_timers.get(key)
    if (retry_timer !== undefined) clearTimeout(retry_timer)
    retry_timers.delete(key)
    terrain.remove(key)
    scatter.remove(key)
    sun.shadow.needsUpdate = true
  }

  const schedule_mesh = (chunk: RenderChunkRequest, revision: number, attempt: number): void => {
    const origin = chunk_origin(chunk.coordinate)
    const distance_x = origin[0] - camera.position.x
    const distance_z = origin[2] - camera.position.z
    void mesh_pool
      .mesh(chunk, distance_x * distance_x + distance_z * distance_z)
      .then(({ chunk: generated, mesh: data, scatter: scatter_instances }) => {
        if (disposed || revisions.get(chunk.key) !== revision) return
        retry_timers.delete(chunk.key)
        failed_chunks.delete(chunk.key)
        pending_uploads.set(chunk.key, Object.freeze({ chunk: generated, data, scatter: scatter_instances, revision }))
        uploads_dirty = true
      })
      .catch((error: unknown) => {
        if (disposed || revisions.get(chunk.key) !== revision) return
        if (attempt >= 2) {
          retry_timers.delete(chunk.key)
          failed_chunks.add(chunk.key)
          settle_chunk(chunk.key, revision, 'failed')
          console.error(`Failed to build chunk ${chunk.key} after ${attempt + 1} attempts.`, error)
          return
        }
        const retry_timer = setTimeout(
          () => {
            retry_timers.delete(chunk.key)
            if (!disposed && revisions.get(chunk.key) === revision) schedule_mesh(chunk, revision, attempt + 1)
          },
          Math.min(5_000, 100 * 2 ** attempt)
        )
        retry_timers.set(chunk.key, retry_timer)
      })
  }

  apply_quality(initial_quality, false)
  // Advanced atmosphere is progressive presentation, never a terrain boot gate. The analytic
  // sky remains valid while its replacement bakes, so attach the backend and stream chunks now.
  void use_sky_quality(get_quality_profile(initial_quality).sky)
  if (presentation === 'fight') {
    const warmup = effects.create_warmup()
    void renderer
      .compileAsync(warmup.object, camera, scene)
      .catch((error: unknown) => console.warn('[engine] Fight VFX shader preload failed.', error))
      .finally(warmup.dispose)
  }
  return Object.freeze({
    kind: 'webgpu',
    render: draw,
    set_camera: (position: Vec3, target: Vec3, projection: CameraProjection = {}) => {
      const { fov, ortho_blend: next_ortho_blend, ortho_height: next_ortho_height } = projection
      camera.position.set(...position)
      camera.lookAt(...target)
      camera_distance = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2])
      camera.fov = fov ?? camera.fov
      ortho_blend = Math.min(1, Math.max(0, next_ortho_blend ?? 0))
      ortho_height = next_ortho_height
      apply_projection()
      const next_shadow_x = Math.floor(target[0] / 32) * 32
      const next_shadow_z = Math.floor(target[2] / 32) * 32
      if (next_shadow_x !== shadow_center_x || next_shadow_z !== shadow_center_z) {
        shadow_center_x = next_shadow_x
        shadow_center_z = next_shadow_z
        sun.target.position.set(next_shadow_x, target[1], next_shadow_z)
        back_fill.target.position.set(next_shadow_x, target[1], next_shadow_z)
        apply_sky_lighting(true)
        sun.shadow.needsUpdate = true
      }
      far_terrain.set_focus(target[0], target[2])
      clouds.set_focus(target[0], target[2])
      water.set_focus(target[0], target[2])
    },
    set_character_anchor: (position: Vec3 | null) => {
      if (position) lantern.set_focus(position[0], position[1], position[2])
      lantern.set_active(position !== null)
    },
    set_quality: (next: EngineQuality, next_render_distance: number | null = null) => {
      // the far shell's hole tracks the player's chunk radius — same door as the tier switch
      if (next_render_distance !== render_distance) {
        render_distance = next_render_distance
        far_terrain.set_quality(next, render_distance)
      }
      if (next !== quality) apply_quality(next)
    },
    set_time_of_day: (time: number) => {
      analytic_sky.set_time_of_day(time)
      apply_sky_lighting()
    },
    set_flatten_amount: (amount: number) => {
      if (flatten.set(amount)) sun.shadow.needsUpdate = true
      terrain.set_flatten_active(flat_terrain_amount(amount) > 0)
      scatter.set_flatten_active(flat_terrain_amount(amount) > 0)
      resource_nodes_visible = should_show_resource_nodes({
        terrain_presented,
        flattened: flat_terrain_amount(amount) > 0,
        board_active: board_footprint !== null,
      })
      resource_nodes.set_visible(resource_nodes_visible)
      portal?.set_flatten(amount)
    },
    set_fight_board: (board) => {
      fight_board.set(board)
      portal?.set_active(board === null)
      // the peephole arms with the board and remembers its footprint; disarming restores the
      // fast terrain material, so the discard never survives the fight
      board_footprint = board
        ? Object.freeze({
            center: [
              board.origin.x + (board.width * board.cell_size) / 2,
              board.origin.y,
              board.origin.z + (board.height * board.cell_size) / 2,
            ] as const,
            half_x: (board.width * board.cell_size) / 2,
            half_z: (board.height * board.cell_size) / 2,
          })
        : null
      board_occlusion.set_active(board !== null)
      terrain.set_occlusion_active(board !== null)
      fight_swords?.set_visible(fight_swords_visible(board !== null))
      resource_nodes_visible = should_show_resource_nodes({
        terrain_presented,
        flattened: flatten.flattened(),
        board_active: board_footprint !== null,
      })
      resource_nodes.set_visible(resource_nodes_visible)
      entities.set_board(board)
    },
    set_entities: (next) => {
      has_dynamic_entities = next.length > 0
      entities.set(next)
      sun.shadow.needsUpdate = true
    },
    set_fight_swords: (url, impact_sound_url, markers) => {
      fight_swords ??= create_fight_sword_layer({
        scene,
        url,
        impact_sound_url,
        impact: effects.play_sword_impact,
      })
      fight_swords.set_visible(fight_swords_visible(board_footprint !== null))
      fight_swords.set_markers(markers)
    },
    set_fight_sword_label: (id, element) => fight_swords?.set_label(id, element),
    set_resource_nodes: resource_nodes.set_markers,
    set_resource_node_label: resource_nodes.set_label,
    set_portal_label: (element) => {
      // the anchor is a GETTER — the gate's ground rides the flatten projection, so must its tag
      if (portal) entity_labels.set_static('portal', element, portal.label_anchor)
    },
    animate_entity: entities.animate,
    play_fight_cue: fight_presentation.play,
    play_jump_puff: effects.play_jump_puff,
    project_entity: (id) => {
      const anchor = entities.world_anchor(id)
      return anchor ? project_screen_anchor(anchor, camera, canvas.getBoundingClientRect()) : null
    },
    set_entity_label: entity_labels.set,
    set_world_label: (id, element, position) =>
      entity_labels.set_static(id, element, new Vector3(...(position ?? [0, 0, 0]))),
    entity_height: entities.entity_height,
    upsert_fight_blob: fight_board.upsert_blob,
    remove_fight_blob: fight_board.remove_blob,
    pick_fight_cell: fight_board.pick,
    render_chunk: (chunk: RenderChunkRequest) => {
      const revision = (revisions.get(chunk.key) ?? 0) + 1
      revisions.set(chunk.key, revision)
      failed_chunks.delete(chunk.key)
      schedule_mesh(chunk, revision, 0)
      return new Promise<ChunkRenderOutcome>((resolve) => {
        const previous = completions.get(chunk.key)
        previous?.resolve('removed')
        completions.set(chunk.key, Object.freeze({ revision, resolve }))
      })
    },
    remove_chunk,
    chunk_count: terrain.count,
    render_state: () => {
      const mesh = mesh_pool.state()
      const state = {
        mesh_queued: mesh.queued,
        mesh_active: mesh.active,
        uploads_pending: pending_uploads.size,
        uploads_blocked: pool_full_chunks.size,
        retries_pending: retry_timers.size,
        failed_chunks: failed_chunks.size,
        far_ready: far_terrain.ready(),
        sky_ready,
      }
      return Object.freeze({
        settled:
          state.mesh_queued === 0 &&
          state.mesh_active === 0 &&
          state.uploads_pending === 0 &&
          state.uploads_blocked === 0 &&
          state.retries_pending === 0 &&
          state.failed_chunks === 0 &&
          state.far_ready &&
          state.sky_ready,
        ...state,
      })
    },
    flattened: flatten.flattened,
    dispose: () => {
      disposed = true
      mesh_pool.dispose()
      pending_uploads.clear()
      pool_full_chunks.clear()
      failed_chunks.clear()
      retry_timers.forEach(clearTimeout)
      retry_timers.clear()
      revisions.clear()
      completions.forEach(({ resolve }) => resolve('removed'))
      completions.clear()
      terrain.dispose()
      scatter.dispose()
      resource_nodes.dispose()
      lantern.dispose()
      far_terrain.dispose()
      clouds.dispose()
      water.dispose()
      portal?.dispose()
      fight_board.dispose()
      effects.dispose()
      entities.dispose()
      entity_labels.dispose()
      frame_renderer.dispose()
      hillaire?.dispose()
      renderer.dispose()
    },
  })
}
