// AUTO-EXPOSURE — transient eye adaptation (target: the white flood "should probably be the 'eye
// adaptation' feeling" — a TRANSIENT exposure event, never a standing veil). Before this, exposure was a
// STATIC constant (renderer.toneMappingExposure = 1.1); nothing could ever decay, so any bright step read
// as a fixed sheet. This adds a CPU temporal servo: it averages the post-tonemap low-freq luma (the 96×54
// RTT the grade already renders — post_stack.js), and nudges renderer.toneMappingExposure so the frame's
// average brightness relaxes toward a target — FAST when the world brightens (pupil contracts), SLOW when
// it darkens (pupil dilates) — CLAMPED tight so the world only ever BREATHES, never re-grades. A FEEL
// feature, not HDR correctness: the target is centred on the typical scene so the mean look stays faithful
// to the tuned 1.1, and the clamp bounds every excursion to a gentle ±.
//
// The exposure node reads renderer.toneMappingExposure LIVE (three's ToneMappingNode defaults its exposure
// to rendererReference('toneMappingExposure')), so driving that ONE number is the whole hookup — zero
// node-graph edits. The metering is a CPU readback of the existing low_freq target (no new render pass).
// Pure servo math is exported + unit-tested; the factory owns the async readback + persistent state.

/** asymmetric adaptation time constants (seconds). FAST = adapting to a BRIGHTER scene (exposure DOWN — the eye
 *  squints); SLOW = adapting to a DARKER scene (exposure UP — the eye dilates slowly).
 *
 *  [BUG A — VFX read as washed out, not punchy, and too light] tau_fast was 0.6s. A bright VFX cast
 *  spikes the full-frame meter (harness-measured 0.37→~0.58 during a cast; ground-truth in auto_exposure notes),
 *  so at 0.6s the fast-down servo dived exposure ~9% (toward the 0.85 clamp floor under repeats) WITHIN the ≤0.42s
 *  flash — dimming the very frame the flash lit, self-washing every cast. Raised to 2.0s: a sub-0.5s transient now
 *  moves the servo <4% (it can't travel far in 0.3s), and the RELATIVE servo self-recovers after — while a
 *  SUSTAINED brightening (sky look-up, walking out of canopy) still fully contracts over ~2s, so the beloved
 *  eye-adaptation breathe survives; only the flash-suppression dies. A low-pass on the METER was tried and REVERTED
 *  (it attenuates the spike's peak but smears its dwell to ~τ, and a faster servo then catches the smeared meter
 *  and dips MORE — the dip is bounded by the down-TAU, not the meter). See auto_exposure.test.js (BUG A e2e). */
export const ADAPT_TAU_FAST = 2.0
export const ADAPT_TAU_SLOW = 2.5
/** target average post-tonemap luma [0,1] the servo relaxes toward. Centred on the OPEN-FIELD HERO view
 *  (measured full-frame avg ≈0.37 at the shipped baseline 1.1 — the target: "punchy open terrain"): so the
 *  open field settles AT the baseline (his tuned look preserved), while shaded/interior/downward scenes —
 *  which read darker than the hero — LIFT toward it (eye dilating in the dark), and a sky-filled look-up
 *  dims slightly (killing the "look up = white"). Adaptation is therefore mostly a gentle BRIGHTENING of
 *  dark scenes, never a uniform darkening of the world. */
export const EXPOSURE_TARGET_LUMA = 0.37
/** the shipped static baseline (renderer.js) — the servo's rest point + the fallback when metering fails. */
export const EXPOSURE_BASELINE = 1.1
/** tight clamp — a FEEL nudge, never HDR normalization (the world must never look wrong, only breathe). The
 *  upper bound deliberately does NOT let a cave/canopy fully normalize to the open field's brightness (mood
 *  contrast survives); the lower bound only bites when staring at bright sky. */
export const EXPOSURE_MIN = 0.85
export const EXPOSURE_MAX = 1.4

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
const clampf = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)

/** Frame-rate-independent exponential smoothing factor for a time constant tau (seconds).
 * @param {number} dt seconds @param {number} tau seconds @returns {number} blend factor in [0,1] */
export function smoothing_factor(dt, tau) {
  if (!(tau > 0)) return 1
  return 1 - Math.exp(-Math.max(dt, 0) / tau)
}

/**
 * @typedef {object} ExposureCfg
 * @property {number} [target] target average luma [0,1]
 * @property {number} [tau_fast] seconds (exposure decreasing — adapting to bright)
 * @property {number} [tau_slow] seconds (exposure increasing — adapting to dark)
 * @property {number} [min] exposure clamp floor
 * @property {number} [max] exposure clamp ceiling
 */

/**
 * ONE servo step (pure). Given the current exposure, the measured average luma, and dt, return the next
 * exposure — nudged toward the exposure that would land the average at `target`, asymmetrically smoothed
 * and clamped. Invalid/absent measurement (≤0, e.g. black boot frame / no readback yet) → hold at clamp.
 * @param {number} exposure current renderer.toneMappingExposure
 * @param {number} measured_luma average post-tonemap luma of the last frame [0,1] (or ≤0 = none)
 * @param {number} dt seconds since last step
 * @param {ExposureCfg} [cfg]
 * @returns {number} next exposure
 */
