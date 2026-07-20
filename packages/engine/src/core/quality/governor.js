// Runtime quality governor (§5.2 step 3) — the DYNAMIC-RESOLUTION policy that holds ≥120fps by
// trimming the swapchain pixel scale under fill pressure and restoring it when the GPU has room.
// This is the M3 deliverable the old stub reserved the seam for (tiers.js:26 — render_scale_max
// "fed to setPixelRatio … The single biggest fill lever", authored for exactly this governor).
//
// THE PHYSICS IT RESPECTS: rAF is vsync-locked, so a HEALTHY 120Hz frame reads ~8.33ms of WALL time no
// matter how much GPU headroom is left — you cannot measure spare GPU from frame wall-time. AND a
// render_scale change is a setPixelRatio realloc of the whole post-stack target chain: MEASURED at
// 20-100ms on the Studio at native-retina scale (each change is itself a freeze). So the ONE law that
// governs everything here is SETTLE, NEVER HUNT — make as few resolution changes as physically possible:
//   • The decision runs on a SLOW EMA of frame time with hitch outliers CLAMPED out (a >HITCH_CLAMP_MS
//     frame — a realloc, a GC, a one-off stall — must NOT drive the fill decision, or a resize's own
//     100ms frame cascades into more resizes). A single bad frame never moves the needle; only sustained
//     pressure does.
//   • A wide dead-band (GROW_TRIP…SHRINK_TRIP) + a post-change COOLDOWN mean that once the EMA lands in
//     the band the governor STOPS and holds — no per-frame flutter, no realloc churn. Under real fill
//     pressure (native retina too heavy) it steps DOWN a level every cooldown until the EMA enters the
//     band, then freezes there; when load clears it steps back UP slowly (after a long hold). At the
//     native resolution that is a handful of steps at scene entry, then a rock-steady hold.
//
// AT REST the EMA is under budget, scale is at the tier CEILING (1.0 on high/medium), and the picture is
// pixel-identical to today (frozen-tier law). Only high and medium are managed; LOW keeps its static
// 0.66. Tier STEPPING between rungs is out of scope — the governor manages resolution WITHIN a tier only.

import { get_tier, TIER_ORDER } from './tiers.js'

/** @typedef {import('./tiers.js').TierName} TierName */

// ── policy constants (the whole tuning surface) ─────────────────────────────────────────────────────
/** The frame-rate the governor defends: ≥120fps at all times. */
export const TARGET_FPS = 120
/** The 120fps frame budget in ms (8.33). Holding the EMA at/under this = holding 120. */
const BUDGET_MS = 1000 / TARGET_FPS
/** EMA smoothing (~20-frame time constant) — deliberately SLOW so a single hitch barely moves it; only
 *  sustained pressure crosses a trip. The stickiness is the whole point (a change is an expensive realloc). */
const EMA_ALPHA = 0.05
/** Frames worse than this are hitches (a realloc / GC / one-off stall), NOT steady fill — CLAMPED before
 *  they touch the EMA so a resize's own huge frame can never cascade into more resizes. */
const HITCH_CLAMP_MS = 40
/** EMA above this ⇒ sustained over budget ⇒ step down. Above BUDGET so the vsync-pinned ~8.3ms rest frame
 *  and its jitter never trip a needless shrink. */
const SHRINK_TRIP_MS = BUDGET_MS * 1.3 // ≈10.8ms
/** EMA below this ⇒ clearly holding 120 with room ⇒ eligible to step back up. The GROW_TRIP…SHRINK_TRIP
 *  dead-band is where the governor SETTLES and stops changing (no flutter). */
const GROW_TRIP_MS = BUDGET_MS * 1.02 // ≈8.5ms
/** Sharpness floor — the picture never drops below this scale (keeps high-res play). ~0.72. */
const GOV_FLOOR = 0.72
/** Quantised step between scale levels. Discrete levels ⇒ a bounded, small set of swapchain sizes. */
const SCALE_STEP = 0.04
/** Minimum wall-ms between ANY two scale changes — long enough that a change's own realloc frame settles
 *  before the next decision (no cascade) and reallocs stay rare. Reaching the floor under real fill takes
 *  ~7 × this, a one-time settle at scene entry. */
