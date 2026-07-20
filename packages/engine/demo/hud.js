// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Debug HUD overlay (§7) — reads `engine.get_stats()` every frame and renders the acceptance
// surface for M0: fps, p50/p75/p99 frame ms, draw calls, quad count, plus any queue/worker/
// upload fields WS1 exposes later. Every field is read defensively (`?? '—'`) since WS1's
// EngineStats shape may grow — this HUD must never throw on a partial stats object.
//
// Also exposes `read_stats_line()` for the Playwright bench harness to pull the exact same
// numbers out of the DOM without duplicating the get_stats() call (bench/harness.js reads
// `window.__ares_last_stats__` set by this module each tick).

/** @typedef {import('../src/engine.js').EngineApi} EngineApi */
/** @typedef {import('../src/engine.js').EngineStats} EngineStats */

const FIELD_ROWS = /** @type {const} */ ([
  ['fps', 'fps', (v) => fmt_num(v, 0)],
  ['frame_ms_p50', 'p50 ms', (v) => fmt_num(v, 2)],
  ['frame_ms_p75', 'p75 ms', (v) => fmt_num(v, 2)],
  ['frame_ms_p99', 'p99 ms', (v) => fmt_num(v, 2)],
  ['draw_calls', 'draws', (v) => fmt_num(v, 0)],
  ['quad_count', 'quads', (v) => fmt_num(v, 0)],
  ['tier', 'tier', (v) => v ?? '—'],
  // render_scale is shown + driven by the interactive slider below (mount_hud), not a passive row.
  ['chunk_queue_depth', 'queue depth', (v) => fmt_num(v, 0)],
  ['far_section_count', 'far sections', (v) => fmt_num(v, 0)],
  ['far_section_bytes', 'far mem', (v) => fmt_bytes(v)],
  ['vram_estimate_bytes', 'vram est.', (v) => fmt_bytes(v)],
  // Owner UX: camera pose readout — "x y z | yaw pitch" from get_stats' camera_position +
  // camera_yaw_pitch. Formatters receive the whole stats bag as a 2nd arg for multi-field rows.
  ['camera_position', 'xyz', (v, stats) => fmt_pose(v, stats?.camera_yaw_pitch)],
])

/**
 * @param {unknown} value
 * @param {number} digits
 * @returns {string}
 */
function fmt_num(value, digits) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

/**
 * Formats the camera pose line: "x y z | yaw pitch" (position rounded ints, radians 2 dp).
 * @param {unknown} position
 * @param {unknown} yaw_pitch
 * @returns {string}
 */
function fmt_pose(position, yaw_pitch) {
  if (!Array.isArray(position) || position.length !== 3) return '—'
  const xyz = position.join(' ')
  const yp =
    Array.isArray(yaw_pitch) && yaw_pitch.length === 2
      ? ` | ${fmt_num(yaw_pitch[0], 2)} ${fmt_num(yaw_pitch[1], 2)}`
      : ''
  return `${xyz}${yp}`
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function fmt_bytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} KB`
  return `${value} B`
}

const HUD_STYLE = `
  position: fixed; top: 8px; left: 8px; z-index: 10;
  background: rgba(18,18,26,0.72); backdrop-filter: blur(12px);
  border: 1px solid #1e1e2e; color: #e8e4dc;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; line-height: 1.6; letter-spacing: 0.05em;
  padding: 10px 12px; min-width: 200px; pointer-events: none;
  text-transform: uppercase;
