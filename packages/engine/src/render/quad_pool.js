// NG-MEGA quad pool (plan §11 PERF NORTH STAR / playbook #9 / survey S22+rowannadon) — ONE mega
// storage buffer of terrain quads for a whole material class, drawn by ONE pipeline via per-slot
// `drawIndirect` with `firstInstance` addressing (three r185 `geometry.setIndirect(attr, [offsets])`
// loops one indirect draw per offset — WebGPUBackend.js:1874). This structurally deletes the
// per-chunk InstancedMesh / per-chunk material / per-chunk pipeline compile / sector BundleGroup /
// re-record machinery: a chunk upload is a buffer write into a free slot, removal frees the slot,
// and camera motion is a GPU-side arg update (the cull), never a CPU re-record.
//
// ADDRESSING (the whole trick). Fixed-size slots of `slot_quads` (S, a power of two) each. Slot `k`
// owns pool quads [k·S, k·S + count_k). A chunk's quads for this class occupy ⌈count/S⌉ slots
// (INDEPENDENT — not required contiguous; each slot replicates the chunk world origin into its meta,
// so the vertex stage recovers the origin from any global quad index). Per WebGPU the vertex-stage
// `@builtin(instance_index)` = firstInstance + local, so with firstInstance = k·S the shader's
// `instanceIndex` IS the global quad index: `slot = instanceIndex >> log2(S)` gives the meta row for
// the chunk origin, and `pool[instanceIndex]` is the 8-byte quad. Verified on Metal-3 hardware:
// `indirect-first-instance` is advertised (probe 2026-07-03), so firstInstance addressing is legal.
//
// FRAGMENTATION. Fixed interchangeable slots ⇒ ZERO external fragmentation and O(1) alloc/free (a
// free-list stack). Internal fragmentation is the unused tail of each chunk's LAST slot — VRAM only,
// never drawn (the indirect draw's instanceCount is the real quad count, so the tail is skipped), so
// it costs zero fill/vertex work. This is the deliberate trade vs. variable packing + defragmentation
// (the Voxelith 256 MB counter-example, survey §5). S is sized per class to the measured max chunk
// (solid ≈2200, foliage ≈290, liquid ≈30 quads/chunk — node size_probe 2026-07-03) so real chunks are
// single-slot; oversized chunks (or a denser world fork) split into extra independent slots, never drop.

import { BufferAttribute, InstancedBufferGeometry } from 'three'
import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu'

/** Indirect draw-arg layout: [vertexCount, instanceCount, firstVertex, firstInstance] (WebGPU
 *  non-indexed drawIndirect). 4 u32 = 16 bytes/slot; the byte offset of slot k's args is k·16. */
const INDIRECT_STRIDE_U32 = 4
const QUAD_VERTS = 6 // the unit quad is 2 tris / 6 non-indexed verts (matches create_unit_quad_geometry)

/**
 * @typedef {object} QuadPool
 * @property {import('three').InstancedBufferGeometry} geometry the shared unit-quad geometry with the
 *   per-slot indirect draw list attached (`setIndirect`); one Mesh built from it draws the whole class.
 * @property {StorageBufferAttribute} pool_attr the mega quad buffer (uvec2 per quad), read-only in VS.
 * @property {StorageBufferAttribute} meta_attr per-slot [origin_x, origin_y, origin_z, quad_count]
 *   (vec4). quad_count 0 marks a free slot; read by the VS (origin) and the cull (aabb + occupancy).
 * @property {IndirectStorageBufferAttribute} indirect_attr per-slot draw args; instanceCount is
 *   written all-visible on upload (so a chunk renders without any cull pass — the cube gate injects a
 *   pool renderer whose update() never runs) and refined per-frame by the cull (0 = culled).
 * @property {number} slot_quads S — quads per slot (power of two).
 * @property {number} max_slots slot capacity of this pool.
 * @property {(chunk_key: string, quads: Uint32Array, count: number, origin: [number,number,number]) => boolean}
 *   write_chunk writes a chunk's class quads into freshly-allocated slot(s); false if the pool is full
 *   (caller logs + skips — a soft miss, never a crash). Replaces in place if the key already resident.
 * @property {(chunk_key: string) => void} remove_chunk frees a chunk's slots (instanceCount→0, slot→free-list).
 * @property {() => { slots: number, quads: number, capacity_quads: number, utilization: number }} stats
 *   occupied slots, live quads, quad capacity, and utilization (live / (occupied·S)) for the report.
 * @property {() => void} dispose frees the geometry + storage buffers.
 */

