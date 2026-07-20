// Off-thread near-mesh dispatcher (§3.2 MESH POOL). The ring's mesh stage, when a mesh worker pool is
// available: instead of running mesh_chunk() on the render thread (a dense chunk = 76-510 ms of greedy
// merge + AO + sprites = a frame stall), it serializes each ready chunk + its neighbour rim (mesh_halo.js)
// and dispatches the mesh to the pool, integrating the packed quad buffer back on the main thread (an
// upload enqueue only — no compute). The ring keeps the SYNCHRONOUS mesh_chunk path as its fallback for
// any environment without a pool (tests, the WebGL floor); this module is engaged only when one is wired.
//
// STALE-RESULT DROP: a chunk unloaded (or re-generated) while its mesh is in flight must NOT apply the old
// result. Each dispatch stamps the chunk's key with a monotonic epoch; unload calls forget(key) to clear
// it; a returning result is integrated ONLY if the key's epoch still equals the one it was dispatched with
// (so an unload → drop, and a re-dispatch → only the newest wins). Fresh replies wait in a frame-drained
// queue: result unpack + ring integration get one shared 3 ms wall-clock slice, with one indivisible result
// always admitted. Nearest-first + a bounded pending ceiling keep the pool fed without flooding either
// workers or the main-thread integration queue during a fly.

import { coord_key } from '../chunks/store.js'
import { serialize_mesh_job } from '../mesh/mesh_halo.js'
import { MSG_MESH_REQUEST } from '../workers/rpc.js'

/** @typedef {[number, number, number]} ChunkCoord */
/** @typedef {import('../workers/pool.js').WorkerPool} WorkerPool */

/** Worker-reply unpack + ring-integration wall-clock budget per render frame. */
export const MESH_INTEGRATION_BUDGET_MS = 3

/**
 * @typedef {object} CompletedMesh
 * @property {ChunkCoord} coord
 * @property {string} key
 * @property {number} epoch
 * @property {number} arrival
 * @property {unknown} result raw worker payload; unpacked only inside the integration slice
 */

/**
 * @typedef {object} MeshDispatcherOptions
 * @property {WorkerPool} mesh_pool the module-worker pool running mesh_worker.js
 * @property {{ get: (cx: number, cy: number, cz: number) => any, get_resident: (cx: number, cy: number, cz: number) => any }} store
 *   the ring's chunk store — get (LRU-touch) for the chunk being meshed, get_resident (no touch) for its
 *   neighbour rim
 * @property {Map<string, string>} phase the ring's chunk phase map; this module drives 'mesh' → 'meshing'
 *   → 'live'
 * @property {boolean} render_fins the tier leaf-fin flag forwarded to mesh_chunk
 * @property {number} max_in_flight ceiling on concurrent dispatched-but-not-integrated mesh jobs
 * @property {(coord: ChunkCoord, key: string, quad_buffer: Uint32Array, quad_count: number, center: ChunkCoord) => void}
 *   integrate the ring's shared meshed-result handler (phase→live + upload enqueue / all-air count). Called
 *   ONLY for a fresh (non-stale), non-disposed result.
 * @property {(coord: ChunkCoord) => void} requeue re-adds a coord to the ring's mesh-ready set (used only on
 *   a rare pool rejection so the chunk isn't stranded un-meshed)
 * @property {(coord: ChunkCoord, center: ChunkCoord) => number} priority existing ring priority score
 *   (nearest first with its bounded camera-facing tiebreak)
 * @property {boolean} slice_results default-on integration slice; false preserves immediate reply integration
 * @property {(elapsed_ms: number) => void} [on_integration] frame/probe timing hook
 * @property {() => number} now injectable clock (ms)
 */

/**
 * @typedef {object} MeshDispatcher
 * @property {(mesh_ready: ChunkCoord[], center: ChunkCoord, max_dispatch: number, budget_ms: number) => number}
 *   dispatch pulls nearest-first from mesh_ready (already sorted by the caller), serializes + submits up to
 *   max_dispatch jobs under a wall-clock slice and the in-flight ceiling; returns the serialization slice ms.
 * @property {(center: ChunkCoord) => number} drain_results integrates queued worker replies under the 3 ms
 *   wall-clock slice; always admits one fresh result and returns elapsed slice time
 * @property {() => number} in_flight dispatched-but-not-integrated mesh jobs (feeds queue_depth / pending_depth)
 * @property {(key: string) => void} forget clears a key's epoch so an in-flight result for it is dropped
 * @property {() => void} reset drops all epochs + zeroes in-flight (dispose)
 */

/**
 * @param {MeshDispatcherOptions} options
 * @returns {MeshDispatcher}
 */