`

/**
 * Mounts the HUD overlay into `document.body` and starts a per-frame `get_stats()` poll driven
 * by requestAnimationFrame. Returns a `dispose()` to unhook.
 *
 * @param {EngineApi} engine
 * @param {{ view_distance_m?: number, get_walk_state?: () => (null | { anim: string, speed: number,
 *   on_ground: boolean, in_water: boolean, pos: [number,number,number] }), get_mode?: () => string }}
 *   [options] view_distance_m = effective streaming view radius in meters. get_mode / get_walk_state
 *   (ENG-8) feed the "MODE" line: fly ↔ walk plus the live character state (anim/speed/ground) so the
 *   controller is legible on screen and the acceptance captures can read it.
 * @returns {{ dispose: () => void }}
 */
export function mount_hud(engine, { view_distance_m, get_walk_state, get_mode } = {}) {
  const root = document.createElement('div')
  root.id = 'hud'
  root.style.cssText = HUD_STYLE
  document.body.appendChild(root)

  // ENG-8 MODE line (fly/walk + live controller state). Rendered at the top; updated each tick below.
  let mode_val = /** @type {HTMLSpanElement | null} */ (null)
  if (get_mode) {
    const mode_row = document.createElement('div')
    const mode_label = document.createElement('span')
    mode_label.style.color = '#6b7280'
    mode_label.textContent = 'mode [G]: '
    mode_val = document.createElement('span')
    mode_val.style.color = '#4a9eff'
    mode_row.append(mode_label, mode_val)
    root.appendChild(mode_row)
  }

  // Static view-distance readout (D33). Not a per-frame stat — the streaming radius is fixed per load,
  // so render it once at the top of the panel rather than polling it every rAF tick.
  if (typeof view_distance_m === 'number' && Number.isFinite(view_distance_m)) {
    const vd_row = document.createElement('div')
    const vd_label = document.createElement('span')
    vd_label.style.color = '#6b7280'
    vd_label.textContent = 'view dist: '
    const vd_val = document.createElement('span')
    vd_val.style.color = '#c8963c'
    vd_val.textContent = `${Math.round(view_distance_m)} m`
    vd_row.append(vd_label, vd_val)
    root.appendChild(vd_row)
  }

  const rows = FIELD_ROWS.map(([key, label]) => {
    const row = document.createElement('div')
    const label_span = document.createElement('span')
    label_span.style.color = '#6b7280'
    label_span.textContent = `${label}: `
    const value_span = document.createElement('span')
    value_span.style.color = '#c8963c'
    row.appendChild(label_span)
    row.appendChild(value_span)
    root.appendChild(row)
    return { key, value_span }
  })

  // Render-scale slider (manual fill-relief lever — engine.set_render_scale, [0.5,1.0]). The
  // HUD root is pointer-events:none so the world stays click-through; this row re-enables pointer
  // events on ITSELF only, so the slider is draggable without stealing camera clicks elsewhere.
  const scale_row = document.createElement('div')
  scale_row.style.cssText = 'margin-top:6px; pointer-events:auto; display:flex; align-items:center; gap:6px;'
  const scale_label = document.createElement('span')
  scale_label.style.color = '#6b7280'
  scale_label.textContent = 'render scale: '
  const scale_input = document.createElement('input')
  scale_input.type = 'range'
  scale_input.min = '0.5'
  scale_input.max = '1'
  scale_input.step = '0.05'
  scale_input.value = '1'
  scale_input.style.cssText = 'flex:1; min-width:70px; accent-color:#c8963c; cursor:pointer;'
  const scale_val = document.createElement('span')
  scale_val.style.color = '#c8963c'
  scale_val.textContent = '1.00'
  scale_input.addEventListener('input', () => {
    const value = Number(scale_input.value)
    scale_val.textContent = value.toFixed(2)
    try {
      engine.set_render_scale(value)
    } catch {
      // Pre-boot / stub facade — ignore; the slider just won't take effect until the engine is live.
    }
  })
  scale_row.append(scale_label, scale_input, scale_val)
  root.appendChild(scale_row)

  let raf_handle = 0
  let disposed = false

  function tick() {
    if (disposed) return
    /** @type {Partial<EngineStats>} */
    let stats = {}
    try {
      stats = engine.get_stats() ?? {}
    } catch {
      // WS1 stats feed not wired yet — HUD stays blank rather than crashing the demo.
    }

    for (const [key, , format] of FIELD_ROWS) {
      const row = rows.find((r) => r.key === key)
      if (!row) continue
      const value = /** @type {Record<string, unknown>} */ (stats)[key]
      row.value_span.textContent = format(value, stats)
    }

    // ENG-8 mode line: "walk · RUN 12.4m/s · ground" or "fly".
    if (mode_val) {
      const mode = get_mode?.() ?? 'fly'
      const ws = mode === 'walk' ? get_walk_state?.() : null
      if (ws) {
        const where = ws.in_water ? 'water' : ws.on_ground ? 'ground' : 'air'
        mode_val.textContent = `walk · ${ws.anim} ${ws.speed.toFixed(1)}m/s · ${where}`
      } else {
        mode_val.textContent = mode
      }
    }

    // Exposed for the Playwright bench harness (bench/harness.js) — avoids re-querying the
    // engine from page-eval context and guarantees bench numbers match what's on screen.
    window.__ares_last_stats__ = stats

    raf_handle = requestAnimationFrame(tick)
  }

  raf_handle = requestAnimationFrame(tick)

  return {
    dispose() {
      disposed = true
      cancelAnimationFrame(raf_handle)
      root.remove()
    },
  }
}