/**
 * Builds the shared per-slot unit-quad geometry: an InstancedBufferGeometry carrying the SAME
 * `position` (18-float placeholder) + `corner` (0-3 per vertex) attributes as the per-chunk path's
 * `create_unit_quad_geometry`, so the vertex stage decodes identically. `instanceCount` is set to the
 * pool's quad capacity purely so three's getDrawParameters doesn't early-out on a zero count
 * (RenderObject.js: instanceCount===0 ⇒ object skipped) — the indirect args override the real counts.
 * @param {number} capacity_quads max_slots·slot_quads
 * @returns {InstancedBufferGeometry}
 */
function create_pool_geometry(capacity_quads) {
  const geometry = new InstancedBufferGeometry()
  // Two CCW triangles over corners (0,0)(1,0)(0,1)(1,1): (0,1,2) and (2,1,3) — identical winding to
  // create_unit_quad_geometry so the AO corner order + DoubleSide verdict carry over unchanged.
  geometry.setAttribute('corner', new BufferAttribute(new Float32Array([0, 1, 2, 2, 1, 3]), 1))
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(18), 3))
  geometry.instanceCount = capacity_quads
  return geometry
}

/**
 * Creates one material-class quad pool (buffers + O(1) slot allocator + partial-upload writer + the
 * indirect draw list). GPU-agnostic: it only builds CPU-side typed-array attributes + a geometry; the
 * WebGPURenderer materializes the GPU buffers lazily on first render (so the pool works in the cube
 * gate's in-page renderer that is constructed with `renderer: null`). `slot_quads` MUST be a power of
 * two (the VS derives the slot via a shift).
 * @param {object} options
 * @param {number} options.slot_quads S — quads per slot (power of two)
 * @param {number} options.max_slots slot capacity
 * @returns {QuadPool}
 */
