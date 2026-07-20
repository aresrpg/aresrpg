// Fixed-timestep sim accumulator + rAF render (§3.1). Per-frame frame-time accounting keeps a
// rolling window of render-frame deltas and exposes p50/p75/p99 in ms. Percentiles are computed
// lazily when a diagnostics reader asks for them; the governor consumes raw frame time directly.

/** One fixed sim step, in seconds. 60 Hz keeps sim/physics deterministic independent of render fps. */
const SIM_STEP_SECONDS = 1 / 60
/** Guards against a huge accumulator after a tab was backgrounded (spiral-of-death protection). */
const MAX_ACCUMULATED_SECONDS = 0.25
/** Rolling window size for percentile frame-time stats. */
const FRAME_HISTORY_SIZE = 120
/** Hoisted ascending comparator so the per-frame sort never allocates a fresh closure. */
const ascending = (/** @type {number} */ a, /** @type {number} */ b) => a - b

/**
 * @typedef {object} FrameLoopOptions
 * @property {(dt_seconds: number) => void} on_sim_step called at a fixed 60 Hz cadence, may run
 *   0-N times per rendered frame depending on real elapsed time
 * @property {(alpha: number, frame_dt_seconds: number) => void} on_render called once per rAF
 *   tick; `alpha` in [0,1] is the interpolation factor between the last two sim steps
 * @property {{hidden?:boolean,visibilityState?:string,addEventListener:(event:string,callback:()=>void)=>void,
 *   removeEventListener:(event:string,callback:()=>void)=>void} | null} [visibility_document]
 * @property {()=>number} [now]
 * @property {(callback:FrameRequestCallback)=>number} [request_frame]
 * @property {(handle:number)=>void} [cancel_frame]
 */

/**
 * @typedef {object} FrameTimeStats
 * @property {number} fps rolling frames-per-second (1000 / mean frame ms over the window)
 * @property {number} p50
 * @property {number} p75
 * @property {number} p99
 */

/**
 * @typedef {object} FrameLoop
 * @property {() => void} start begins the rAF loop; no-op if already running
 * @property {() => void} stop cancels the rAF loop; no-op if already stopped
 * @property {() => boolean} is_running
 * @property {() => FrameTimeStats} get_frame_stats
 */

/**
 * Creates a fixed-timestep sim + rAF render loop with rolling frame-time percentile tracking.
 * @param {FrameLoopOptions} options
 * @returns {FrameLoop}
 */
export function create_frame_loop({
  on_sim_step,
  on_render,
  visibility_document = typeof document === 'undefined' ? null : document,
  now = () => performance.now(),
  request_frame = (callback) => requestAnimationFrame(callback),
  cancel_frame = (handle) => cancelAnimationFrame(handle),
}) {
  let running = false
  let raf_handle = 0
  let last_time_ms = 0
  let accumulator_seconds = 0

  /** @type {number[]} ring buffer of recent frame durations in ms */
  const frame_history = []
  let history_write_index = 0
  /** Running sum of `frame_history` → O(1) mean (no per-call reduce/allocation). */
  let history_sum = 0
  /** Reused scratch for the on-demand percentile sort — its backing store is retained across
   *  frames (length is reset, never reallocated), so the hot loop sorts in place with zero allocation
   *  (replaces the old `[...frame_history].sort()` that allocated a fresh 120-entry array PER CALL,
   *  ≥6× per frame via the governor + HUD + engine.get_stats readers). @type {number[]} */
  const sorted_scratch = []
  /** Percentile snapshot recomputed at most once after new data, only when requested. */
  const cached_stats = { fps: 0, p50: 0, p75: 0, p99: 0 }
  let stats_dirty = false

  const document_hidden = () =>
    visibility_document?.hidden === true || visibility_document?.visibilityState === 'hidden'

  function schedule_frame() {
    if (!running || document_hidden() || raf_handle !== 0) return
    raf_handle = request_frame(tick)
  }

  /** @param {number} now_ms */
  function tick(now_ms) {
    raf_handle = 0
    if (!running || document_hidden()) return

    const frame_dt_seconds = Math.min((now_ms - last_time_ms) / 1000, MAX_ACCUMULATED_SECONDS)
    last_time_ms = now_ms
    record_frame_ms(frame_dt_seconds * 1000)

    accumulator_seconds += frame_dt_seconds
    while (accumulator_seconds >= SIM_STEP_SECONDS) {
      on_sim_step(SIM_STEP_SECONDS)
      accumulator_seconds -= SIM_STEP_SECONDS
    }

    const alpha = accumulator_seconds / SIM_STEP_SECONDS
    on_render(alpha, frame_dt_seconds)

    schedule_frame()
  }

  function on_visibility_change() {
    if (!running) return
    if (document_hidden()) {
      if (raf_handle !== 0) cancel_frame(raf_handle)
      raf_handle = 0
      return
    }
    // Resume from a fresh clock: background time must not become sim catch-up work.
    last_time_ms = now()
    accumulator_seconds = 0
    schedule_frame()
  }

  /** @param {number} duration_ms */
  function record_frame_ms(duration_ms) {
    stats_dirty = true
    if (frame_history.length < FRAME_HISTORY_SIZE) {
      frame_history.push(duration_ms)
      history_sum += duration_ms
    } else {
      // Ring overwrite: keep the running sum exact by swapping the evicted value for the new one.
      history_sum += duration_ms - frame_history[history_write_index]
      frame_history[history_write_index] = duration_ms
      history_write_index = (history_write_index + 1) % FRAME_HISTORY_SIZE
    }
  }

  /**
   * Recomputes the cached p50/p75/p99 + fps snapshot on demand, in place, allocation-free:
   * the window is copied into the retained `sorted_scratch` (its capacity is reused, not realloc'd),
   * sorted once, and read at the three nearest-rank indices; the mean comes from the running sum.
   */
  function recompute_stats() {
    const n = frame_history.length
    if (n === 0) {
      cached_stats.fps = 0
      cached_stats.p50 = 0
      cached_stats.p75 = 0
      cached_stats.p99 = 0
      return
    }
    sorted_scratch.length = n // reuse backing store (V8 retains capacity on shrink/grow); no new array
    for (let i = 0; i < n; i += 1) sorted_scratch[i] = frame_history[i]
    sorted_scratch.sort(ascending)
    const mean = history_sum / n
    cached_stats.fps = mean > 0 ? 1000 / mean : 0
    // Nearest-rank, identical to the previous percentile(): index = min(n-1, floor(fraction·n)).
    cached_stats.p50 = sorted_scratch[Math.min(n - 1, Math.floor(0.5 * n))]
    cached_stats.p75 = sorted_scratch[Math.min(n - 1, Math.floor(0.75 * n))]
    cached_stats.p99 = sorted_scratch[Math.min(n - 1, Math.floor(0.99 * n))]
  }

  return {
    start() {
      if (running) return
      running = true
      last_time_ms = now()
      accumulator_seconds = 0
      visibility_document?.addEventListener('visibilitychange', on_visibility_change)
      schedule_frame()
    },
    stop() {
      if (!running) return
      running = false
      visibility_document?.removeEventListener('visibilitychange', on_visibility_change)
      if (raf_handle !== 0) cancel_frame(raf_handle)
      raf_handle = 0
    },
    is_running() {
      return running
    },
    get_frame_stats() {
      if (stats_dirty) {
        recompute_stats()
        stats_dirty = false
      }
      return cached_stats
    },
  }
}
