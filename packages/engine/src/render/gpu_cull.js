// NG-MEGA GPU cull (plan §11 / playbook #9 rung 2 / survey S22) — the compute pass that frustum-culls
// every occupied pool slot each frame and writes the per-slot indirect draw args. ONE thread per slot
// tests the slot's chunk AABB against the 6 camera planes and writes the slot's `instanceCount` (0 =
// culled, else the slot's quad count) straight into the IndirectStorageBufferAttribute the render pass
// draws from (created STORAGE|INDIRECT — WebGPUBackend.createIndirectStorageAttribute). So camera
// motion (pan / fly) becomes a GPU-side arg update: zero CPU per frame, zero re-records, zero pipeline
// churn — the structural cure for the rotation-while-streaming tail.
//
// PLANE EXTRACTION reuses three's own `Frustum.setFromProjectionMatrix(vp, coordinateSystem,
// reversedDepth)` on the CPU (three's own reversed-Z-aware frustum extraction), so the reversed-Z /
// WebGPU-clip-space plane math is inherited correct — the 6 planes are then uploaded through a tiny
// (96-byte) storage buffer the kernel reads. If no renderer is available (e.g. the cube-gate injected
// renderer), the cull simply never runs and every resident slot stays all-visible (drawn) — correct,
// just unculled.

import { Frustum, Matrix4 } from 'three'
import { Fn, dot, instanceIndex, storage, uint, uvec4, vec3 } from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

/**
 * @typedef {object} GpuCull
 * @property {import('three/webgpu').StorageBufferAttribute} planes_attr the 6-plane storage buffer
 *   (6× vec4 [nx, ny, nz, constant]) written on the CPU each frame from the camera frustum.
 * @property {*} cull_node the ComputeNode (renderer.compute runs it).
 * @property {(renderer: import('three/webgpu').WebGPURenderer, camera: import('three').Camera) => void}
 *   run extracts the camera frustum planes, uploads them, and dispatches the cull compute pass. Call
 *   once per frame BEFORE renderer.render, after the pool's meta/indirect buffers reflect this frame's
 *   membership.
 * @property {() => void} dispose releases the compute node + planes buffer.
 */

/**
 * Builds the GPU cull for one pool (one material class). Reads the pool's per-slot `meta_attr`
 * ([ox,oy,oz,count] — count 0 marks a free slot) and writes its `indirect_attr` ([vertexCount,
 * instanceCount, firstVertex, firstInstance] per slot). The kernel fully re-derives the static args
 * (vertexCount 6, firstVertex 0, firstInstance = slot·S) so it OWNS the indirect buffer end-to-end.
 * @param {object} options
 * @param {import('three/webgpu').StorageBufferAttribute} options.meta_attr per-slot [ox,oy,oz,count] (vec4)
 * @param {import('three/webgpu').IndirectStorageBufferAttribute} options.indirect_attr per-slot draw args
 * @param {number} options.slot_quads S — pool slot size (firstInstance = slot·S)
 * @param {number} options.max_slots slot count = compute thread count
 * @param {number} options.chunk_size world edge of a chunk's AABB (CHUNK_SIZE)
 * @param {number} [options.aabb_margin] AABB padding (m) — over-includes so the +1 positive-face push
 *   and greedy-quad extent can never be under-culled (never drops visible geometry). Default 1.
 * @returns {GpuCull}
 */
export function create_gpu_cull({ meta_attr, indirect_attr, slot_quads, max_slots, chunk_size, aabb_margin = 1 }) {
  const planes_array = new Float32Array(6 * 4)
  const planes_attr = new StorageBufferAttribute(planes_array, 4)

  const meta_storage = storage(meta_attr, 'vec4', max_slots).toReadOnly()
  const planes_storage = storage(planes_attr, 'vec4', 6).toReadOnly()
  const indirect_storage = storage(indirect_attr, 'uvec4', max_slots) // read_write (default access)

  const S = uint(slot_quads)
  const HI = chunk_size + aabb_margin
  const LO = -aabb_margin

  const cull_node = Fn(() => {
    const slot = instanceIndex
    const meta = meta_storage.element(slot)
    const count = meta.w
    const lo = meta.xyz.add(vec3(LO))
    const hi = meta.xyz.add(vec3(HI))

    // Positive-vertex AABB / frustum-plane test: the box is fully OUTSIDE plane k iff its vertex
    // farthest along the plane normal is still behind the plane. Culled if outside ANY plane — or a
    // free slot (count 0). Six planes unrolled (fixed count; no Loop node needed).
    let culled = count.lessThan(0.5)
    for (let k = 0; k < 6; k += 1) {
      const p = planes_storage.element(k)
      const n = p.xyz
      const pv = vec3(
        n.x.greaterThan(0).select(hi.x, lo.x),
        n.y.greaterThan(0).select(hi.y, lo.y),
        n.z.greaterThan(0).select(hi.z, lo.z)
      )
      culled = culled.or(dot(n, pv).add(p.w).lessThan(0))
    }

    const instance_count = culled.select(uint(0), uint(count))
    // Fully re-derive the draw args so the cull owns the indirect buffer: [vertexCount, instanceCount,
    // firstVertex, firstInstance=slot·S] — 6 verts (the unit quad), firstInstance is the global base.
    indirect_storage.element(slot).assign(uvec4(uint(6), instance_count, uint(0), slot.mul(S)))
  })().compute(max_slots)

  const frustum = new Frustum()
  const view_projection = new Matrix4()

  return {
    planes_attr,
    cull_node,
    run(renderer, camera) {
      camera.updateMatrixWorld()
      view_projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      // Reversed-Z / WebGPU-aware plane extraction (three's Frustum with coordinateSystem + reversedDepth) — the matrix
      // and the flags always come from the same camera, so the frustum is self-consistent every frame.
      frustum.setFromProjectionMatrix(
        view_projection,
        /** @type {*} */ (camera).coordinateSystem,
        /** @type {*} */ (camera).reversedDepth
      )
      for (let k = 0; k < 6; k += 1) {
        const plane = frustum.planes[k]
        planes_array[k * 4] = plane.normal.x
        planes_array[k * 4 + 1] = plane.normal.y
        planes_array[k * 4 + 2] = plane.normal.z
        planes_array[k * 4 + 3] = plane.constant
      }
      planes_attr.needsUpdate = true
      renderer.compute(cull_node)
    },
    dispose() {
      ;/** @type {*} */ (cull_node).dispose?.()
    },
  }
}