export function adapt_exposure(exposure, measured_luma, dt, cfg = {}) {
  const target = cfg.target ?? EXPOSURE_TARGET_LUMA
  const tau_fast = cfg.tau_fast ?? ADAPT_TAU_FAST
  const tau_slow = cfg.tau_slow ?? ADAPT_TAU_SLOW
  const min = cfg.min ?? EXPOSURE_MIN
  const max = cfg.max ?? EXPOSURE_MAX
  if (!(measured_luma > 1e-4)) return clampf(exposure, min, max)
  // multiplicative correction: measured brighter than target ⇒ err<1 ⇒ desired exposure below current.
  const err = target / measured_luma
  const desired = clampf(exposure * err, min, max)
  // decreasing exposure = adapting to a brighter world = FAST; increasing = adapting to dark = SLOW.
  const tau = desired < exposure ? tau_fast : tau_slow
  return exposure + (desired - exposure) * smoothing_factor(dt, tau)
}

/**
 * Average luminance of a raw readback buffer, robust to the backend's typed-array format:
 *   • Uint8Array   — LDR byte target, value/255
 *   • Float32Array — float target, value direct
 *   • Uint16Array  — HalfFloat target (the rtt default): decode IEEE-754 half → float
 * Rec.709 luma over RGBA texels. Returns 0 for an empty/blank buffer (⇒ servo holds).
 * @param {(ArrayBufferView & { length:number }) | null | undefined} buf interleaved RGBA
 * @returns {number} average luma in the buffer's own value space ([0,1] for our LDR meter)
 */
export function average_luma(buf) {
  if (!buf || !buf.length) return 0
  const u8 = buf instanceof Uint8Array
  const u16 = typeof Uint16Array !== 'undefined' && buf instanceof Uint16Array
  const arr = /** @type {any} */ (buf)
  let sum = 0
  const n = arr.length / 4
  for (let i = 0; i < arr.length; i += 4) {
    let r = arr[i]
    let g = arr[i + 1]
    let b = arr[i + 2]
    if (u8) {
      r /= 255
      g /= 255
      b /= 255
    } else if (u16) {
      r = half_to_float(r)
      g = half_to_float(g)
      b = half_to_float(b)
    }
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return n > 0 ? sum / n : 0
}

/** IEEE-754 half-float (Uint16 bits) → Number. @param {number} h @returns {number} */
function half_to_float(h) {
  const s = (h & 0x8000) >> 15
  const e = (h & 0x7c00) >> 10
  const f = h & 0x03ff
  const sign = s ? -1 : 1
  if (e === 0) return sign * Math.pow(2, -14) * (f / 1024)
  if (e === 0x1f) return f ? NaN : sign * Infinity
  return sign * Math.pow(2, e - 15) * (1 + f / 1024)
}

/**
 * @typedef {object} AutoExposure
 * @property {(dt:number)=>number} pre_render advance the servo by dt from the last measurement and RETURN
 *   the exposure to apply (caller sets renderer.toneMappingExposure). No-op-ish when disabled (→ baseline).
 * @property {(renderer:*, meter_rt:*)=>void} post_render kick an async readback of the meter target to
 *   refresh the measurement for the NEXT frame (one in flight at a time; failures degrade to hold).
 * @property {number} exposure current exposure (live getter).
 * @property {number} measured last measured average luma (diagnostic).
 * @property {{value:boolean}} enabled live kill switch (internal — no URL flag; URL-based feature flags were removed).
 * @property {ExposureCfg} cfg live-tunable knobs.
 */

/**
 * Build the auto-exposure servo. Stateless w.r.t. the GPU (it only READS an existing target), so there is
 * nothing to dispose. Degrades to the static baseline whenever metering is unavailable or disabled.
 * @param {ExposureCfg & { baseline?:number, enabled?:boolean }} [opts]
 * @returns {AutoExposure}
 */
export function create_auto_exposure(opts = {}) {
  const baseline = opts.baseline ?? EXPOSURE_BASELINE
  const cfg = {
    target: opts.target ?? EXPOSURE_TARGET_LUMA,
    tau_fast: opts.tau_fast ?? ADAPT_TAU_FAST,
    tau_slow: opts.tau_slow ?? ADAPT_TAU_SLOW,
    min: opts.min ?? EXPOSURE_MIN,
    max: opts.max ?? EXPOSURE_MAX,
  }
  const enabled = { value: opts.enabled ?? true }
  let exposure = baseline
  let measured = -1 // last average luma; <0 = none yet ⇒ servo holds
  let reading = false // a readback is in flight (never overlap)

  const pre_render = (/** @type {number} */ dt) => {
    if (!enabled.value) {
      // ease back to baseline so toggling off doesn't snap.
      exposure += (baseline - exposure) * smoothing_factor(dt, cfg.tau_fast)
      return exposure
    }
    exposure = adapt_exposure(exposure, measured, dt, cfg)
    return exposure
  }

  const post_render = (/** @type {*} */ renderer, /** @type {*} */ meter_rt) => {
    if (!enabled.value || reading || !meter_rt || !renderer?.readRenderTargetPixelsAsync) return
    const w = meter_rt.width
    const h = meter_rt.height
    if (!w || !h) return
    reading = true
    renderer
      .readRenderTargetPixelsAsync(meter_rt, 0, 0, w, h)
      .then((/** @type {*} */ buf) => {
        const avg = average_luma(buf)
        if (avg > 1e-4 && Number.isFinite(avg)) measured = avg
      })
      .catch(() => {}) // degrade to hold — never throw into the frame loop
      .finally(() => {
        reading = false
      })
  }

  return {
    pre_render,
    post_render,
    get exposure() {
      return exposure
    },
    get measured() {
      return measured
    },
    enabled,
    cfg,
  }
}
