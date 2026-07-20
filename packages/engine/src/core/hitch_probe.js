// Camera-turn hitch attribution. Opt-in with `?hitch=1`: production pays only no-op hook calls.
// Counters belong to the interval BETWEEN render callbacks. `frame()` is called at the start of the
// next callback, snapshots the work that accumulated since the previous one, then resets exactly once.

const HITCH_MS = 25
const HISTORY_LIMIT = 120
/** [C1] max pipeline-descriptor labels NAMED per frame in a hitch report — attribution stays bounded. */
const PIPELINE_LABEL_CAP = 16
const CPU_WINDOW_MS = 5_000
const CPU_SAMPLE_MS = 1_000
const CPU_SAMPLE_EVENT = 'ares:cpu-sample'
const CPU_SPAN_EVENT = 'ares:cpu-span'
const BYTES_PER_MB = 1024 * 1024

/** @returns {string} */
function current_search() {
  return typeof location === 'undefined' ? '' : location.search
}

/** Exact opt-in flag (`?name=1`). @param {string} name @param {string} [search] */
export function url_flag_on(name, search = current_search()) {
  return new URLSearchParams(search).get(name) === '1'
}

/** Default-on system switch (`?name=0` disables it). @param {string} name @param {string} [search] */
export function url_switch_on(name, search = current_search()) {
  return new URLSearchParams(search).get(name) !== '0'
}

/** @returns {Record<string, number>} */
function empty_counters() {
  return {
    pipelines: 0,
    meshes: 0,
    mesh_integration_ms: 0,
    upload_chunks: 0,
    upload_bytes: 0,
    messages: 0,
    message_bytes: 0,
    lod_promotions: 0,
    lod_frees: 0,
    aerial_dispatches: 0,
    gpu_culls: 0,
  }
}

/** Debug-only, bounded byte estimate: exact for transferred buffers/views, approximate for scalars.
 * @param {unknown} value */
export function estimate_message_bytes(value) {
  const stack = [value]
  const seen = new WeakSet()
  const buffers = new Set()
  let bytes = 0
  let visited = 0
  while (stack.length > 0 && visited < 2048) {
    const item = stack.pop()
    visited += 1
    if (item == null) continue
    if (typeof item === 'string') {
      bytes += item.length * 2
      continue
    }
    if (typeof item === 'number') {
      bytes += 8
      continue
    }
    if (typeof item === 'boolean') {
      bytes += 4
      continue
    }
    if (typeof item !== 'object') continue
    if (ArrayBuffer.isView(item)) {
      const { buffer } = item
      if (!buffers.has(buffer)) {
        buffers.add(buffer)
        bytes += buffer.byteLength
      }
      continue
    }
    if (item instanceof ArrayBuffer) {
      if (!buffers.has(item)) {
        buffers.add(item)
        bytes += item.byteLength
      }
      continue
    }
    if (seen.has(item)) continue
    seen.add(item)
    if (Array.isArray(item)) {
      // Count the carrier slots, then visit object members so nested transferred views (notably a
      // chunk's occupancy tuple) contribute their backing buffers. Scalar arrays stay O(1); the shared
      // traversal cap bounds pathological object arrays on this opt-in debug path.
      bytes += item.length * 8
      for (let i = item.length - 1; i >= 0; i -= 1) {
        if (item[i] != null && typeof item[i] === 'object') stack.push(item[i])
      }
      continue
    }
    const record = /** @type {Record<string, unknown>} */ (item)
    for (const key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue
      bytes += key.length * 2
      stack.push(record[key])
    }
  }
  return bytes
}

/** @param {number} bytes */
function format_bytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

/** @param {PerformanceEntry} entry @param {{start:number,end:number}} frame */
function overlaps(entry, frame) {
  const task_end = entry.startTime + entry.duration
  return entry.startTime < frame.end && task_end > frame.start
}

/** @param {(entry: PerformanceEntry) => void} on_entry @returns {() => void} */
function observe_longtasks(on_entry) {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask'))
    return () => {}
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) on_entry(entry)
    })
    observer.observe({ type: 'longtask', buffered: true })
    return () => observer.disconnect()
  } catch {
    return () => {} // instrumentation must never break boot on a partial observer implementation
  }
}

/** @returns {EventTarget | null} */
function browser_event_target() {
  return typeof window === 'undefined' ? null : window
}

/** Direct bridge for opt-in animation callbacks outside the engine package.
 * @param {(system:string,start:number,end:number)=>void} on_span */
