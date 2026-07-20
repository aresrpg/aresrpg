// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gen produces fresh ArrayBuffer-backed chunk records and transfers every buffer to the main realm.

import { MSG_GEN_CONFIG, MSG_GEN_REQUEST, MSG_GEN_RESULT, MSG_ERROR, decode_message } from '../workers/rpc.js'

import { generate_world_chunk, set_gen_config } from './world_gen.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */

// tsconfig.json's `lib` omits "webworker" (shared config, not owned here), so ambient `self`
// resolves to the DOM Window overloads that reject the (message, transferList) worker signature.
// Narrow locally — same pattern as mesh_worker.js.
const worker_self =
  /** @type {{ postMessage: (message: unknown, transfer?: Transferable[]) => void, addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void }} */ (
    /** @type {unknown} */ (self)
  )

/**
 * Every ArrayBuffer backing a chunk record, including nested occupancy arrays.
 * @param {ChunkRecord} chunk
 * @returns {Transferable[]}
 */
function chunk_buffers(chunk) {
  return [
    chunk.ids.buffer,
    chunk.light.buffer,
    chunk.height.buffer,
    chunk.occupancy[0].buffer,
    chunk.occupancy[1].buffer,
    chunk.occupancy[2].buffer,
    chunk.biome.buffer,
  ]
}

/** @param {MessageEvent} event */
function handle_message(event) {
  let envelope
  try {
    envelope = decode_message(event.data)
  } catch {
    // Malformed envelope: nothing to correlate a response to — drop it (rpc.js "never throw
    // across the worker boundary" contract).
    return
  }

  // Config-first world selection (§2.3): the pool posts this ONCE at spawn, before any gen request,
  // so this worker generates the SELECTED world. Fire-and-forget — no MSG_GEN_RESULT reply.
  if (envelope.type === MSG_GEN_CONFIG) {
    set_gen_config(/** @type {import('../config/world_gen_config.js').WorldGenConfig} */ (envelope.payload))
    return
  }

  if (envelope.type !== MSG_GEN_REQUEST) return

  try {
    const { cx, cy, cz } = /** @type {{ cx: number, cy: number, cz: number }} */ (envelope.payload)
    const chunk = generate_world_chunk(cx, cy, cz)

    worker_self.postMessage(
      { type: MSG_GEN_RESULT, job_id: envelope.job_id, mode: 'transfer', payload: chunk },
      chunk_buffers(chunk)
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
