// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Worker RPC protocol. Payload buffers use one transfer-only mode.

/** Main → gen: set the world recipe (WorldGenConfig) this worker generates from. Posted ONCE to each
 *  gen worker at spawn (pool `init_message`), before any MSG_GEN_REQUEST, so every worker derives the
 *  SAME selected world (§2.3 config-first world selection). Fire-and-forget: no MSG_GEN_RESULT reply. */
export const MSG_GEN_CONFIG = 'gen_config'
/** Main → gen: request a column be generated at the given chunk coordinates. */
export const MSG_GEN_REQUEST = 'gen_request'
/** Gen → main (or gen → mesh, when routed directly): generated column data, stage advanced. */
export const MSG_GEN_RESULT = 'gen_result'
/** Main/gen → mesh: request a chunk (+halo) be meshed. */
export const MSG_MESH_REQUEST = 'mesh_request'
/** Mesh → main: packed quad buffers ready for upload. */
export const MSH_MESH_RESULT = 'mesh_result'
/** Main → far worker: build one far-LOD section (NG-LOD phase B). Payload {level,sx,sz,seed}. */
export const MSG_FAR_SECTION_REQUEST = 'far_section_request'
/** Far worker → main: a built FarMesh for the requested section (its `data` buffer is transferred). */
export const MSG_FAR_SECTION_RESULT = 'far_section_result'
/** Worker → main: unrecoverable job failure (message must still be handled, never thrown). */
export const MSG_ERROR = 'error'

/** @typedef {typeof MSG_GEN_CONFIG|typeof MSG_GEN_REQUEST|typeof MSG_GEN_RESULT|typeof MSG_MESH_REQUEST|typeof MSH_MESH_RESULT|typeof MSG_FAR_SECTION_REQUEST|typeof MSG_FAR_SECTION_RESULT|typeof MSG_ERROR} MessageType */

/**
 * @typedef {object} RpcEnvelope
 * @property {MessageType} type one of the MSG_* constants
 * @property {number} job_id correlation id — see `create_correlator`
 * @property {'transfer'} mode fixed compatibility marker
 * @property {unknown} payload message-specific body (for example coordinates or a ChunkRecord)
 * @property {string} [error] present only on MSG_ERROR
 */

let next_job_id = 1

/**
 * Allocates a fresh correlation id for a new outbound job. Monotonic within one JS realm —
 * callers that need cross-realm uniqueness should namespace payloads themselves.
 * @returns {number}
 */
export function allocate_job_id() {
  const id = next_job_id
  next_job_id += 1
  return id
}

/**
 * Builds an RPC envelope. Does not send it — callers choose `postMessage`/`transfer` list.
 * @param {MessageType} type
 * @param {number} job_id
 * @param {unknown} payload
 * @returns {RpcEnvelope}
 */
export function encode_message(type, job_id, payload) {
  return { type, job_id, mode: 'transfer', payload }
}

/**
 * Builds an MSG_ERROR envelope correlated to a failed job.
 * @param {number} job_id
 * @param {string} error
 * @returns {RpcEnvelope}
 */
export function encode_error(job_id, error) {
  return { type: MSG_ERROR, job_id, mode: 'transfer', payload: null, error }
}

/**
 * Validates and returns the envelope as-is (no cloning) — the trust boundary is the worker
 * postMessage structured-clone/transfer itself, this is just a type-narrowing helper.
 * @param {unknown} raw typically a MessageEvent's `.data`
 * @returns {RpcEnvelope}
 */
export function decode_message(raw) {
  const envelope = /** @type {RpcEnvelope} */ (raw)
  if (!envelope || typeof envelope.type !== 'string' || typeof envelope.job_id !== 'number') {
    throw new TypeError('rpc.js: malformed envelope — missing type or job_id')
  }
  return envelope
}

/**
 * @typedef {object} Correlator
 * @property {(job_id: number, resolve: (payload: unknown) => void, reject: (error: Error) => void) => void} track
 *   registers pending callbacks for a job id
 * @property {(envelope: RpcEnvelope) => boolean} resolve
 *   settles the tracked promise for envelope.job_id; returns false if job_id was unknown
 */

/**
 * Creates a request/response correlation helper for the calling side of an RPC channel
 * (typically the main thread talking to a pool). One instance per worker channel.
 * @returns {Correlator}
 */
export function create_correlator() {
  /** @type {Map<number, {resolve: (payload: unknown) => void, reject: (error: Error) => void}>} */
  const pending = new Map()

  return {
    track(job_id, resolve, reject) {
      pending.set(job_id, { resolve, reject })
    },
    resolve(envelope) {
      const entry = pending.get(envelope.job_id)
      if (!entry) return false
      pending.delete(envelope.job_id)
      if (envelope.type === MSG_ERROR) entry.reject(new Error(envelope.error ?? 'unknown worker error'))
      else entry.resolve(envelope.payload)
      return true
    },
  }
}
