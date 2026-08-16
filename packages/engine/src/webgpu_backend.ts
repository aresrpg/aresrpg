// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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
import { create_entity_layer } from './entities.ts'
import { create_frame_renderer } from './frame_renderer.ts'
import { create_flatten_uniform } from './flatten.ts'
import type { GreedyMeshData } from './greedy_mesher.ts'
import { create_mesh_pool } from './mesh_pool.ts'
import { get_quality_profile, quality_pixel_ratio } from './quality.ts'
import { chunk_origin } from './terrain_generator.ts'
import { create_terrain_pool } from './terrain_pool.ts'
import { is_submerged } from './underwater.ts'
import { create_water } from './water.ts'
import { couple_lighting, fill_dir_of, is_moon_key } from './lighting/sky_light_coupling.ts'
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

type PendingUpload = Readonly<{
  chunk: RenderedChunk
  data: GreedyMeshData
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
  presentation: EnginePresentation = 'world'
): Promise<EngineBackend> => {
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  await renderer.init()
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.1

  const scene = new Scene()
  const camera = new PerspectiveCamera(48, 1, 0.1, 3000)
  const fight_board = create_fight_board_layer({ scene, camera, canvas })
  const entities = create_entity_layer({ scene })
  const sun = new DirectionalLight(0xfff2dd, 3)
  const back_fill = new DirectionalLight(0xffd6a8, 1.35)
  const hemisphere = new HemisphereLight(0xbcb2a0, 0x977f56, 0.9)
  const analytic_sky = create_sky_node({ seed: world.seed })
  const compiled_world = compile_world_recipe(world)
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
  const terrain = create_terrain_pool({
    scene,
    quality: initial_quality,
    flatten,
    world,
    sun_direction: analytic_sky.sun_direction,
    clouds,
  })
  const far_terrain = create_far_terrain({
    scene,
    quality: initial_quality,
    flatten,
    world,
    sun_direction: analytic_sky.sun_direction,
    clouds,
  })
  const water = create_water({ scene, quality: initial_quality, flatten, sky: analytic_sky, clouds, world })
  // Water state for the frame passes: the tint is per-pixel (the underwater pass reads the sea
  // plane itself), so the CPU only answers "does this world have water right now" — a world
  // without a liquid material, or a flattened one, has none — plus the eye's own submerged
  // flag, which the refraction wobble and the droplet exit edge need.
  const has_water = world.liquid === undefined ? 0 : 1
  const water_gate = float(has_water).mul(float(1).sub(flatten.amount))
  const water_world = world.liquid === undefined ? null : compiled_world
  let was_submerged = false
  const mesh_pool = create_mesh_pool(world)
  const frame_renderer = create_frame_renderer(
    renderer,
    scene,
    camera,
    initial_quality,
    analytic_sky.sun_direction,
    water_gate,
    clouds,
    world.seed,
    analytic_sky.sample_sky_dome
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
  let render_pixel_ratio = 0
  let disposed = false
  let shadow_center_x = Number.NaN
  let shadow_center_z = Number.NaN
  const last_shadow_direction = new Vector3()

  const settle_chunk = (key: string, revision: number, outcome: ChunkRenderOutcome): void => {
    const completion = completions.get(key)
    if (completion?.revision !== revision) return
    completions.delete(key)
    completion.resolve(outcome)
  }

  sun.shadow.autoUpdate = false
  sun.shadow.needsUpdate = true

  const apply_sky_lighting = (): void => {
    const direction = analytic_sky.sun_direction.value
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
    scene.fog?.color.setRGB(fog_color[0], fog_color[1], fog_color[2])
    const key_direction = is_moon_key(direction.y) ? direction.clone().multiplyScalar(-1) : direction
    sun.position.set(
      sun.target.position.x + key_direction.x * 350,
      sun.target.position.y + key_direction.y * 350,
      sun.target.position.z + key_direction.z * 350
    )
    // The fill rides the key (see fill_dir_of): opposite azimuth, low — so the shaded side always
    // has form and the world never shows a lit side whose light is nowhere in the sky.
    const fill_direction = fill_dir_of([key_direction.x, key_direction.y, key_direction.z])
    back_fill.position.set(
      back_fill.target.position.x + fill_direction[0] * 300,
      back_fill.target.position.y + fill_direction[1] * 300,
      back_fill.target.position.z + fill_direction[2] * 300
    )
    if (lighting.shadow_intensity > 0 && last_shadow_direction.dot(key_direction) < 0.99939) {
      last_shadow_direction.copy(key_direction)
      sun.shadow.needsUpdate = true
    }
  }

  const use_sky_quality = async (next: EngineQuality): Promise<void> => {
    const revision = ++sky_revision
    sky_ready = false
    if (next === 'low') {
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
        cool_tilt: [0.62, 0.75, 1],
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

  const apply_quality = (next: EngineQuality, update_sky = true): void => {
    quality = next
    const profile = get_quality_profile(next)
    scene.fog = new Fog(0x788ca8, profile.fog.near, profile.fog.far)
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
    sun.shadow.normalBias = 0.025
    sun.shadow.needsUpdate = true
    sun.shadow.camera.updateProjectionMatrix()
    terrain.set_quality(next)
    far_terrain.set_quality(next)
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
      settle_chunk(entry.chunk.key, entry.revision, 'rendered')
      sun.shadow.needsUpdate = true
      bytes += entry.data.quads.byteLength
      uploaded += 1
    }
  }

  const draw = (now = performance.now()): void => {
    const delta_seconds = Math.min(0.1, Math.max(0, now - previous_frame) / 1000)
    previous_frame = now
    resize()
    drain_uploads()
    const surface_plane =
      water_world === null || flatten.flattened()
        ? null
        : sample_world_column(water_world, camera.position.x, camera.position.z).surface_y < 0
          ? 0
          : null
    const { humidity } = compiled_world.sample_climate(camera.position.x, camera.position.z)
    clouds.set_humidity(humidity)
    frame_renderer.set_environment({ humidity })
    was_submerged = is_submerged(camera.position.y, surface_plane, was_submerged)
    frame_renderer.set_underwater({ submerged: was_submerged, dt: delta_seconds })
    hillaire?.tick(renderer, camera, delta_seconds)
    fight_board.tick(now)
    entities.tick(now)
    frame_renderer.render()
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
    sun.shadow.needsUpdate = true
  }

  const schedule_mesh = (chunk: RenderChunkRequest, revision: number, attempt: number): void => {
    const origin = chunk_origin(chunk.coordinate)
    const distance_x = origin[0] - camera.position.x
    const distance_z = origin[2] - camera.position.z
    void mesh_pool
      .mesh(chunk, distance_x * distance_x + distance_z * distance_z)
      .then(({ chunk: generated, mesh: data }) => {
        if (disposed || revisions.get(chunk.key) !== revision) return
        retry_timers.delete(chunk.key)
        failed_chunks.delete(chunk.key)
        pending_uploads.set(chunk.key, Object.freeze({ chunk: generated, data, revision }))
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
  await use_sky_quality(get_quality_profile(initial_quality).sky)
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
        apply_sky_lighting()
        sun.shadow.needsUpdate = true
      }
      far_terrain.set_focus(target[0], target[2])
      clouds.set_focus(target[0], target[2])
      water.set_focus(target[0], target[2])
    },
    set_quality: (next: EngineQuality) => {
      if (next !== quality) apply_quality(next)
    },
    set_time_of_day: (time: number) => {
      analytic_sky.set_time_of_day(time)
      apply_sky_lighting()
    },
    set_flatten_amount: (amount: number) => {
      if (flatten.set(amount)) sun.shadow.needsUpdate = true
      terrain.set_flatten_active(amount > 0)
    },
    set_fight_board: (board) => {
      fight_board.set(board)
      entities.set_board(board)
    },
    set_entities: entities.set,
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
      far_terrain.dispose()
      clouds.dispose()
      water.dispose()
      fight_board.dispose()
      entities.dispose()
      frame_renderer.dispose()
      hillaire?.dispose()
      renderer.dispose()
    },
  })
}