function install_cpu_span_sink(on_span) {
  if (typeof window === 'undefined') return () => {}
  const target = /** @type {Window & {__ares_cpu_span?: (system:string,start:number,end:number)=>void}} */ (window)
  const previous = target.__ares_cpu_span
  /** @type {(system:string,start:number,end:number)=>void} */
  const sink = (system, start, end) => on_span(system, start, end)
  target.__ares_cpu_span = sink
  return () => {
    if (target.__ares_cpu_span !== sink) return
    if (previous) target.__ares_cpu_span = previous
    else delete target.__ares_cpu_span
  }
}

/** @returns {number | null} Chromium-only heap signal; null elsewhere. */
function read_heap_bytes() {
  const { memory } = /** @type {{memory?:{usedJSHeapSize?:number}}} */ (globalThis.performance)
  return Number.isFinite(memory?.usedJSHeapSize) ? Number(memory?.usedJSHeapSize) : null
}

/** @param {EventTarget | null} target @param {unknown} detail */
function dispatch_cpu_sample(target, detail) {
  if (!target || typeof CustomEvent === 'undefined') return
  target.dispatchEvent(new CustomEvent(CPU_SAMPLE_EVENT, { detail }))
}

/** Sum the union of intervals without double-counting nested engine/render/long-task spans.
 * Debug-only: called once per second, never in a normal frame. @param {{start:number,end:number}[]} source */
function interval_union_ms(source) {
  if (source.length === 0) return 0
  const intervals = source.slice().sort((a, b) => a.start - b.start)
  let total = 0
  let [{ start, end }] = intervals
  for (let i = 1; i < intervals.length; i += 1) {
    const item = intervals[i]
    if (item.start <= end) end = Math.max(end, item.end)
    else {
      total += end - start
      ;({ start, end } = item)
    }
  }
  return total + end - start
}

/**
 * Rolling CPU telemetry used by the opt-in HUD. Returning null is the important flag-off contract:
 * no PerformanceObserver, DOM listener, timer, memory sampling, or per-frame allocation exists unless
 * the URL contains `?cpu=1`.
 *
 * `main_util_pct` is a measured lower bound: union(engine + render + scene + React + p2p spans + long tasks)
 * over the last five seconds. DevTools' Performance trace remains the exact whole-main-thread oracle.
 *
 * @typedef {object} CpuProbe
 * @property {(frame:{start_ms:number,render_start_ms:number,render_end_ms:number,end_ms:number,frame_ms:number})=>void} frame
 * @property {(payload:unknown)=>void} worker_message
 * @property {()=>void} dispose
 */

/**
 * @param {object} [options]
 * @param {string} [options.search]
 * @param {()=>number} [options.now]
 * @param {(on_entry:(entry:PerformanceEntry)=>void)=>()=>void} [options.observe]
 * @param {EventTarget | null} [options.event_target]
 * @param {()=>number | null} [options.read_memory]
 * @param {(sample:Record<string,unknown>)=>void} [options.emit]
 * @returns {CpuProbe | null}
 */
