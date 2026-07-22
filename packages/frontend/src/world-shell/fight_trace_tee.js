// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// fight_trace_tee.js — the RECORDER TEE (V2 build step 1, commit ②). It EXTENDS the __ARES_FIGHT_TRACE
// diagnostic recorder (fight_state_trace.js — prior art) to the full input-envelope union: the corpus
// grows from real edge/prod sessions BEFORE the V2 core exists (strangler migration).
//
// THE SEAM: the fight store's `input(msg, now)` is the ONLY writer of fight state repo-wide, so EVERY
// ingress the machinery consumes — journal poll, courtesy (p2p) rows, tx submit/refuse/status (the busy
// mirror carries the executed-failure digest in its latch), draft/commit dispatches, the presenter's
// clock — converges there. One transparent tap on that door captures them all. The original `input`
// still runs and its return is returned verbatim (rider R3: nothing existing is deleted or bypassed);
// the tap only OBSERVES, wrapped so a tap fault can never perturb the fight.
//
// Gated OFF in ordinary play (same switch as fight_state_trace: `?fighttrace=1` or
// `window.__ARES_FIGHT_TRACE_ENABLED = true`). When off, a tap is two boolean reads then a straight
// delegate — no classification, no allocation, no serialization (that happens only at dump time).

import { fight_store } from '@aresrpg/fight/store'
import { input_envelope } from '@aresrpg/fight/envelope'
import { classify_input } from '@aresrpg/fight/classify_input'
import { push_bounded, capsule_export, CAPSULE_RING_LIMIT } from '@aresrpg/fight/capsule'

import { fight_trace_enabled } from './fight_state_trace.js'

const CAPSULE_RING = '__ARES_FIGHT_CAPSULE' // window home of the bounded envelope ring
const TEE_INSTALLED = '__ARES_FIGHT_TEE_INSTALLED'
const CAPSULE_DUMP = '__ARES_FIGHT_CAPSULE_DUMP' // the copy-trace affordance, upgraded to format-2

let capture_seq = 0
let url_flag = null // memoized ?fighttrace= parse (never re-parsed per input)

const tee_enabled = () => {
  if (typeof window === 'undefined') return false
  if (/** @type {any} */ (window).__ARES_FIGHT_TRACE_ENABLED === true) return true
  if (url_flag === null) url_flag = fight_trace_enabled(window.location?.search ?? '')
  return url_flag
}

// Vite injects __APP_VERSION__ at build; the typeof guard keeps this module import-safe under node/tests.
const app_version = () => (typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__)

/** Record ONE door message as an envelope in the bounded ring. Read-only: never touches `msg` or the
 *  store; `now` is the reducer's clock reading (the ONE tap timestamp). */
const record_input = (msg, now) => {
  if (!tee_enabled()) return
  const target = /** @type {any} */ (window)
  const ring = Array.isArray(target[CAPSULE_RING]) ? target[CAPSULE_RING] : []
  const env = input_envelope({
    session_id: msg?.fight_id ?? fight_store.getState().fight_id ?? null,
    input_seq: capture_seq++,
    observed_at_ms: typeof now === 'number' ? now : Date.now(),
    payload: classify_input(msg),
  })
  target[CAPSULE_RING] = push_bounded(ring, env, CAPSULE_RING_LIMIT)
}

/** The copy-trace affordance, upgraded: dump the current ring as a portable trace_format-2 capsule. The
 *  legacy `__ARES_FIGHT_TRACE` (format-1 diagnostic rows) is untouched and still dumps as before. */
const dump_capsules = () => {
  const target = typeof window === 'undefined' ? {} : /** @type {any} */ (window)
  const capsules = Array.isArray(target[CAPSULE_RING]) ? target[CAPSULE_RING] : []
  return capsule_export({
    session_id: fight_store.getState().fight_id ?? null,
    app_version: app_version(),
    captured_at: Date.now(),
    capsules,
  })
}

/**
 * Install the transparent door tee ONCE. Idempotent (a second call is a no-op); a no-op under node
 * (no window). The original `input` is captured and always invoked — behavior is unchanged.
 * @param {{ getState: () => any, setState: (partial: any) => void }} [store]
 */
export const install_fight_trace_tee = (store = fight_store) => {
  if (typeof window === 'undefined') return
  const target = /** @type {any} */ (window)
  if (target[TEE_INSTALLED]) return
  const original = store.getState().input
  if (typeof original !== 'function') return
  const teed = (msg, now = Date.now()) => {
    try {
      record_input(msg, now)
    } catch {
      /* a diagnostic tap NEVER perturbs the fight flow */
    }
    return original(msg, now)
  }
  store.setState({ input: teed })
  target[TEE_INSTALLED] = true
  target[CAPSULE_DUMP] = dump_capsules
}
