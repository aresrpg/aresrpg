// Per-frame GPU-upload byte budget with nearest-first priority (§3.2, §9.6). Meshed chunks
// (packed quad buffers, §3.5) arrive from the mesh worker pool faster than we want to hand them
// to the GPU in a single frame — this queue caps bytes + measured main-thread time per frame and
// drains nearest-to-camera first so distant chunks never starve close ones during a stream burst.
//
// This module is upload-target-agnostic: it decides *what* and *how much* to drain each frame;
// the actual `upload_chunk()` GPU call is supplied by the caller (engine.js, wired to WS3/WS4's
// `create_terrain_renderer().upload_chunk`) — upload_queue.js owns budgeting, not GPU calls.

/**
 * @typedef {object} UploadEntry
 * @property {string} key unique chunk key (e.g. `${cx},${cy},${cz}`) — de-dupes re-enqueues
 * @property {number} byte_size upload cost in bytes, counted against the per-frame budget
 * @property {number} priority lower = uploaded sooner; caller convention is squared distance to
 *   camera in chunk-space (nearest-first, §brief) but this module treats it as an opaque number
 * @property {() => void} upload invoked when this entry is drained — performs the actual GPU upload
 */

/**
 * @typedef {object} UploadQueue
 * @property {(entry: UploadEntry) => void} enqueue adds or replaces (by key) a pending upload
 * @property {(key: string) => void} cancel removes a pending upload if not yet drained
 * @property {(byte_budget_per_frame: number) => number} drain_frame pops entries in priority
 *   order until the byte or construction-time budget is exhausted; returns bytes uploaded this frame
 * @property {() => number} pending_count
 * @property {() => number} pending_bytes total byte_size across all pending entries
 */

/** Hoisted ascending-priority comparator so the sort never allocates a fresh closure per call. */
const by_priority = (/** @type {UploadEntry} */ a, /** @type {UploadEntry} */ b) => a.priority - b.priority

/**
 * Creates a priority-ring upload queue. Byte budget is supplied per `drain_frame()` call
 * (typically `get_tier(current_tier).texture_resolution_px`-scaled or a fixed per-tier byte
 * constant chosen by engine.js) rather than baked in at construction, so tier changes take
 * effect on the very next frame with no queue rebuild.
 *
 * ALLOCATION DIET (playbook #3): drain_frame no longer does `[...pending.values()].sort()` every
 * frame (a fresh array + sort per drain — GC pressure during stream bursts). Instead a persistent
 * `order` array is rebuilt + resorted ONLY when the pending set gained/replaced an entry (`dirty`);
 * cancels and drains lazy-delete from the Map, leaving stale entries in `order` that the drain skips
 * via an identity check. On a steady drain with no new enqueues the queue re-sorts nothing and
 * allocates nothing — the hot path is a walk over a pre-sorted array.
 * @param {{ time_budget_ms?: number, now?: () => number }} [options]
 * @returns {UploadQueue}
 */
export function create_upload_queue({ time_budget_ms = 3, now = default_now } = {}) {
  /** Source of truth: key → the CURRENT entry for that key (existence + latest priority). */
  /** @type {Map<string, UploadEntry>} */
  const pending = new Map()
  /** Persistent, reused work list kept in priority order. May hold STALE entries (cancelled,
   *  replaced, or already drained) — each is skipped on drain by checking it's still the Map's
   *  current entry for its key. Rebuilt from `pending` + resorted only when `dirty`. @type {UploadEntry[]} */
  const order = []
  /** Set when an entry is added/replaced, so `order` is rebuilt+resorted before the next drain. */
  let dirty = false

  return {
    enqueue(entry) {
      pending.set(entry.key, entry)
      dirty = true // new or replaced entry → order must be rebuilt + resorted before the next drain
    },
    cancel(key) {
      // Lazy delete: drop from the Map only; the stale `order` entry is skipped on drain (identity
      // check) and cleared at the next dirty rebuild. Avoids an O(n) splice on every cancel.
      pending.delete(key)
    },
    drain_frame(byte_budget_per_frame) {
      if (pending.size === 0) return 0

      if (dirty) {
        order.length = 0 // reuse the array's backing store (no new allocation)
        for (const entry of pending.values()) order.push(entry)
        order.sort(by_priority)
        dirty = false
      }

      const start = now()
      let bytes_spent = 0
      let uploads = 0
      // Walk the pre-sorted list front-to-back, skipping stale entries. Iterating `order` (a stable
      // array), not the Map, means the mid-loop pending.delete() below can't invalidate the walk.
      for (let i = 0; i < order.length; i += 1) {
        const entry = order[i]
        if (pending.get(entry.key) !== entry) continue // stale (cancelled / replaced / drained) — skip
        // A byte cap cannot bound partitioning + WebGPU buffer-write CPU time. Always admit one item,
        // then carry the rest once this frame's measured upload slice has been spent.
        if (uploads > 0 && now() - start >= time_budget_ms) break
        if (bytes_spent > 0 && bytes_spent + entry.byte_size > byte_budget_per_frame) break
        pending.delete(entry.key) // consumed → becomes stale in `order`, skipped thereafter
        entry.upload()
        uploads += 1
        bytes_spent += entry.byte_size
        if (bytes_spent >= byte_budget_per_frame) break
      }
      return bytes_spent
    },
    pending_count() {
      return pending.size
    },
    pending_bytes() {
      let total = 0
      for (const entry of pending.values()) total += entry.byte_size
      return total
    },
  }
}

function default_now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