const CHANGE_COOLDOWN_MS = 600
/** After any shrink, hold off growing for this long so a load blip doesn't immediately realloc back up. */
const RECOVER_HOLD_MS = 2500
/** THE RESIZE-SAFETY GATE: a render_scale change is a setPixelRatio swapchain
 *  realloc; if it lands while a streaming material (terrain / water / far-field / entity GLB) is mid
 *  async-pipeline-compile, WebGPU throws "depthStencil.format undefined" and the material flashes/breaks —
 *  worse than a hitch. So the governor NEVER resizes while the scene is unsettled (booting / streaming, when
 *  pipelines compile), and once settled it waits this long for in-flight async compiles to finish before the
 *  first resize. Fill pressure is sustained, so it survives into the settled windows and is corrected there. */
const SETTLE_DEBOUNCE_MS = 500
/** Rolling window (frames) for the retained get_rolling_p75_ms readout. */
const SAMPLE_WINDOW_SIZE = 240

/** Wall-ms the scene must stay settled before the FIRST resize is allowed (exported for the regression
 *  test that proves the resize-safety gate). See SETTLE_DEBOUNCE_MS above. */
export const SETTLE_DEBOUNCE_MS_FOR_TEST = SETTLE_DEBOUNCE_MS

/** Tiers whose resolution the governor actively manages (LOW is static). */
const MANAGED_TIERS = new Set(/** @type {TierName[]} */ (['high', 'medium']))

/** Snap a scale to the SCALE_STEP grid so levels stay clean (1.0, 0.96, … 0.72) despite float drift. */
const snap_scale = (/** @type {number} */ s) => Math.round(s / SCALE_STEP) * SCALE_STEP

/**
 * @typedef {object} GovernorOptions
 * @property {TierName} initial_tier
 * @property {(tier: TierName) => void} set_tier called when the governor changes tier (tier STEPPING
 *   is not implemented here; this stays wired for a future policy + the manual override path).
 * @property {(scale: number) => void} [set_render_scale] applies a new swapchain pixel scale — the
 *   governor calls this ONLY on a quantised level change (engine.js wires it to api.set_render_scale).
 */

/**
 * @typedef {object} QualityGovernor
 * @property {(frame_ms: number) => void} record_frame feed one RENDERED frame's real wall-duration in
 *   ms (frame_dt, not a smoothed percentile) once per rAF; drives the EMA + the resolution decision.
 * @property {() => number} get_rolling_p75_ms rolling p75 over the sample window (HUD/telemetry).
 * @property {() => TierName} get_current_tier
 * @property {() => number} get_render_scale the governor's current applied scale.
 * @property {(tier: TierName) => void} set_tier manual/override tier set — resets the policy to the
 *   new tier's ceiling (engine.js applies that ceiling to the renderer in the same call).
 * @property {() => boolean} is_auto_managed true while the active tier's resolution is governed.
 */

/**
 * Create the dynamic-resolution governor. See the file header for the policy.
 * @param {GovernorOptions} options
 * @returns {QualityGovernor}
 */
