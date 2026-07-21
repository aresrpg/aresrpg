// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Adapter-only quality detection (§5.2 step 1). M0 picks a STARTING tier from GPUAdapter.info +
// adapter.limits + navigator.deviceMemory/hardwareConcurrency + platform — no micro-bench yet
// (that's §5.2 step 2, M1+). MOBILE (iOS + Android/handheld UA) FLOORS to LOW by design
// (2026-07-14: "low low low then adapt") — this supersedes the older iOS→MEDIUM ceiling, which stays only
// as a defensive belt (unreachable once the mobile floor fires, since iOS implies mobile here).
//
// This module never touches the renderer or GPU device beyond `navigator.gpu.requestAdapter()`
// — it's a pure heuristic classifier, safe to call before `create_renderer()`.

import { get_tier, TIER_ORDER } from './tiers.js'

/** @typedef {import('./tiers.js').TierName} TierName */

/**
 * @typedef {object} DetectSignals
 * @property {string} [vendor] GPUAdapterInfo.vendor, lowercased
 * @property {string} [architecture] GPUAdapterInfo.architecture, lowercased
 * @property {boolean} is_fallback_adapter GPUAdapterInfo.isFallbackAdapter (SwiftShader etc.)
 * @property {number} [max_buffer_size_bytes] adapter.limits.maxBufferSize
 * @property {number} [max_storage_buffer_binding_bytes] adapter.limits.maxStorageBufferBindingSize
 * @property {number} [device_memory_gb] navigator.deviceMemory
 * @property {number} hardware_concurrency navigator.hardwareConcurrency, defaulted to 4
 * @property {boolean} is_ios platform sniff (§5.2 iOS ceiling = MEDIUM)
 * @property {boolean} is_mobile iOS OR Android/other handheld UA — floors to LOW ("low low low then adapt")
 * @property {number} device_pixel_ratio window.devicePixelRatio (dense panels multiply fill cost), defaulted to 1
 * @property {boolean} has_webgpu whether navigator.gpu exists at all
 */

/**
 * Gathers the raw signals used by `pick_starting_tier`. Split out so bench/tests can feed
 * synthetic signals without a real GPU context.
 * @returns {Promise<DetectSignals>}
 */
export async function gather_detect_signals() {
  const hardware_concurrency = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4
  // navigator.deviceMemory is a non-standard Chrome-only API (no lib.dom types) — narrow cast.
  const device_memory_gb =
    typeof navigator !== 'undefined' ? /** @type {{deviceMemory?: number}} */ (navigator).deviceMemory : undefined
  const is_ios = detect_ios()
  const is_mobile = is_ios || detect_mobile()
  // devicePixelRatio lives on window; guard the non-DOM (test/SSR) path the same way navigator is guarded.
  const device_pixel_ratio = typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1
  const has_webgpu =
    typeof navigator !== 'undefined' && 'gpu' in navigator && /** @type {any} */ (navigator).gpu != null

  if (!has_webgpu) {
    return {
      is_fallback_adapter: false,
      hardware_concurrency,
      device_memory_gb,
      is_ios,
      is_mobile,
      device_pixel_ratio,
      has_webgpu: false,
    }
  }

  const adapter = await /** @type {any} */ (navigator).gpu.requestAdapter()
  if (!adapter) {
    return {
      is_fallback_adapter: true,
      hardware_concurrency,
      device_memory_gb,
      is_ios,
      is_mobile,
      device_pixel_ratio,
      has_webgpu: true,
    }
  }

  // GPUAdapter.info is the standard, current API — requestAdapterInfo() was removed from the
  // spec (§5.2), no fallback needed.
  const { info } = adapter

  return {
    vendor: info?.vendor?.toLowerCase(),
    architecture: info?.architecture?.toLowerCase(),
    is_fallback_adapter: Boolean(info?.isFallbackAdapter),
    max_buffer_size_bytes: adapter.limits?.maxBufferSize,
    max_storage_buffer_binding_bytes: adapter.limits?.maxStorageBufferBindingSize,
    hardware_concurrency,
    device_memory_gb,
    is_ios,
    is_mobile,
    device_pixel_ratio,
    has_webgpu: true,
  }
}

/**
 * @returns {boolean}
 */
function detect_ios() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent ?? ''
  const is_apple_touch_platform = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports as "Macintosh" with touch support — the standard sniff.
  const is_ipados_as_mac = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1
  return is_apple_touch_platform || is_ipados_as_mac
}

/**
 * Broad NON-iOS handheld sniff (Android + other mobile browsers). iOS is `detect_ios` (which also catches
 * iPadOS-as-Mac); this covers Android / Windows Phone / generic `Mobi` UAs so the mobile floor
 * (2026-07-14: "low low low then adapt") fires on every handheld, not just Apple.
 * @returns {boolean}
 */
