import {
  CHUNK_SIZE,
  CHUNKS_PER_COLUMN,
  WORLD_HEIGHT,
  MESH_PACING_STEPS,
  MESH_BUDGET_MS,
  MESH_BUDGET_RELAXED_MS,
  MESH_BUDGET_GPU_BOUND_MS,
  MESH_GPU_BOUND_OVER_MS,
  MESH_RELAX_UNDER_MS,
  FRAME_GOVERNOR_MS,
  UPLOAD_BUDGET_STEPS,
  DENSE_CHUNK_BYTES,
  FORWARD_BIAS_CHUNKS2,
} from '../config/world_config.js'
import { coord_key, create_chunk_store } from '../chunks/store.js'
import { local_index } from '../chunks/format.js'
import { mesh_chunk } from '../mesh/mesher.js'
import { BYTES_PER_QUAD } from '../mesh/quad_buffer.js'
import { MSG_GEN_REQUEST } from '../workers/rpc.js'

import { create_mesh_dispatcher } from './mesh_dispatch.js'
import { create_upload_queue } from './upload_queue.js'
/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('../render/pool_renderer.js').TerrainRenderer} TerrainRenderer */
/** @typedef {import('../workers/pool.js').WorkerPool} WorkerPool */
/** @typedef {[number, number, number]} ChunkCoord */
export const VERTICAL_CHUNKS = CHUNKS_PER_COLUMN
/**
 * @typedef {object} RingOptions
 * @property {WorkerPool} pool gen worker pool — submit(MSG_GEN_REQUEST, {cx,cy,cz}) → ChunkRecord
 * @property {WorkerPool} [mesh_pool] OPTIONAL mesh worker pool — submit(MSG_MESH_REQUEST, MeshJobPayload)
 * @property {number} [max_mesh_in_flight] ceiling on concurrent off-thread mesh jobs (default 2× cores).
 * @property {TerrainRenderer} terrain_renderer upload/remove target (the RENDER↔CORE seam)
 * @property {number} [load_radius] horizontal chunk radius loaded around the camera (default 7)
 * @property {number} [unload_margin] chunks beyond load_radius+margin are evicted (default 2)
 * @property {number} [vertical_chunks] cy stack height per column (default VERTICAL_CHUNKS)
 * @property {number} [max_gen_in_flight] concurrent gen jobs cap (default 2× hardwareConcurrency)
 * @property {readonly (readonly [number, number])[]} [mesh_pacing_steps] ADAPTIVE mesh ladder
 * @property {readonly (readonly [number, number])[]} [upload_budget_steps] ADAPTIVE upload ladder
 * @property {number} [forward_bias_chunks2] [D259] bounded intra-ring tiebreak (CHUNK², < 1 ring) pulling
 * @property {number} [mesh_budget_ms] BASE wall-clock ceiling for meshing per update(), used on non-cheap
 * @property {number} [mesh_budget_relaxed_ms] RELAXED (larger) mesh ceiling, used only when the recent
 * @property {number} [mesh_budget_gpu_bound_ms] GPU-BOUND (big) mesh ceiling, used when the recent frame
 * @property {number} [mesh_gpu_bound_over_ms] recent-frame-time (ms) above which the GPU-bound slice
 * @property {number} [mesh_relax_under_ms] recent-frame-time threshold (ms) under which the relaxed mesh
 * @property {number} [frame_governor_ms] recent-frame-time ceiling (ms) above which mesh + upload pacing
 * @property {boolean} [mesh_slice] default true; false restores immediate, unsliced worker-reply integration
 * @property {number} [store_capacity] LRU cap; default sized to the load box + margin
 * @property {boolean} [render_fins] D164: emit rich leaf sprite clusters (tier terrain_displacement) vs the
 * @property {() => number} [now] injectable clock (ms) — tests pass a fake; defaults to perf.now
 * @property {(coord: ChunkCoord) => void} [on_chunk_loaded] fired once per chunk uploaded (engine
 * @property {(coord: ChunkCoord) => void} [on_chunk_unloaded] fired once per chunk evicted
 * @property {() => void} [on_chunk_meshed] hitch probe hook at the mesh-result integration site
 * @property {(elapsed_ms: number) => void} [on_mesh_integration] hitch probe hook for reply-integration time
 */
