// Mesh worker entry (§3.2 "MESH POOL: light BFS → binary greedy → quad packing"). Module worker speaking
// the frozen rpc.js envelope: receives MSG_MESH_REQUEST with a serialized chunk + its 1-voxel neighbour rim
// (mesh_halo.js), runs the FULL near-mesh pipeline off the main thread (mesh_chunk: greedy solid pass, AO,
// smooth sun, liquids, cross flora, leaf sprites — halo-aware, so seam faces cull + boundary AO/light match
// the interior exactly like the inline path), and posts back MSH_MESH_RESULT with the packed quad buffer
// TRANSFERRED (zero-copy) to the main thread.
//
// ONE MESHER: mesh_chunk is the same pure module the ring's main-thread fallback imports — this worker only
// (de)serializes the store-resident state across the boundary (mesh_halo.js) and feeds it in. So there is a
// single mesh implementation; the worker is not a fork.

import { MSG_MESH_REQUEST, MSH_MESH_RESULT, MSG_ERROR, decode_message } from '../workers/rpc.js'

import { deserialize_mesh_job } from './mesh_halo.js'
import { mesh_chunk } from './mesher.js'

// tsconfig's `lib` omits "webworker" (shared config, not owned here), so ambient `self` resolves to the DOM
// Window overloads that reject the (message, transferList) worker signature. Narrow locally — same pattern
// as gen_worker.js / far_section_worker.js.
const worker_self =
  /** @type {{ postMessage: (message: unknown, transfer?: Transferable[]) => void, addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void }} */ (
    /** @type {unknown} */ (self)
  )

/** @param {MessageEvent} event */
function handle_message(event) {
  let envelope
  try {
    envelope = decode_message(event.data)
  } catch {
    // Malformed envelope: nothing to correlate a response to — drop it (rpc.js "never throw across the
    // worker boundary" contract).
    return
  }

  if (envelope.type !== MSG_MESH_REQUEST) return

  try {
    const { chunk, halos, render_fins } = deserialize_mesh_job(
      /** @type {import('./mesh_halo.js').MeshJobPayload} */ (envelope.payload)
    )
    const { quad_buffer, quad_count } = mesh_chunk(chunk, halos, render_fins)

    worker_self.postMessage(
      {
        type: MSH_MESH_RESULT,
        job_id: envelope.job_id,
        mode: 'transfer',
        payload: { cx: chunk.cx, cy: chunk.cy, cz: chunk.cz, quad_buffer, quad_count },
      },
      [quad_buffer.buffer]
    )
  } catch (error) {
    worker_self.postMessage({
      type: MSG_ERROR,
      job_id: envelope.job_id,
      mode: 'transfer',
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

worker_self.addEventListener('message', handle_message)