function detect_mobile() {
  if (typeof navigator === 'undefined') return false
  return /Android|Mobi|Windows Phone/i.test(navigator.userAgent ?? '')
}

/**
 * Classifies raw signals into a starting rung on TIER_ORDER. Coarse and conservative by design
 * (§5.2: "info is deliberately coarse — picks the starting rung only") — the runtime governor
 * (governor.js) corrects mis-guesses from here within the first ~30s.
 * @param {DetectSignals} signals
 * @returns {TierName}
 */
export function pick_starting_tier(signals) {
  if (!signals.has_webgpu || signals.is_fallback_adapter) return 'low'

  // OWNER FLOOR (2026-07-14 verbatim: "maybe mobile should start in low low low then adapt"): every mobile
  // handheld BOOTS at the floor regardless of adapter strength — a phone GPU's info/limits over-report vs its
  // sustained thermal budget, so the safe start is the floor. (Live tier-stepping up is C3/adaptive-v2; today
  // the user can raise it via the quality dropdown and the render-scale governor manages within LOW.)
  if (signals.is_mobile) return 'low'

  let score = 0

  // Software/low-power GPU markers.
  if (signals.architecture?.includes('swiftshader') || signals.architecture?.includes('llvmpipe')) return 'low'
  if (signals.vendor?.includes('intel')) score += 1 // integrated-heavy vendor, conservative baseline
  if (signals.vendor?.includes('apple')) score += 2 // Apple Silicon unified memory, generally strong
  if (signals.vendor?.includes('nvidia') || signals.vendor?.includes('amd')) score += 3

  if ((signals.hardware_concurrency ?? 4) >= 8) score += 1
  if ((signals.hardware_concurrency ?? 4) >= 16) score += 1

  if (signals.device_memory_gb !== undefined) {
    if (signals.device_memory_gb >= 8) score += 1
    if (signals.device_memory_gb >= 16) score += 1
  }

  if ((signals.max_storage_buffer_binding_bytes ?? 0) >= 1 << 30) score += 1 // ≥1 GiB storage binding

  // Scarce RAM biases DOWN (symmetric with the memory ADDs above): a ≤4 GB machine is fill/heap constrained,
  // so a conservative start is right (§5.2: coarse — the governor corrects within ~30s). Soft −1 (not a hard
  // floor) so a scarce-RAM box with a real dGPU can still reach MEDIUM.
  if ((signals.device_memory_gb ?? 8) <= 4) score -= 1

  // S-85 3-rung bucketing (§4): weak / integrated / mobile → LOW, mainstream → MEDIUM, beefy dGPU →
  // HIGH. Max score ≈ 8 (vendor 3 + concurrency 2 + memory 2 + storage 1).
  const picked = /** @type {TierName} */ (score <= 2 ? 'low' : score <= 5 ? 'medium' : 'high')

  // A VERY dense panel (DPR ≥ 3) is a fill multiplier no adapter score accounts for — real desktops sit at
  // DPR 1–2, so this only bites emulated / handheld-desktop-mode contexts and caps them at MEDIUM. The PRIMARY
  // DPR lever is per-tier (tiers.js dpr_max + the streaming DPR cap), which is why DPR is otherwise just
  // captured in signals for those render-side consumers; here it is only a coarse safety ceiling.
  const dpr_capped =
    picked === 'high' && (signals.device_pixel_ratio ?? 1) >= 3 ? /** @type {TierName} */ ('medium') : picked

  return apply_platform_ceiling(dpr_capped, signals)
}

/**
 * Applies hard platform ceilings that no amount of adapter score should exceed. iOS caps at
 * MEDIUM (§5.2) regardless of raw signal strength (thermal throttling, Safari WebGPU maturity).
 * DEFENSIVE BELT since 2026-07-14: the mobile floor in pick_starting_tier now returns LOW before this
 * runs for any iOS device (iOS ⟹ is_mobile), so this branch only guards a synthetic/edge signal.
 * @param {TierName} picked
 * @param {DetectSignals} signals
 * @returns {TierName}
 */
function apply_platform_ceiling(picked, signals) {
  if (signals.is_ios) {
    const ceiling_index = TIER_ORDER.indexOf('medium')
    const picked_index = TIER_ORDER.indexOf(picked)
    return picked_index > ceiling_index ? 'medium' : picked
  }
  return picked
}

/**
 * Convenience one-shot: gathers signals and returns both the picked tier name and its full
 * TierDef (from the frozen tiers.js table), which is what engine.js actually needs at boot.
 * @returns {Promise<{tier_name: TierName, tier: import('./tiers.js').TierDef, signals: DetectSignals}>}
 */
export async function detect_starting_tier() {
  const signals = await gather_detect_signals()
  const tier_name = pick_starting_tier(signals)
  return { tier_name, tier: get_tier(tier_name), signals }
}