/**
 * @typedef {object} RingManager
 * @property {(camera_chunk: ChunkCoord, camera_facing?: ChunkCoord, recent_frame_ms?: number) => void} update
 * @property {(byte_budget?: number) => number} drain_uploads drains the upload queue against a
 * @property {() => number} queue_depth pending gen (in-flight + locally queued) + pending mesh —
 * @property {() => Record<string, number|boolean>} _stream_debug ENG-14 TEMP TELEMETRY (2026-07-04):
 * @property {() => number} resident_count chunks currently resident in the store.
 * @property {(cb: (rec: ChunkRecord) => void) => void} for_each_resident invokes `cb` for each resident
 * @property {(((cb: (rec: { cx: number, cz: number }) => void) => void) & { epoch: () => number })} for_each_rendered_column invokes
 * @property {(wx: number, wy: number, wz: number) => number} block_id_at block id at a WORLD-space
 * @property {(wx: number, wy: number, wz: number) => number | null} block_id_or_null residency-aware
 * @property {(wx: number, wy: number, wz: number) => boolean} chunk_resident true when the chunk containing
 * @property {() => number} rendered_column_count horizontal columns terrain_renderer is DRAWING —
 * @property {() => number} loaded_radius_blocks the effective horizontal load radius in BLOCKS
 * @property {() => number} fog_far_ceiling_m the max fog-far distance (meters) that keeps the fog
 * @property {() => ChunkCoord | null} camera_chunk last camera chunk fed to update(), or null.
 * @property {() => void} dispose cancels in-flight gen jobs and clears queues (does not dispose the
 */
/**
 * @param {[number, number, number]} position world-space meters
 * @returns {ChunkCoord}
 */
export function world_to_chunk_coord([x, y, z]) {
  return [Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)]
}
/**
 * @param {RingOptions} options
 * @returns {RingManager}
 */
