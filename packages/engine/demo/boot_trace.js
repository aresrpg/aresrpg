// FIRST-LOAD boot trace probe (Agent Standard #1 — instrument before you fix). Behind `?boot_trace=1`
// (default off, shippable): captures the first ~15 s of engine boot as compact JSON console lines +
// a single SUMMARY blob, and stashes the raw arrays on `window.__boot_trace` so a headed capture rig
// can read them without parsing console. NAMES the first-load freeze branch — compile storm vs upload
// bunching vs GC vs far-shell start — by correlating longtasks with per-frame stream/upload signals.
//
// It reads ONLY the public engine surface (get_stats().stream_debug / resident_chunks / quad_count /
// chunk_queue_depth + the load_progress events), so it never perturbs the boot it measures. Upload
// bytes are proxied by the per-frame quad_count delta × 8 B/quad (BYTES_PER_QUAD) — during boot chunks
// only stream IN (no eviction), so the delta IS the uploaded geometry that frame.

const BYTES_PER_QUAD = 8 // mesh/quad_buffer.js frozen format (uvec2) — the upload-byte proxy multiplier
const TRACE_MS = 15_000 // capture window

/**
 * @param {number[]} xs
 * @param {number} p 0..1
 * @returns {number} the p-quantile of xs (sorted copy), or 0 when empty
 */
function quantile(xs, p) {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))
  return s[i]
}

/**
 * Installs the boot trace on a live engine. Fire-and-forget; self-limiting to TRACE_MS.
 * @param {import('../src/engine.js').EngineApi} engine
 * @param {() => boolean} [input_live] optional: returns true once the app has accepted a movement input
 *   (frontend physics gate). The demo has no such gate, so it's omitted there — the field stays null.
 * @returns {{ stop: () => void }}
 */
export function install_boot_trace(engine, input_live) {
  const t0 = performance.now()
  /** @type {{ t: number, dur: number }[]} */
  const longtasks = []
  /** @type {any[]} */
  const frames = []
  /** @type {Record<string, number>} */
  const marks = {}
  let prev_quads = 0
  let prev_t = t0
  let input_live_ms = -1
  let raf = 0
  let done = false

  // ── longtask observer (the freeze signal — a >50 ms main-thread block) ──────────────────────────
  /** @type {PerformanceObserver | null} */
  let obs = null
  try {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        longtasks.push({ t: +(e.startTime - t0).toFixed(1), dur: +e.duration.toFixed(1) })
    })
    obs.observe({ entryTypes: ['longtask'] })
  } catch {
    /* longtask unsupported (Safari) — the per-frame dt spikes still localise the freeze */
  }

  // ── boot phase marks (focus_ready = D221 prewarm start; done = full ring) ────────────────────────
  const off = engine.on('load_progress', (/** @type {any} */ p) => {
    if (p?.phase && marks[p.phase] === undefined) {
      marks[p.phase] = +(performance.now() - t0).toFixed(0)
      console.info(`[BT] mark ${p.phase} +${marks[p.phase]}ms`)
    }
  })

  const tick = () => {
    if (done) return
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    const t = now - t0
    const dt = now - prev_t
    prev_t = now
    if (input_live_ms < 0 && input_live?.()) input_live_ms = +t.toFixed(0)

    const stats = /** @type {any} */ (engine.get_stats?.() ?? {})
    const sd = stats.stream_debug ?? {}
    const quads = stats.quad_count ?? 0
    const dquads = Math.max(0, quads - prev_quads)
    prev_quads = quads

    frames.push({
      t: +t.toFixed(0),
      dt: +dt.toFixed(1),
      qd: stats.chunk_queue_depth ?? 0, // gen+mesh backlog
      md: sd.meshed_last ?? 0, // chunks meshed this frame
      pd: sd.pending_depth ?? 0, // total streaming work outstanding
      thr: sd.throttled ? 1 : 0, // frame governor tripped (boot compile window)
      up_b: dquads * BYTES_PER_QUAD, // UPLOAD proxy (bytes) — quad delta × 8
      res: stats.resident_chunks ?? 0,
      far: stats.far_section_count ?? 0, // far-shell sections (0 until focus_ready)
    })
    // compact per-frame line only for the notable frames (long dt or a far-shell start) to keep the
    // console legible; the full arrays live on window.__boot_trace for the rig.
    if (dt > 20 || (frames.length > 1 && frames[frames.length - 2].far === 0 && frames[frames.length - 1].far > 0))
      console.info(`[BT] ${JSON.stringify(frames[frames.length - 1])}`)

    if (t >= TRACE_MS) finish()
  }

  const finish = () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    obs?.disconnect()
    off?.()
    const dts = frames.map((f) => f.dt).filter((d) => d > 0 && d < 2000)
    const window_ms = 10_000
    const lt_10s = longtasks.filter((l) => l.t <= window_ms)
    const summary = {
      frames: frames.length,
      p50_ms: +quantile(dts, 0.5).toFixed(1),
      p95_ms: +quantile(dts, 0.95).toFixed(1),
      p99_ms: +quantile(dts, 0.99).toFixed(1),
      max_ms: +Math.max(0, ...dts).toFixed(1),
      longtasks: longtasks.length,
      longtask_ms: +longtasks.reduce((a, l) => a + l.dur, 0).toFixed(0),
      longtasks_10s: lt_10s.length,
      longtask_ms_10s: +lt_10s.reduce((a, l) => a + l.dur, 0).toFixed(0),
      biggest_longtasks: [...longtasks].sort((a, b) => b.dur - a.dur).slice(0, 8),
      focus_ready_ms: marks.focus_ready ?? -1,
      done_ms: marks.done ?? -1,
      input_live_ms,
      max_upload_b: Math.max(0, ...frames.map((f) => f.up_b)),
      far_start_ms: frames.find((f) => f.far > 0)?.t ?? -1,
    }
    /** @type {any} */ window.__boot_trace = { summary, frames, longtasks, marks }
    console.info(`[BT] SUMMARY ${JSON.stringify(summary)}`)
  }

  raf = requestAnimationFrame(tick)
  return { stop: finish }
}
