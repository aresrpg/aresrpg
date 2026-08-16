// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Generic module-worker pool over the rpc.js protocol (§3.2). Owns spawning, job-queue
// backpressure, and result correlation. Gen/mesh worker *entry* scripts (gen_worker.js,
// mesh_worker.js) are owned by WS2/WS3 — this file only knows how to talk rpc.js to whatever
// module URL it's given.

import { allocate_job_id, create_correlator, decode_message, encode_message } from './rpc.js'

/** @typedef {import('./rpc.js').MessageType} MessageType */

/**
 * @typedef {object} PoolOptions
 * @property {() => Worker} create_worker factory that constructs ONE module worker instance. MUST be written
 *   at the call site as the literal `() => new Worker(new URL('./x.js', import.meta.url), { type: 'module' })`
 *   — Vite's worker plugin only detects `new URL(...)` when it's a static argument written directly inside
 *   `new Worker(...)` in the SAME file. The old design built the URL in engine.js and passed it through this
 *   option as a plain value; `new Worker(worker_url, ...)` here never matched Vite's pattern, so `vite build`
 *   silently shipped broken/unbundled worker chunks (worked in dev, 404/import-error in prod — fixed 07-10).
 * @property {number} [worker_count] defaults to hardwareConcurrency heuristic (§3.2) via `default_worker_count`
 * @property {number} [max_queue_depth] backpressure ceiling on pending (queued+in-flight) jobs; default Infinity
 * @property {{ type: MessageType, payload: unknown }} [init_message] a one-shot message posted to EVERY
 *   worker immediately at spawn (before any job) — the config-first handshake seam (e.g. gen workers get
 *   their WorldGenConfig via MSG_GEN_CONFIG). Fire-and-forget: correlation id 0, no reply expected. The
 *   worker's message queue is FIFO, so this is always delivered before the first drained job.
 * @property {(payload: unknown) => void} [on_message] debug hook at worker-message delivery (before
 *   correlation/drain), used by the hitch probe to count arrivals + transferred bytes.
 */

/**
 * @typedef {object} WorkerPool
 * @property {(type: MessageType, payload: unknown, transferables?: Transferable[]) => Promise<unknown>} submit
 *   enqueues a job; resolves/rejects when the pool worker replies. Rejects immediately if the
 *   queue is at `max_queue_depth` (backpressure — caller should retry later, never buffered here).
 * @property {() => number} queue_depth pending (queued + in-flight) job count
 * @property {() => void} dispose terminates all workers, rejects in-flight jobs
 */

/**
 * Gen workers are memory-bound procedural-tree realms, so the measured release cap is two.
 * @returns {number}
 */
export function default_worker_count() {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4
  return Math.min(2, Math.max(2, cores - 4))
}

/**
 * Mesh workers are light realms; use cores−4 with a six-worker ceiling.
 * @returns {number}
 */
export function mesh_worker_count() {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4
  return Math.min(6, Math.max(2, cores - 4))
}

/**
 * One pending queue entry: a job waiting for a free worker.
 * @typedef {object} QueuedJob
 * @property {number} job_id
 * @property {MessageType} type
 * @property {unknown} payload
 * @property {Transferable[]} transferables
 */

/**
 * Spawns a pool of N module workers speaking the rpc.js envelope protocol, with a FIFO job
 * queue and round-robin dispatch to whichever worker is free.
 * @param {PoolOptions} options
 * @returns {WorkerPool}
 */
export function create_worker_pool({
  create_worker,
  worker_count = default_worker_count(),
  max_queue_depth = Infinity,
  init_message,
  on_message,
}) {
  const correlator = create_correlator()

  /** @type {{worker: Worker}[]} */
  const workers = []
  for (let i = 0; i < worker_count; i += 1) {
    const worker = create_worker()
    worker.addEventListener('message', on_worker_message)
    worker.addEventListener('error', on_worker_error)
    // Config-first handshake: post the one-shot init BEFORE any job. The worker's message queue is
    // FIFO, so this is processed ahead of the first drained MSG_GEN_REQUEST even though the module
    // worker boots asynchronously. Correlation id 0 (fire-and-forget: the worker sends no reply).
    if (init_message) worker.postMessage(encode_message(init_message.type, 0, init_message.payload))
    workers.push({ worker })
  }

  /** @type {QueuedJob[]} */
  const queue = []
  /** @type {Map<number, {worker: Worker}>} job_id -> which worker is running it */
  const in_flight = new Map()
  /** @type {Map<Worker, number>} worker -> job_id currently occupying it, for the message handler */
  const worker_job = new Map()
  let disposed = false

  /** @param {MessageEvent} event */
  function on_worker_message(event) {
    on_message?.(event.data)
    const envelope = decode_message(event.data)
    const entry = in_flight.get(envelope.job_id)
    in_flight.delete(envelope.job_id)
    if (entry) worker_job.delete(entry.worker)
    correlator.resolve(envelope)
    drain_queue()
  }

  /** @param {ErrorEvent} event */
  function on_worker_error(event) {
    // A thrown top-level error in a worker doesn't carry a job_id — surface it so pool.dispose()
    // callers see it in devtools instead of a silently-stuck job; individual jobs still time out
    // via the caller's own logic since we can't correlate this to one job_id.
    console.error('pool.js: worker error', event.message ?? event)
  }

  function drain_queue() {
    if (disposed) return
    while (queue.length > 0) {
      const free = workers.find((entry) => !worker_job.has(entry.worker))
      if (!free) return
      const job = /** @type {QueuedJob} */ (queue.shift())
      in_flight.set(job.job_id, { worker: free.worker })
      worker_job.set(free.worker, job.job_id)
      free.worker.postMessage(encode_message(job.type, job.job_id, job.payload), job.transferables)
    }
  }

  return {
    submit(type, payload, transferables) {
      if (disposed) return Promise.reject(new Error('pool.js: submit() after dispose()'))
      if (queue.length + in_flight.size >= max_queue_depth) {
        return Promise.reject(new Error('pool.js: backpressure — max_queue_depth exceeded'))
      }
      const job_id = allocate_job_id()
      return new Promise((resolve, reject) => {
        correlator.track(job_id, resolve, reject)
        queue.push({ job_id, type, payload, transferables: transferables ?? [] })
        drain_queue()
      })
    },
    queue_depth() {
      return queue.length + in_flight.size
    },
    dispose() {
      disposed = true
      for (const { worker } of workers) worker.terminate()
      queue.length = 0
      in_flight.clear()
    },
  }
}