export function create_ring_manager({
  pool,
  mesh_pool,
  terrain_renderer,
  load_radius = 7,
  unload_margin = 2,
  vertical_chunks = VERTICAL_CHUNKS,
  max_gen_in_flight = default_gen_in_flight(),
  max_mesh_in_flight = default_gen_in_flight(),
  mesh_pacing_steps = MESH_PACING_STEPS,
  upload_budget_steps = UPLOAD_BUDGET_STEPS,
  forward_bias_chunks2 = FORWARD_BIAS_CHUNKS2,
  mesh_budget_ms = MESH_BUDGET_MS,
  mesh_budget_relaxed_ms = MESH_BUDGET_RELAXED_MS,
  mesh_budget_gpu_bound_ms = MESH_BUDGET_GPU_BOUND_MS,
  mesh_gpu_bound_over_ms = MESH_GPU_BOUND_OVER_MS,
  mesh_relax_under_ms = MESH_RELAX_UNDER_MS,
  frame_governor_ms = FRAME_GOVERNOR_MS,
  mesh_slice = true,
  store_capacity,
  render_fins = false,
  now = default_now,
  on_chunk_loaded,
  on_chunk_unloaded,
  on_chunk_meshed,
  on_mesh_integration,
}) {
  const capacity = store_capacity ?? (2 * (load_radius + unload_margin) + 1) ** 2 * vertical_chunks
  const store = create_chunk_store({ capacity })
  const upload_queue = create_upload_queue({ now })
  /** @typedef {'gen'|'mesh'|'meshing'|'live'} ChunkPhase */
  /** @type {Map<string, ChunkPhase>} */
  const phase = new Map()
  /** @type {Map<string, number>} */
  const rendered_columns = new Map()
  let rendered_column_epoch = 0
  /** @type {Set<string>} */
  const uploaded_keys = new Set()
  /** @param {number} cx @param {number} cy @param {number} cz */
  function mark_uploaded(cx, cy, cz) {
    const ckey = coord_key(cx, cy, cz)
    if (uploaded_keys.has(ckey)) return
    uploaded_keys.add(ckey)
    const col = `${cx},${cz}`
    const count = rendered_columns.get(col) ?? 0
    rendered_columns.set(col, count + 1)
    if (count === 0) rendered_column_epoch += 1
  }
  /** @param {number} cx @param {number} cy @param {number} cz */
  function unmark_uploaded(cx, cy, cz) {
    const ckey = coord_key(cx, cy, cz)
    if (!uploaded_keys.delete(ckey)) return
    const col = `${cx},${cz}`
    const n = rendered_columns.get(col)
    if (n === undefined) return
    if (n <= 1) {
      rendered_columns.delete(col)
      rendered_column_epoch += 1
    } else rendered_columns.set(col, n - 1)
  }
  /** @param {(rec: { cx: number, cz: number }) => void} cb */
  function for_each_rendered_column(cb) {
    for (const key of rendered_columns.keys()) {
      const comma = key.indexOf(',')
      cb({ cx: Number(key.slice(0, comma)), cz: Number(key.slice(comma + 1)) })
    }
  }
  for_each_rendered_column.epoch = () => rendered_column_epoch
  /** @type {ChunkCoord[]} */
  let mesh_ready = []
  /** @type {ChunkCoord[]} */
  let pending_coords = []
  /** @type {ChunkCoord | null} */
  let last_camera_chunk = null
  /** @type {[number, number]} */
  const facing_xz = [0, 0]
  let recent_frame_ms = 0
  let throttle_hold = 0
  let throttled = false
  let disposed = false
  let mesh_slice_ms = 0
  let dbg_update_calls = 0
  let dbg_throttled_calls = 0
  let dbg_meshed_total = 0
  let dbg_meshed_last = 0
  let dbg_mesh_ms_max = 0
  // Crossing-path telemetry (the un-sliced work update() does only when the camera changes chunk —
  // the "discovering terrain" spike surface). cross_ms = unload_far scan + desired-ring rebuild.
  let dbg_cross_ms = 0
  let dbg_cross_ms_max = 0
  let dbg_evicted_last = 0
  let dbg_crossed_last = false
  const THROTTLE_HOLD = 2
  const BOOT_COMPILE_WINDOW_MS = 4000
  let first_update_ms = -1
  function refresh_throttle() {
    if (frame_governor_ms <= 0) {
      throttled = false
      return
    }
    const in_boot_window = first_update_ms >= 0 && now() - first_update_ms < BOOT_COMPILE_WINDOW_MS
    const frame_long = recent_frame_ms === 0 || recent_frame_ms > frame_governor_ms
    if (recent_frame_ms === 0 || (frame_long && in_boot_window)) throttle_hold = THROTTLE_HOLD
    else if (throttle_hold > 0) throttle_hold -= 1
    throttled = throttle_hold > 0
  }
  /** @returns {number} */
  function pending_depth() {
    return pending_coords.length + gen_pending() + mesh_ready.length + (mesh_dispatcher?.in_flight() ?? 0)
  }
  /**
   * @param {readonly (readonly [number, number])[]} steps
   * @param {number} depth
   * @returns {number}
   */
  function ladder_value(steps, depth) {
    let [[, value]] = steps
    for (const [threshold, v] of steps) if (depth >= threshold) value = v
    return value
  }
  /**
   * The ring cells that still need loading, nearest-first. Filters against `phase` BEFORE allocating
   * and sorting: on a settled ring only the freshly-entered shell (~the ring perimeter) survives, so
   * a crossing allocates a few hundred tuples and sorts those — NOT a fresh 2700-tuple array plus a
   * 2700-element sort on EVERY chunk-boundary crossing. That per-crossing allocation storm (2700 short-
   * lived tuples + the wasted sort of cells that were about to be filtered out) was the largest un-
   * sliced main-thread cost on the discovery path and a primary feeder of the chunk-crossing GC hitch
   * (measured cross_ms p50 ~10 ms → single-digit; the rebuild half of the "discovering terrain" spike).
   * sort-then-filter ≡ filter-then-sort for a total order, so the nearest-first load order (the D259
   * spiral) is byte-for-byte unchanged — this is purely an allocation/throughput fix. (§3.2)
   * @param {ChunkCoord} camera_chunk
   * @param {ChunkCoord} center camera centre for nearest-first priority (== camera_center(camera_chunk))
   * @returns {ChunkCoord[]}
   */
  function pending_ring([ccx, , ccz], center) {
    /** @type {ChunkCoord[]} */
    const coords = []
    for (let dx = -load_radius; dx <= load_radius; dx += 1) {
      for (let dz = -load_radius; dz <= load_radius; dz += 1) {
        for (let cy = 0; cy < vertical_chunks; cy += 1) {
          const cx = ccx + dx
          const cz = ccz + dz
          if (phase.has(coord_key(cx, cy, cz))) continue // filter before alloc/sort — skip tracked cells
          coords.push([cx, cy, cz])
        }
      }
    }
    sort_by_distance(coords, center)
    return coords
  }
  /** @param {ChunkCoord} c */
  function camera_center([cx, , cz]) {
    return /** @type {ChunkCoord} */ ([cx, (vertical_chunks - 1) / 2, cz])
  }
  /**
   * @param {ChunkCoord} a
   * @param {ChunkCoord} center
   * @returns {number}
   */
  function dist2(a, center) {
    const dx = a[0] - center[0]
    const dy = a[1] - center[1]
    const dz = a[2] - center[2]
    return dx * dx + dy * dy + dz * dz
  }
  /** @param {ChunkCoord} coord @param {ChunkCoord} center @returns {number} */
  function priority_of(coord, center) {
    const d2 = dist2(coord, center)
    if (forward_bias_chunks2 === 0) return d2
    const [fx, fz] = facing_xz
    if (fx === 0 && fz === 0) return d2
    const ox = (coord[0] - center[0]) * CHUNK_SIZE
    const oz = (coord[2] - center[2]) * CHUNK_SIZE
    const olen2 = ox * ox + oz * oz
    if (olen2 === 0) return d2 // the camera's own column — max priority already
    const dot = ox * fx + oz * fz
    if (dot <= 0) return d2
    const cos = dot / Math.sqrt(olen2)
    return d2 - forward_bias_chunks2 * cos
  }
  /**
   * @param {ChunkCoord[]} coords
   * @param {ChunkCoord} center
   */
  function sort_by_distance(coords, center) {
    coords.sort((a, b) => {
      const pa = priority_of(a, center)
      const pb = priority_of(b, center)
      if (pa !== pb) return pa - pb
      if (a[1] !== b[1]) return a[1] - b[1]
      if (a[0] !== b[0]) return a[0] - b[0]
      return a[2] - b[2]
    })
  }
  /** @param {ChunkCoord} coord */
  function request_gen(coord) {
    const [cx, cy, cz] = coord
    const key = coord_key(cx, cy, cz)
    phase.set(key, 'gen')
    pool.submit(MSG_GEN_REQUEST, { cx, cy, cz }).then(
      /** @param {unknown} result */ (result) => {
        if (disposed || phase.get(key) !== 'gen') return // unloaded mid-flight → drop
        store.put(/** @type {ChunkRecord} */ (result))
        phase.set(key, 'mesh')
        mesh_ready.push(coord)
      },
      () => {
        if (phase.get(key) === 'gen') phase.delete(key)
      }
    )
  }
  /** @returns {number} */
  function gen_pending() {
    let n = 0
    for (const p of phase.values()) if (p === 'gen') n += 1
    return n
  }
  /**
   * @param {ChunkCoord} coord @param {string} key @param {Uint32Array} quad_buffer @param {number} quad_count
   * @param {ChunkCoord} center camera centre for upload priority
   */
  function integrate_meshed(coord, key, quad_buffer, quad_count, center) {
    const [cx, cy, cz] = coord
    phase.set(key, 'live')
    on_chunk_meshed?.()
    dbg_meshed_total += 1
    dbg_meshed_last += 1
    if (quad_count === 0) {
      on_chunk_loaded?.(coord) // all-air: nothing to upload, but it IS resolved
      return
    }
    upload_queue.enqueue({
      key,
      byte_size: quad_count * BYTES_PER_QUAD,
      priority: priority_of(coord, center), // nearest-first + forward-bias: visible area uploads first
      upload() {
        terrain_renderer.upload_chunk([cx, cy, cz], quad_buffer, quad_count)
        mark_uploaded(cx, cy, cz) // this column now DRAWS geometry → far mask may discard over it
        on_chunk_loaded?.(coord)
      },
    })
  }
  /**  @type {import('./mesh_dispatch.js').MeshDispatcher | null} */
  const mesh_dispatcher = mesh_pool
    ? create_mesh_dispatcher({
        mesh_pool,
        store,
        phase,
        render_fins,
        max_in_flight: max_mesh_in_flight,
        integrate: integrate_meshed,
        requeue: (coord) => mesh_ready.push(coord),
        priority: priority_of,
        slice_results: mesh_slice,
        on_integration: on_mesh_integration,
        now,
      })
    : null
  /** @param {ChunkCoord} center camera centre for upload priority */
  function mesh_ready_chunks(center) {
    if (mesh_ready.length === 0) {
      mesh_slice_ms = 0
      return
    }
    sort_by_distance(mesh_ready, center) // small list (≤ in-flight gen budget); cheap to re-sort
    const max_mesh = throttled ? mesh_pacing_steps[0][1] : ladder_value(mesh_pacing_steps, pending_depth())
    const budget_ms =
      !throttled && recent_frame_ms > mesh_gpu_bound_over_ms
        ? mesh_budget_gpu_bound_ms
        : recent_frame_ms > 0 && recent_frame_ms < mesh_relax_under_ms
          ? mesh_budget_relaxed_ms
          : mesh_budget_ms
    if (mesh_dispatcher) {
      mesh_slice_ms = mesh_dispatcher.dispatch(mesh_ready, center, max_mesh, budget_ms)
      if (mesh_slice_ms > dbg_mesh_ms_max) dbg_mesh_ms_max = mesh_slice_ms
      return
    }
    const start = now()
    let meshed = 0
    while (mesh_ready.length > 0 && meshed < max_mesh) {
      if (meshed > 0 && now() - start >= budget_ms) break
      const coord = /** @type {ChunkCoord} */ (mesh_ready.shift())
      const [cx, cy, cz] = coord
      const key = coord_key(cx, cy, cz)
      if (phase.get(key) !== 'mesh') continue // unloaded before we got to it
      const chunk = store.get(cx, cy, cz)
      if (!chunk) {
        phase.delete(key)
        continue
      }
      const { quad_buffer, quad_count } = mesh_chunk(chunk, store.neighbor_halos(cx, cy, cz), render_fins)
      meshed += 1
      integrate_meshed(coord, key, quad_buffer, quad_count, center)
    }
    mesh_slice_ms = now() - start
    if (mesh_slice_ms > dbg_mesh_ms_max) dbg_mesh_ms_max = mesh_slice_ms
  }
  /** @param {ChunkCoord} camera_chunk */
  function unload_far([ccx, , ccz]) {
    const limit = load_radius + unload_margin
    /** @type {string[]} */
    const to_forget = []
    for (const key of phase.keys()) {
      const [cx, , cz] = parse_key(key)
      if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) <= limit) continue
      to_forget.push(key)
    }
    for (const key of to_forget) {
      const [cx, cy, cz] = parse_key(key)
      const was = phase.get(key)
      phase.delete(key)
      upload_queue.cancel(key)
      if (was === 'meshing') mesh_dispatcher?.forget(key)
      if (store.has(cx, cy, cz)) {
        store.evict(cx, cy, cz)
        terrain_renderer.remove_chunk([cx, cy, cz])
        unmark_uploaded(cx, cy, cz) // drop this column's rendered count (no-op if never uploaded)
      } else if (was === 'live') {
        terrain_renderer.remove_chunk([cx, cy, cz])
        unmark_uploaded(cx, cy, cz)
      }
      on_chunk_unloaded?.([cx, cy, cz])
    }
    if (to_forget.length > 0) {
      mesh_ready = mesh_ready.filter(([cx, cy, cz]) => phase.get(coord_key(cx, cy, cz)) === 'mesh')
    }
    return to_forget.length
  }
  /** @param {number} wx @param {number} wy @param {number} wz @returns {number | null} */
  function block_or_null(wx, wy, wz) {
    const iy = Math.floor(wy)
    if (iy < 0 || iy >= WORLD_HEIGHT) return 0 // definitively air (above sky / below bedrock) — never analytic
    const ix = Math.floor(wx)
    const iz = Math.floor(wz)
    const cx = Math.floor(ix / CHUNK_SIZE)
    const cy = Math.floor(iy / CHUNK_SIZE)
    const cz = Math.floor(iz / CHUNK_SIZE)
    const record = store.get(cx, cy, cz) // resident-only; undefined ⇒ unstreamed ⇒ null (analytic ground substitutes)
    if (!record) return null
    const lx = ix - cx * CHUNK_SIZE
    const ly = iy - cy * CHUNK_SIZE
    const lz = iz - cz * CHUNK_SIZE
    return record.ids[local_index(lx, ly, lz)]
  }
  return {
    update(camera_chunk, camera_facing, recent_frame_ms_arg) {
      if (disposed) return
      recent_frame_ms = typeof recent_frame_ms_arg === 'number' ? recent_frame_ms_arg : 0
      if (first_update_ms < 0) first_update_ms = now()
      refresh_throttle()
      dbg_update_calls += 1
      dbg_meshed_last = 0
      if (throttled) dbg_throttled_calls += 1
      if (camera_facing) {
        const [fx, , fz] = camera_facing
        const len = Math.hypot(fx, fz)
        if (len > 1e-4) {
          facing_xz[0] = fx / len
          facing_xz[1] = fz / len
        }
      }
      const changed =
        last_camera_chunk === null ||
        camera_chunk[0] !== last_camera_chunk[0] ||
        camera_chunk[2] !== last_camera_chunk[2]
      last_camera_chunk = camera_chunk
      const center = camera_center(camera_chunk)
      dbg_crossed_last = changed
      if (changed) {
        const cross_start = now()
        dbg_evicted_last = unload_far(camera_chunk)
        pending_coords = pending_ring(camera_chunk, center)
        dbg_cross_ms = now() - cross_start
        if (dbg_cross_ms > dbg_cross_ms_max) dbg_cross_ms_max = dbg_cross_ms
      } else {
        dbg_cross_ms = 0
        dbg_evicted_last = 0
      }
      let in_flight = gen_pending()
      while (in_flight < max_gen_in_flight && pending_coords.length > 0) {
        const coord = /** @type {ChunkCoord} */ (pending_coords.shift())
        if (phase.has(coord_key(coord[0], coord[1], coord[2]))) continue
        request_gen(coord)
        in_flight += 1
      }
      mesh_dispatcher?.drain_results(center)
      mesh_ready_chunks(center)
    },
    drain_uploads(byte_budget) {
      const step = throttled ? upload_budget_steps[0][1] : ladder_value(upload_budget_steps, pending_depth())
      const budget = byte_budget ?? step * DENSE_CHUNK_BYTES
      return upload_queue.drain_frame(budget)
    },
    queue_depth() {
      return gen_pending() + mesh_ready.length + (mesh_dispatcher?.in_flight() ?? 0)
    },
    _stream_debug() {
      return {
        update_calls: dbg_update_calls,
        throttled_calls: dbg_throttled_calls,
        throttle_rate: dbg_update_calls > 0 ? dbg_throttled_calls / dbg_update_calls : 0,
        meshed_total: dbg_meshed_total,
        meshed_last: dbg_meshed_last,
        mesh_ms_last: mesh_slice_ms,
        mesh_ms_max: dbg_mesh_ms_max,
        cross_ms_last: dbg_cross_ms,
        cross_ms_max: dbg_cross_ms_max,
        crossed_last: dbg_crossed_last,
        evicted_last: dbg_evicted_last,
        pending_depth: pending_depth(),
        throttled,
        recent_frame_ms,
      }
    },
    resident_count() {
      return store.size()
    },
    for_each_resident(cb) {
      for (const rec of store.values()) cb(rec)
    },
    for_each_rendered_column,
    block_id_at(wx, wy, wz) {
      return block_or_null(wx, wy, wz) ?? 0
    },
    block_id_or_null(wx, wy, wz) {
      return block_or_null(wx, wy, wz)
    },
    chunk_resident(wx, wy, wz) {
      const cx = Math.floor(Math.floor(wx) / CHUNK_SIZE)
      const cy = Math.floor(Math.floor(wy) / CHUNK_SIZE)
      const cz = Math.floor(Math.floor(wz) / CHUNK_SIZE)
      return cy >= 0 && cy < vertical_chunks && store.has(cx, cy, cz)
    },
    rendered_column_count() {
      return rendered_columns.size
    },
    loaded_radius_blocks() {
      return load_radius * CHUNK_SIZE
    },
    fog_far_ceiling_m() {
      return (load_radius - 1.5) * CHUNK_SIZE
    },
    camera_chunk() {
      return last_camera_chunk
    },
    dispose() {
      disposed = true
      mesh_dispatcher?.reset()
      phase.clear()
      mesh_ready = []
      pending_coords = []
    },
  }
}
/**
 * @param {string} key
 * @returns {ChunkCoord}
 */
function parse_key(key) {
  const [cx, cy, cz] = key.split(',').map(Number)
  return [cx, cy, cz]
}
function default_gen_in_flight() {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4
  return Math.max(2, cores * 2)
}
function default_now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