export function create_mesh_dispatcher({
  mesh_pool,
  store,
  phase,
  render_fins,
  max_in_flight,
  integrate,
  requeue,
  priority,
  slice_results = true,
  on_integration,
  now,
}) {
  /** Monotonic dispatch stamp — the newest epoch per key is the only one allowed to integrate. */
  let seq = 0
  /** key → epoch of its latest in-flight dispatch; absent ⇒ nothing wanted for that key. @type {Map<string, number>} */
  const epoch_of = new Map()
  let pending = 0
  let disposed = false
  let arrival_seq = 0
  /** Fresh worker replies, retained across frames until the integration slice admits them. @type {CompletedMesh[]} */
  const completed = []
  /** Current drain centre read by the hoisted comparator (avoids a fresh sort closure per frame). */
  /** @type {ChunkCoord} */
  let drain_center = [0, 0, 0]
  /** Stable nearest/view-priority order; equal scores retain worker arrival order. */
  const by_priority = (/** @type {CompletedMesh} */ a, /** @type {CompletedMesh} */ b) => {
    const delta = priority(a.coord, drain_center) - priority(b.coord, drain_center)
    return delta || a.arrival - b.arrival
  }

  /** @param {CompletedMesh} item @param {ChunkCoord} center */
  function integrate_result(item, center) {
    const { coord, key, epoch, result } = item
    pending -= 1
    if (epoch_of.get(key) !== epoch) return false // unloaded after arrival → stale queued reply
    epoch_of.delete(key)
    const { quad_buffer, quad_count } = /** @type {{ quad_buffer: Uint32Array, quad_count: number }} */ (result)
    integrate(coord, key, quad_buffer, quad_count, center)
    return true
  }

  return {
    dispatch(mesh_ready, center, max_dispatch, budget_ms) {
      const start = now()
      let dispatched = 0
      while (mesh_ready.length > 0 && dispatched < max_dispatch && pending < max_in_flight) {
        // Deadline BETWEEN serializations (never mid-chunk): always serialize the first, then bail once
        // this frame's slice is spent — carry the rest to the next frame (mirrors the sync mesh slice).
        if (dispatched > 0 && now() - start >= budget_ms) break
        const coord = /** @type {ChunkCoord} */ (mesh_ready.shift())
        const [cx, cy, cz] = coord
        const key = coord_key(cx, cy, cz)
        if (phase.get(key) !== 'mesh') continue // unloaded / already consumed before we got to it
        const chunk = store.get(cx, cy, cz)
        if (!chunk) {
          phase.delete(key)
          continue
        }
        const { payload, transfer } = serialize_mesh_job(chunk, store.get_resident, render_fins)
        const epoch = (seq += 1)
        epoch_of.set(key, epoch)
        phase.set(key, 'meshing')
        pending += 1
        dispatched += 1
        mesh_pool.submit(MSG_MESH_REQUEST, payload, transfer).then(
          /** @param {unknown} result */ (result) => {
            if (disposed) return
            if (epoch_of.get(key) !== epoch) {
              pending -= 1 // stale before queueing: unloaded or re-dispatched → drop
              return
            }
            const item = { coord, key, epoch, arrival: (arrival_seq += 1), result }
            if (slice_results) {
              completed.push(item) // raw payload stays packed until a render-frame slice admits it
              return
            }
            // `?mesh_slice=0`: exact pre-slice behavior — unpack + integrate in the Promise continuation.
            if (!on_integration) {
              integrate_result(item, center)
              return
            }
            const start = now()
            integrate_result(item, center)
            on_integration?.(now() - start)
          },
          () => {
            if (disposed) return
            pending -= 1
            // Pool rejection (backpressure/dispose): if still the wanted generation, revert to 'mesh' and
            // re-queue so a later frame retries — the chunk is never stranded un-meshed.
            if (epoch_of.get(key) !== epoch) return
            epoch_of.delete(key)
            phase.set(key, 'mesh')
            requeue(coord)
          }
        )
      }
      return now() - start
    },

    drain_results(center) {
      if (!slice_results || completed.length === 0) return 0
      const start = now()
      drain_center = center
      completed.sort(by_priority)
      let integrated = 0
      while (completed.length > 0) {
        // Deadline BETWEEN results: one fresh result always runs, even when it alone exceeds 3 ms.
        if (integrated > 0 && now() - start >= MESH_INTEGRATION_BUDGET_MS) break
        const item = /** @type {CompletedMesh} */ (completed.shift())
        if (integrate_result(item, center)) integrated += 1
      }
      const elapsed = now() - start
      on_integration?.(elapsed)
      return elapsed
    },

    in_flight() {
      return pending
    },

    forget(key) {
      epoch_of.delete(key)
    },

    reset() {
      disposed = true
      epoch_of.clear()
      completed.length = 0
      pending = 0
    },
  }
}