export function create_cpu_probe({
  search = current_search(),
  now = () => performance.now(),
  observe = observe_longtasks,
  event_target = browser_event_target(),
  read_memory = read_heap_bytes,
  emit = (sample) => dispatch_cpu_sample(event_target, sample),
} = {}) {
  if (!url_flag_on('cpu', search)) return null

  /** @type {{system:string,start:number,end:number}[]} */
  const spans = []
  /** @type {{start:number,end:number}[]} */
  const longtasks = []
  /** @type {{at:number,frame_ms:number}[]} */
  const frames = []
  /** @type {{at:number,delta:number}[]} */
  const heap_deltas = []
  /** @type {{at:number,bytes:number}[]} */
  const worker_messages = []
  let disposed = false
  const started_ms = now()
  let last_emit_ms = started_ms
  let last_heap = read_memory()
  let memory_available = last_heap != null

  /** @param {string} system @param {number} start @param {number} end */
  function record_span(system, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
    spans.push({ system, start, end })
  }

  /** @param {PerformanceEntry} entry */
  function on_longtask(entry) {
    if (disposed || !Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration)) return
    longtasks.push({ start: entry.startTime, end: entry.startTime + entry.duration })
  }

  /** @param {Event} event */
  function on_external_span(event) {
    const { detail } = /** @type {{detail?:{system?:unknown,start_ms?:unknown,end_ms?:unknown}}} */ (event)
    if (typeof detail?.system !== 'string') return
    record_span(detail.system, Number(detail.start_ms), Number(detail.end_ms))
  }

  const stop_span_sink = install_cpu_span_sink(record_span)
  const stop_observing = observe(on_longtask)
  event_target?.addEventListener(CPU_SPAN_EVENT, on_external_span)

  /** @param {number} end_ms */
  function sample(end_ms) {
    const cutoff = Math.max(started_ms, end_ms - CPU_WINDOW_MS)
    while (spans[0]?.end < cutoff) spans.shift()
    while (longtasks[0]?.end < cutoff) longtasks.shift()
    while (frames[0]?.at < cutoff) frames.shift()
    while (heap_deltas[0]?.at < cutoff) heap_deltas.shift()
    while (worker_messages[0]?.at < cutoff) worker_messages.shift()

    const elapsed_ms = Math.max(1, end_ms - cutoff)
    const frame_count = frames.length
    const bucket_ms = { engine: 0, render: 0, scene: 0, react: 0, p2p: 0 }
    for (const span of spans) {
      const duration = Math.max(0, Math.min(span.end, end_ms) - Math.max(span.start, cutoff))
      if (span.system in bucket_ms) bucket_ms[/** @type {keyof typeof bucket_ms} */ (span.system)] += duration
    }
    const occupied = [
      ...spans.map((span) => ({ start: Math.max(cutoff, span.start), end: Math.min(end_ms, span.end) })),
      ...longtasks.map((task) => ({ start: Math.max(cutoff, task.start), end: Math.min(end_ms, task.end) })),
    ].filter((item) => item.end > item.start)
    const clipped_longtasks = longtasks
      .map((task) => ({ start: Math.max(cutoff, task.start), end: Math.min(end_ms, task.end) }))
      .filter((task) => task.end > task.start)
    let heap_growth = 0
    let gc_drop = 0
    for (const item of heap_deltas) {
      if (item.delta >= 0) heap_growth += item.delta
      else gc_drop -= item.delta
    }
    let worker_bytes = 0
    for (const item of worker_messages) worker_bytes += item.bytes

    emit({
      window_ms: Math.round(elapsed_ms),
      main_util_pct: (interval_union_ms(occupied) / elapsed_ms) * 100,
      engine_ms: bucket_ms.engine / Math.max(1, frame_count),
      render_ms: bucket_ms.render / Math.max(1, frame_count),
      scene_ms: bucket_ms.scene / Math.max(1, frame_count),
      react_ms: bucket_ms.react / Math.max(1, frame_count),
      p2p_ms: bucket_ms.p2p / Math.max(1, frame_count),
      fps: (frame_count * 1000) / elapsed_ms,
      frame_ms: frames.reduce((sum, frame) => sum + frame.frame_ms, 0) / Math.max(1, frame_count),
      longtask_count: longtasks.length,
      longtask_ms: interval_union_ms(clipped_longtasks),
      heap_growth_mb: memory_available ? heap_growth / BYTES_PER_MB : null,
      gc_drop_mb: memory_available ? gc_drop / BYTES_PER_MB : null,
      worker_messages_s: (worker_messages.length * 1000) / elapsed_ms,
      worker_mb_s: (worker_bytes / BYTES_PER_MB) * (1000 / elapsed_ms),
    })
  }

  return {
    frame({ start_ms, render_start_ms, render_end_ms, end_ms, frame_ms }) {
      if (disposed) return
      record_span('engine', start_ms, render_start_ms)
      record_span('render', render_start_ms, render_end_ms)
      record_span('engine', render_end_ms, end_ms)
      frames.push({ at: end_ms, frame_ms })
      const heap = read_memory()
      if (heap != null) memory_available = true
      if (heap != null && last_heap != null && heap !== last_heap)
        heap_deltas.push({ at: end_ms, delta: heap - last_heap })
      last_heap = heap
      if (end_ms - last_emit_ms >= CPU_SAMPLE_MS) {
        sample(end_ms)
        last_emit_ms = end_ms
      }
    },
    worker_message(payload) {
      if (disposed) return
      worker_messages.push({ at: now(), bytes: estimate_message_bytes(payload) })
    },
    dispose() {
      if (disposed) return
      disposed = true
      stop_observing()
      stop_span_sink()
      event_target?.removeEventListener(CPU_SPAN_EVENT, on_external_span)
      spans.length = 0
      longtasks.length = 0
      frames.length = 0
      heap_deltas.length = 0
      worker_messages.length = 0
    },
  }
}