export function create_governor({ initial_tier, set_tier, set_render_scale = () => {} }) {
  if (!TIER_ORDER.includes(initial_tier)) {
    throw new TypeError(`governor.js: unknown tier "${initial_tier}"`)
  }

  let current_tier = initial_tier
  let ceiling = get_tier(current_tier).render_scale_max
  /** Current applied pixel scale (matches what engine.js pushed to the renderer). */
  let scale = ceiling
  /** Frame-time EMA (ms), seeded at budget so a cold start doesn't false-trip. */
  let ema = BUDGET_MS
  /** Accumulated wall-clock (ms) from summed frame durations — the pacing/hold time base. */
  let clock_ms = 0
  let last_change_ms = -1e9
  let hold_until_ms = 0
  /** Clock time the scene most recently BECAME settled (Infinity = currently unsettled). The policy only
   *  acts once we've been settled for SETTLE_DEBOUNCE_MS — no resize races a compile (see the gate above). */
  let settled_since_ms = Infinity

  /** @type {number[]} rolling frame-time window for get_rolling_p75_ms only. */
  const samples = []
  let write_index = 0

  const managed = () => MANAGED_TIERS.has(current_tier)

  return {
    record_frame(frame_ms, settled = true) {
      if (!(frame_ms >= 0)) return // NaN/negative guard (a paused tab hands garbage deltas)
      if (samples.length < SAMPLE_WINDOW_SIZE) samples.push(frame_ms)
      else {
        samples[write_index] = frame_ms
        write_index = (write_index + 1) % SAMPLE_WINDOW_SIZE
      }

      clock_ms += frame_ms
      if (!managed()) return
      // RESIZE-SAFETY GATE: while the scene is unsettled (booting / streaming — pipelines compiling), FREEZE
      // the whole policy. We neither pollute the EMA with streaming-slow frames (which would dump a huge
      // shrink the instant it settles) nor resize into an in-flight compile (the depthStencil-undefined race).
      if (!settled) {
        settled_since_ms = Infinity
        return
      }
      if (settled_since_ms === Infinity) settled_since_ms = clock_ms // just settled — start the debounce
      // CLAMP hitch outliers out of the EMA: a realloc/GC/one-off stall is not steady fill, and letting a
      // resize's own huge frame drive the EMA would cascade into more resizes. Only sustained load moves it.
      ema += EMA_ALPHA * (Math.min(frame_ms, HITCH_CLAMP_MS) - ema)
      // Wait out the debounce so any async compiles kicked off by the just-finished streaming can complete
      // before the first resize (a settled scene with warm pipelines never races).
      if (clock_ms - settled_since_ms < SETTLE_DEBOUNCE_MS) return
      // COOLDOWN: never change again until the previous change's realloc has fully settled — keeps reallocs
      // rare and breaks any cascade. This single gate rate-limits BOTH directions.
      if (clock_ms - last_change_ms < CHANGE_COOLDOWN_MS) return

      let next = scale
      if (ema > SHRINK_TRIP_MS && scale > GOV_FLOOR + 1e-6) {
        // SUSTAINED over budget → step DOWN one level; block grow-back for a while so a blip can't realloc up.
        next = Math.max(GOV_FLOOR, snap_scale(scale - SCALE_STEP))
        hold_until_ms = clock_ms + RECOVER_HOLD_MS
      } else if (ema < GROW_TRIP_MS && scale < ceiling - 1e-6 && clock_ms >= hold_until_ms) {
        // Clear headroom + past the hold → step UP one level toward native. Otherwise (dead-band) HOLD.
        next = Math.min(ceiling, snap_scale(scale + SCALE_STEP))
      }

      if (next !== scale) {
        scale = next
        last_change_ms = clock_ms
        set_render_scale(scale)
      }
    },
    get_rolling_p75_ms() {
      if (samples.length === 0) return 0
      const sorted = [...samples].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.floor(0.75 * sorted.length))]
    },
    get_current_tier() {
      return current_tier
    },
    get_render_scale() {
      return scale
    },
    set_tier(tier) {
      if (!TIER_ORDER.includes(tier)) {
        throw new TypeError(`governor.js: unknown tier "${tier}"`)
      }
      current_tier = tier
      ceiling = get_tier(tier).render_scale_max
      // The engine applies this ceiling to the renderer in the same set_tier call — keep the policy in
      // lockstep so it manages downward from the fresh tier's native resolution, not stale state.
      scale = ceiling
      ema = BUDGET_MS
      last_change_ms = clock_ms
      hold_until_ms = clock_ms
      set_tier(tier)
    },
    is_auto_managed() {
      return managed()
    },
  }
}