export function create_quad_pool({ slot_quads, max_slots }) {
  if ((slot_quads & (slot_quads - 1)) !== 0) {
    throw new Error(`quad_pool: slot_quads must be a power of two (got ${slot_quads})`)
  }
  const capacity_quads = max_slots * slot_quads

  // pool_attr: uvec2 per quad — pass an explicit Uint32Array (the 2-arg TypedArray ctor form, so the
  // attribute keeps u32 storage; the 3-arg typeClass form exists at runtime but not in @types/three).
  const pool_array = new Uint32Array(capacity_quads * 2)
  const pool_attr = new StorageBufferAttribute(pool_array, 2)
  // meta_attr: vec4 [ox, oy, oz, quad_count] per slot. Float32 — counts (<2^24) are exact.
  const meta_array = new Float32Array(max_slots * 4)
  const meta_attr = new StorageBufferAttribute(meta_array, 4)
  // indirect_attr: [vertexCount, instanceCount, firstVertex, firstInstance] per slot.
  const indirect_array = new Uint32Array(max_slots * INDIRECT_STRIDE_U32)
  const indirect_attr = new IndirectStorageBufferAttribute(indirect_array, INDIRECT_STRIDE_U32)

  // Pre-stamp every slot's STATIC indirect fields (vertexCount, firstVertex, firstInstance) once;
  // only instanceCount (index k·4+1) ever changes after this (on upload / by the cull). firstInstance
  // = k·S is the whole addressing scheme.
  for (let k = 0; k < max_slots; k += 1) {
    indirect_array[k * INDIRECT_STRIDE_U32] = QUAD_VERTS // vertexCount
    indirect_array[k * INDIRECT_STRIDE_U32 + 1] = 0 // instanceCount (empty)
    indirect_array[k * INDIRECT_STRIDE_U32 + 2] = 0 // firstVertex
    indirect_array[k * INDIRECT_STRIDE_U32 + 3] = k * slot_quads // firstInstance = global base
  }

  const geometry = create_pool_geometry(capacity_quads)

  // O(1) free-list (stack of free slot indices, high-to-low so alloc hands out low indices first —
  // keeps the active-offsets list roughly ascending, nicer for the driver's sequential indirect reads).
  /** @type {number[]} */
  const free_slots = []
  for (let k = max_slots - 1; k >= 0; k -= 1) free_slots.push(k)
  /** chunk_key → the slot indices it occupies (1 for a normal chunk, ⌈count/S⌉ for an oversized one).
   *  @type {Map<string, number[]>} */
  const chunk_slots = new Map()
  /** Ordered list of byte-offsets (slot·16) for every OCCUPIED slot — the geometry.indirect draw list.
   *  Rebuilt on alloc/free (a membership change), NOT per frame; culled slots stay in it and draw 0
   *  instances (cheap, no re-record). @type {number[]} */
  let active_offsets = []

  geometry.setIndirect(indirect_attr, active_offsets)

  /** Recomputes the indirect draw list from the current occupancy (union of every chunk's slots). */
  function rebuild_offsets() {
    active_offsets = []
    for (const slots of chunk_slots.values()) {
      for (const slot of slots) active_offsets.push(slot * INDIRECT_STRIDE_U32 * 4) // byte offset
    }
    geometry.setIndirect(indirect_attr, active_offsets)
  }

  /**
   * Writes one slot's quad range into the pool + its meta + indirect args, uploading only that slot's
   * bytes (addUpdateRange is in Uint32-ELEMENT units — WebGPUAttributeUtils.js:257). instanceCount is
   * set all-visible; the cull refines it.
   * @param {number} slot @param {Uint32Array} quads @param {number} q_start first quad (in `quads`) for this slot
   * @param {number} q_count quads written into this slot (≤ S) @param {[number,number,number]} origin
   */
  function write_slot(slot, quads, q_start, q_count, origin) {
    const base_u32 = slot * slot_quads * 2
    pool_array.set(quads.subarray(q_start * 2, (q_start + q_count) * 2), base_u32)
    pool_attr.addUpdateRange(base_u32, q_count * 2)
    pool_attr.needsUpdate = true

    const m = slot * 4
    const [origin_x, origin_y, origin_z] = origin
    meta_array[m] = origin_x
    meta_array[m + 1] = origin_y
    meta_array[m + 2] = origin_z
    meta_array[m + 3] = q_count
    indirect_array[slot * INDIRECT_STRIDE_U32 + 1] = q_count // all-visible on upload
  }

  return {
    geometry,
    pool_attr,
    meta_attr,
    indirect_attr,
    slot_quads,
    max_slots,

    write_chunk(chunk_key, quads, count, origin) {
      if (chunk_slots.has(chunk_key)) this.remove_chunk(chunk_key)
      if (count <= 0) return true
      const n_slots = Math.ceil(count / slot_quads)
      if (free_slots.length < n_slots) return false // pool full — caller logs + skips this class

      /** @type {number[]} */
      const slots = []
      for (let k = 0; k < n_slots; k += 1) {
        const slot = /** @type {number} */ (free_slots.pop())
        const q_start = k * slot_quads
        const q_count = Math.min(slot_quads, count - q_start)
        write_slot(slot, quads, q_start, q_count, origin)
        slots.push(slot)
      }
      chunk_slots.set(chunk_key, slots)
      // meta + indirect are tiny (max_slots·16 B) — full re-upload each membership change is cheap.
      meta_attr.needsUpdate = true
      indirect_attr.needsUpdate = true
      rebuild_offsets()
      return true
    },

    remove_chunk(chunk_key) {
      const slots = chunk_slots.get(chunk_key)
      if (!slots) return
      for (const slot of slots) {
        indirect_array[slot * INDIRECT_STRIDE_U32 + 1] = 0 // stop drawing this slot
        meta_array[slot * 4 + 3] = 0 // mark free (cull skips count==0 slots)
        free_slots.push(slot)
      }
      chunk_slots.delete(chunk_key)
      meta_attr.needsUpdate = true
      indirect_attr.needsUpdate = true
      rebuild_offsets()
    },

    stats() {
      let quads = 0
      let slots = 0
      for (const s of chunk_slots.values()) {
        slots += s.length
        for (const slot of s) quads += meta_array[slot * 4 + 3]
      }
      return {
        slots,
        quads,
        capacity_quads,
        utilization: slots > 0 ? quads / (slots * slot_quads) : 0,
      }
    },

    dispose() {
      geometry.dispose()
      chunk_slots.clear()
      free_slots.length = 0
      active_offsets = []
    },
  }
}