/**
 * @typedef {object} HitchProbe
 * @property {(frame_ms:number, end_ms?:number)=>void} frame snapshot + reset the completed frame interval
 * @property {()=>void} pipeline_created
 * @property {()=>{sync:number,async:number}} pipeline_creation_counts cumulative pipeline creation mode counts
 * @property {()=>void} chunk_meshed
 * @property {(elapsed_ms:number)=>void} mesh_integration
 * @property {(bytes:number)=>void} chunk_uploaded
 * @property {(payload:unknown)=>void} worker_message
 * @property {()=>void} lod_promoted
 * @property {()=>void} lod_disposed
 * @property {()=>void} aerial_dispatched
 * @property {()=>void} gpu_culled
 * @property {(renderer:unknown)=>void} watch_renderer wraps three's backend pipeline creation hooks
 * @property {()=>void} dispose
 */

/**
 * @param {object} [options]
 * @param {string} [options.search]
 * @param {(line:string)=>void} [options.log]
 * @param {()=>number} [options.now]
 * @param {(on_entry:(entry:PerformanceEntry)=>void)=>()=>void} [options.observe]
 * @returns {HitchProbe}
 */
export function create_hitch_probe({
  search = current_search(),
  log = (line) => console.info(line),
  now = () => performance.now(),
  observe = observe_longtasks,
} = {}) {
  const enabled = url_flag_on('hitch', search)
  let counters = empty_counters()
  // [C1] pipeline-compile ATTRIBUTION: descriptor labels captured by the createRenderPipeline wraps in
  // the same completed-interval window as the counters — a hitch report NAMES the material variants that
  // compiled inside the stall frame (three labels pipelines `renderPipeline_<material>_<id>`,
  // WebGPUPipelineUtils.js:208). Bounded per frame; overflow reported as a count.
  /** @type {string[]} */
  let pipeline_labels = []
  let pipeline_label_overflow = 0
  /** @type {{start:number,end:number,duration:number,counters:Record<string,number>,labels:string[],label_overflow:number,reported:boolean}[]} */
  const history = []
  /** @type {PerformanceEntry[]} */
  const pending_tasks = []
  /** @type {Array<() => void>} */
  const restore_hooks = []
  let sync_pipeline_creations = 0
  let async_pipeline_creations = 0
  let primed = false
  let disposed = false

  /** @param {{duration:number,counters:Record<string,number>,labels:string[],label_overflow:number,reported:boolean}} record
   *  @param {number} duration */
  function report(record, duration) {
    if (record.reported || disposed) return
    record.reported = true
    const c = record.counters
    // [C1] name the pipeline variants that compiled inside this interval (the compile-stall attribution).
    const overflow = record.label_overflow > 0 ? `, +${record.label_overflow} more` : ''
    const compiled = record.labels.length > 0 ? ` · compiled [${record.labels.join(', ')}${overflow}]` : ''
    log(
      `[hitch] ${Math.round(duration)}ms · pipelines+${c.pipelines} · meshes+${c.meshes} · ` +
        `integ ${Math.round(c.mesh_integration_ms)}ms · ` +
        `uploads ${format_bytes(c.upload_bytes)} (${c.upload_chunks} chunks) · ` +
        `msgs ${c.messages}/${format_bytes(c.message_bytes)} · lod+${c.lod_promotions} · ` +
        `lodfree+${c.lod_frees} · aerial+${c.aerial_dispatches} · culls+${c.gpu_culls}${compiled}`
    )
  }

  /** @param {PerformanceEntry} entry */
  function on_longtask(entry) {
    if (entry.duration <= HITCH_MS || disposed) return
    let record
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (!overlaps(entry, history[i])) continue
      record = history[i]
      break
    }
    if (record) {
      report(record, Math.max(record.duration, entry.duration))
      return
    }
    pending_tasks.push(entry)
  }

  const stop_observing = enabled ? observe(on_longtask) : () => {}

  /** @param {string} name @param {any} target @returns {(() => void) | null} */
  function wrap_pipeline_hook(name, target) {
    const original = target?.[name]
    if (typeof original !== 'function') return null
    const is_async = name.endsWith('Async')
    /** @param {...any} args */
    const wrapped = (...args) => {
      counters.pipelines += 1
      if (is_async) async_pipeline_creations += 1
      else sync_pipeline_creations += 1
      // [C1] device-level calls receive the GPU*PipelineDescriptor whose `label` names the material
      // variant; the backend-fallback hooks receive a renderObject (no label) and stay count-only.
      const label = args[0]?.label
      if (typeof label === 'string' && label !== '') {
        if (pipeline_labels.length < PIPELINE_LABEL_CAP) pipeline_labels.push(label)
        else pipeline_label_overflow += 1
      }
      return original.apply(target, args)
    }
    try {
      target[name] = wrapped
      if (target[name] !== wrapped) return null
    } catch {
      return null
    }
    return () => {
      try {
        if (target[name] === wrapped) target[name] = original
      } catch {
        // A debug wrapper becoming non-writable during device loss must not break teardown.
      }
    }
  }

  /** Installs an all-or-nothing wrapper set. @param {any} target @param {string[]} names */
  function wrap_pipeline_target(target, names) {
    if (!target) return false
    /** @type {Array<() => void>} */
    const restores = []
    for (const name of names) {
      if (typeof target[name] !== 'function') continue
      const restore = wrap_pipeline_hook(name, target)
      if (!restore) {
        for (const rollback of restores) rollback()
        return false
      }
      restores.push(restore)
    }
    if (restores.length === 0) return false
    restore_hooks.push(...restores)
    return true
  }

  return {
    frame(frame_ms, end_ms = now()) {
      if (!enabled || disposed) return
      if (!primed) {
        primed = true
        counters = empty_counters()
        pipeline_labels = []
        pipeline_label_overflow = 0
        return
      }
      const record = {
        start: end_ms - frame_ms,
        end: end_ms,
        duration: frame_ms,
        counters,
        labels: pipeline_labels,
        label_overflow: pipeline_label_overflow,
        reported: false,
      }
      history.push(record)
      if (history.length > HISTORY_LIMIT) history.shift()
      counters = empty_counters() // reset ONCE, only after the completed interval was retained
      pipeline_labels = []
      pipeline_label_overflow = 0

      for (let i = pending_tasks.length - 1; i >= 0; i -= 1) {
        const entry = pending_tasks[i]
        if (overlaps(entry, record)) {
          report(record, Math.max(frame_ms, entry.duration))
          pending_tasks.splice(i, 1)
        } else if (entry.startTime + entry.duration <= record.start) {
          pending_tasks.splice(i, 1) // buffered boot/background task can no longer match a future frame
        }
      }
      if (frame_ms > HITCH_MS) report(record, frame_ms)
    },
    pipeline_created() {
      if (!enabled) return
      counters.pipelines += 1
      sync_pipeline_creations += 1
    },
    pipeline_creation_counts() {
      return { sync: sync_pipeline_creations, async: async_pipeline_creations }
    },
    chunk_meshed() {
      if (enabled) counters.meshes += 1
    },
    mesh_integration(elapsed_ms) {
      if (enabled) counters.mesh_integration_ms += elapsed_ms
    },
    chunk_uploaded(bytes) {
      if (!enabled) return
      counters.upload_chunks += 1
      counters.upload_bytes += bytes
    },
    worker_message(payload) {
      if (!enabled) return
      counters.messages += 1
      counters.message_bytes += estimate_message_bytes(payload)
    },
    lod_promoted() {
      if (enabled) counters.lod_promotions += 1
    },
    lod_disposed() {
      if (enabled) counters.lod_frees += 1
    },
    aerial_dispatched() {
      if (enabled) counters.aerial_dispatches += 1
    },
    gpu_culled() {
      if (enabled) counters.gpu_culls += 1
    },
    watch_renderer(renderer) {
      if (!enabled || disposed) return
      const backend = /** @type {any} */ (renderer)?.backend
      // Prefer the WebGPUDevice boundary: it catches scene/compute cache misses AND three's direct
      // texture-transfer/mipmap pipelines. Fall back to backend hooks for mocks/alternate backends.
      if (
        wrap_pipeline_target(backend?.device, [
          'createRenderPipeline',
          'createRenderPipelineAsync',
          'createComputePipeline',
          'createComputePipelineAsync',
        ])
      )
        return
      wrap_pipeline_target(backend, ['createRenderPipeline', 'createComputePipeline'])
    },
    dispose() {
      if (disposed) return
      disposed = true
      stop_observing()
      for (const restore of restore_hooks) restore()
      restore_hooks.length = 0
      history.length = 0
      pending_tasks.length = 0
    },
  }
}
