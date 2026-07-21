// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sync_eta — pure local predictor for "how long until the indexer catches up" (ONE-PIPELINE LAW: a
// single pure fold over polled samples; RpcLagBanner is the only edge that feeds it and reads it — no
// network, no timers, no store here). Every function is a deterministic transform over plain data,
// independently testable with synthetic sample series (red-first: see sync_eta.test.ts).

/** One observed sample: wall-clock ms + the remaining-checkpoints count at that instant. */
export interface SyncSample {
  t: number
  remaining: number
}

export interface SyncEstimatorState {
  /** EMA of Δremaining/Δt in checkpoints/sec — negative means shrinking (catching up), null until 2 samples. */
  rate_per_sec: number | null
  /** consecutive samples where remaining grew over the previous one; resets to 0 on any non-growth. */
  growing_streak: number
  /** running peak remaining seen this episode — the progress bar's denominator. */
  peak_remaining: number
  last: SyncSample
  /** wall-clock ms this episode's FIRST sample landed — never touched again. Bounds how long project_sync_status
   *  may keep claiming "measuring" (rate_per_sec still null) before honestly degrading to 'stalled' (#293). */
  episode_started_at: number
}

export type SyncStatus = 'unknown' | 'converging' | 'stalled'

export interface SyncProjection {
  status: SyncStatus
  eta_ms: number | null
  /** consumed/peak, clamped to [0,1] — 0 right when an episode starts or while it keeps getting worse. */
  progress: number
}

export const EMA_ALPHA = 0.3
export const GROWING_STREAK_STALL_THRESHOLD = 3
export const RATE_EPSILON_PER_SEC = 0.02
// #293: past this much wall-clock time stuck on the FIRST sample (no rate yet — RpcLagBanner's own poll
// starved, e.g. by the SAME gateway throttling #242 fixes), "measuring speed…" stops being an honest claim.
// ~2 poll intervals (RpcLagBanner's POLL_MS is 15s) — long enough that one slow tick never false-positives.
export const MEASURING_TIMEOUT_MS = 30_000

/** Pure fold: one new sample in, next estimator state out. `state = null` starts a fresh episode. */
export function fold_sync_sample(
  state: SyncEstimatorState | null,
  sample: SyncSample,
  alpha: number = EMA_ALPHA
): SyncEstimatorState {
  if (!state)
    return {
      rate_per_sec: null,
      growing_streak: 0,
      peak_remaining: sample.remaining,
      last: sample,
      episode_started_at: sample.t,
    }

  const dt_sec = (sample.t - state.last.t) / 1000
  // Duplicate or out-of-order timestamp: no time elapsed to derive a rate from — skip it for timing
  // purposes (keep `last` as-is so the NEXT real sample still measures dt against real elapsed time),
  // but still let its count raise the peak defensively.
  if (dt_sec <= 0) return { ...state, peak_remaining: Math.max(state.peak_remaining, sample.remaining) }

  const delta = sample.remaining - state.last.remaining
  const instant_rate = delta / dt_sec
  const rate_per_sec =
    state.rate_per_sec == null ? instant_rate : alpha * instant_rate + (1 - alpha) * state.rate_per_sec
  const growing_streak = delta > 0 ? state.growing_streak + 1 : 0

  return {
    rate_per_sec,
    growing_streak,
    peak_remaining: Math.max(state.peak_remaining, sample.remaining),
    last: sample,
    episode_started_at: state.episode_started_at,
  }
}

/**
 * Pure derivation: current estimator state → what the chip should show. `now` defaults to the state's own
 * last-sample time (zero elapsed — every existing single-arg call site keeps its exact prior behavior); a
 * caller that re-derives this on every render (RpcLagBanner) passes the REAL wall clock, which is what lets
 * the measuring-timeout below fire even while the estimator itself is frozen (no new sample landing).
 */
export function project_sync_status(
  state: SyncEstimatorState | null,
  now: number = state?.last.t ?? 0
): SyncProjection {
  if (!state) return { status: 'unknown', eta_ms: null, progress: 0 }

  const progress =
    state.peak_remaining > 0 ? Math.min(1, Math.max(0, 1 - state.last.remaining / state.peak_remaining)) : 0

  if (state.rate_per_sec == null) {
    // #293: never a PERMANENT "measuring speed…" — past the ceiling this degrades to the SAME honest
    // 'stalled' label a flat-rate stall already uses (no new UI), instead of claiming "measuring" forever.
    if (now - state.episode_started_at >= MEASURING_TIMEOUT_MS) return { status: 'stalled', eta_ms: null, progress }
    return { status: 'unknown', eta_ms: null, progress }
  }

  const stalled =
    state.growing_streak > GROWING_STREAK_STALL_THRESHOLD || Math.abs(state.rate_per_sec) < RATE_EPSILON_PER_SEC
  if (stalled) return { status: 'stalled', eta_ms: null, progress }

  if (state.rate_per_sec < 0) {
    const eta_ms = (state.last.remaining / Math.abs(state.rate_per_sec)) * 1000
    return { status: 'converging', eta_ms, progress }
  }

  // Positive rate but not yet past the stall-streak threshold — genuinely uncertain, no ETA claim.
  return { status: 'unknown', eta_ms: null, progress }
}

/** Humanize a duration for display — whole minutes under an hour, one-decimal hours beyond. Pure and
 * i18n-agnostic: the caller looks up the translated unit label for `unit`. */
export function format_eta_duration(eta_ms: number): { value: number; unit: 'min' | 'hour' } {
  const minutes = eta_ms / 60_000
  if (minutes < 60) return { value: Math.max(1, Math.round(minutes)), unit: 'min' }
  return { value: Math.round((minutes / 60) * 10) / 10, unit: 'hour' }
}
