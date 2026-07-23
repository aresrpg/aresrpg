// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// fight_trace_tee.js — the RECORDER TEE (V2 build step 1, commit ②) — and, since build-order step 3 (issue
// #522), the ONE TAP the SHADOW FAN-OUT (fight_v2_shadow.js) rides too. It EXTENDS the __ARES_FIGHT_TRACE
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
// ONE TAP, TWO CONSUMERS: the capsule-ring recorder below is UNTOUCHED (same gate, same behavior). The
// shadow fan-out is a SECOND, independently-gated consumer riding the SAME wrap — never a second
// `store.setState({ input })` layer. It builds its OWN envelope from the SAME `msg`/`now` `original` already
// saw (classify_input is a pure, cheap, deterministic map — recomputing it costs nothing a second observer
// can't afford) rather than reaching into the ring's private `capture_seq`, so the ring's existing
// `input_seq` sequencing (and its `tee_enabled()` gating) stays byte-for-byte what it was before this file
// grew a second consumer.
//
// Gated OFF in ordinary play (same switch as fight_state_trace: `?fighttrace=1` or
// `window.__ARES_FIGHT_TRACE_ENABLED = true`). When off, a tap is two boolean reads then a straight
// delegate — no classification, no allocation, no serialization (that happens only at dump time). The
// shadow fan-out has its OWN independent switch (`?v2shadow=1` / localStorage — fight_v2_shadow.js) and is
// zero work when disarmed, whatever the trace flag is doing.

import { fight_store, committed_state } from '@aresrpg/fight/store'
import { input_envelope } from '@aresrpg/fight/envelope'
import { classify_input } from '@aresrpg/fight/classify_input'
import { push_bounded, capsule_export, CAPSULE_RING_LIMIT } from '@aresrpg/fight/capsule'

import { fight_trace_enabled } from './fight_state_trace.js'
import { create_shadow_driver, shadow_enabled_from } from './fight_v2_shadow.js'

const CAPSULE_RING = '__ARES_FIGHT_CAPSULE' // window home of the bounded envelope ring
const CAPSULE_DUMP = '__ARES_FIGHT_CAPSULE_DUMP' // the copy-trace affordance, upgraded to format-2
// { fights_shadowed, divergences, last } — read by the FightReport end-card chip via get_shadow_status below
// (owner ruling 2026-07-24), never by a component reaching into `window` directly.
const SHADOW_STATUS = '__ARES_FIGHT_SHADOW'
// the last divergence's downloadable capsule, if any — bundled into the export button's download
// (fight_trace_export.js's get_shadow_capsule import) when present.
const SHADOW_CAPSULE = '__ARES_FIGHT_SHADOW_CAPSULE'
const TEE_WRAPPED = Symbol('ares-fight-trace-tee') // per-store idempotency latch (#568) — see install below

// Vite injects __APP_VERSION__ at build; the typeof guard keeps this module import-safe under node/tests.
const app_version = () => (typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__)

/** The shadow arm check itself — a pure read of `target`'s debug override / query / storage switch. Module
 *  level so BOTH the per-installation closure below and the standalone `shadow_is_armed` getter (React-facing
 *  section, bottom of file) share ONE definition — never two copies of the same arm logic (one home per fact). */
const shadow_armed_on = (target) => {
  if (target.__ARES_FIGHT_SHADOW_ENABLED === true) return true
  return shadow_enabled_from({
    search: target.location?.search ?? '',
    storage_get: (key) => {
      try {
        return target.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    },
  })
}

/**
 * Install the transparent door tee once PER STORE (#568). Its enablement cache, sequence, and shadow driver
 * all belong to THIS installation — every read/write goes through the supplied store, never the app
 * singleton behind a fresh store, and two installs on two stores never share state. A no-op under node. The
 * original `input` is captured and always invoked — behavior is unchanged.
 * @param {{ getState: () => any, setState: (partial: any) => void }} [store]
 */
export const install_fight_trace_tee = (store = fight_store) => {
  if (typeof window === 'undefined') return
  const target = /** @type {any} */ (window)
  const original = store.getState().input
  if (typeof original !== 'function' || /** @type {any} */ (original)[TEE_WRAPPED]) return
  let capture_seq = 0
  let url_flag = null // memoized ?fighttrace= parse for THIS installation

  const tee_enabled = () => {
    if (target.__ARES_FIGHT_TRACE_ENABLED === true) return true
    if (url_flag === null) url_flag = fight_trace_enabled(target.location?.search ?? '')
    return url_flag
  }

  /** Record ONE door message as an envelope. `now` is the reducer's ONE tap timestamp. */
  const record_input = (msg, now) => {
    if (!tee_enabled()) return
    const ring = Array.isArray(target[CAPSULE_RING]) ? target[CAPSULE_RING] : []
    const env = input_envelope({
      session_id: msg?.fight_id ?? store.getState().fight_id ?? null,
      input_seq: capture_seq++,
      observed_at_ms: typeof now === 'number' ? now : Date.now(),
      payload: classify_input(msg),
    })
    target[CAPSULE_RING] = push_bounded(ring, env, CAPSULE_RING_LIMIT)
  }

  /** Dump this installation's current ring as a portable trace_format-2 capsule. */
  const dump_capsules = () => {
    const capsules = Array.isArray(target[CAPSULE_RING]) ? target[CAPSULE_RING] : []
    return capsule_export({
      session_id: store.getState().fight_id ?? null,
      app_version: app_version(),
      captured_at: Date.now(),
      capsules,
    })
  }

  // UNMEMOIZED, unlike tee_enabled's url_flag: fight inputs arrive at human-interaction cadence (clicks, a
  // ~1s tick, occasional receipts), never a per-frame loop, so re-parsing a short query string plus one
  // localStorage read costs nothing worth a cache — and staying unmemoized keeps this trivially testable
  // per-case (a fresh `window` per test, no reset hook to remember).
  const shadow_armed = () => shadow_armed_on(target)

  // MODULE-INSTANCE scope (never a module global — the order-independence gate bites those, and #568 is
  // exactly this bug for the ring): a fresh `shadow` + `shadow_seq` per install call, lazily created on the
  // FIRST armed envelope so a session that never arms the flag never allocates a v2 core at all (zero work —
  // see fight_v2_shadow.js's header).
  let shadow = null
  let shadow_seq = 0
  /** THE SECOND CONSUMER of the one tap: feed the SAME `msg` (its own classify — header's ONE TAP note)
   *  through the v2 core and diff it against the OLD side's post-commit board. `store` here is always the
   *  instance `install_fight_trace_tee` was called with, never the `fight_store` singleton, so a test's own
   *  store is compared against itself. */
  const feed_shadow = (msg, now) => {
    shadow = shadow ?? create_shadow_driver({ app_version: app_version() })
    const envelope = input_envelope({
      session_id: msg?.fight_id ?? store.getState().fight_id ?? null,
      input_seq: shadow_seq++,
      observed_at_ms: typeof now === 'number' ? now : Date.now(),
      payload: classify_input(msg),
    })
    const verdict = shadow.ingest_envelope(envelope, committed_state(store.getState()))
    target[SHADOW_STATUS] = shadow.status()
    if (verdict.capsule) target[SHADOW_CAPSULE] = verdict.capsule
  }

  const teed = (msg, now = Date.now()) => {
    try {
      record_input(msg, now)
    } catch {
      /* a diagnostic tap NEVER perturbs the fight flow */
    }
    const result = original(msg, now) // the OLD pipeline commits — read its board only AFTER this line
    // Both `shadow_armed()` and `feed_shadow()` share ONE fault boundary (#568's own principle, applied to
    // this second consumer too): neither the arm check nor the shadow's own work may ever poison the ring,
    // the store, or each other.
    try {
      if (shadow_armed()) feed_shadow(msg, now)
    } catch {
      /* a diagnostic tap NEVER perturbs the fight flow */
    }
    return result
  }
  Object.defineProperty(teed, TEE_WRAPPED, { value: true })
  store.setState({ input: teed })
  target[CAPSULE_DUMP] = dump_capsules
}

// ── React-facing getters (ARCHITECTURE LAW: this file is the ONE window owner for fight-trace/shadow state —
// no component/hook reads `window` directly; FightReport.jsx and fight_trace_export.js ask these instead).
// Each is a plain read at render/effect time — never polled, SSR/node-safe (a no-op `window` reads null/false). ──

/** Is the V2 shadow armed on this page load? Same switch install_fight_trace_tee's own per-installation
 *  closure checks (the debug override or the query/storage flag) — exposed standalone so a caller can ask
 *  without installing a store. Gates whether the end-card shadow-status chip renders at all. */
export const shadow_is_armed = () => {
  if (typeof window === 'undefined') return false
  return shadow_armed_on(/** @type {any} */ (window))
}

/** The shadow driver's own status snapshot ({ fights_shadowed, divergences, last }), or null when the shadow
 *  has never fed an envelope this page load (disarmed, or armed but no fight has opened yet). */
export const get_shadow_status = () => {
  if (typeof window === 'undefined') return null
  const target = /** @type {any} */ (window)
  return target[SHADOW_STATUS] ?? null
}

/** The last divergence's downloadable trace_format-2 capsule, or null when no divergence has been captured
 *  this page load. fight_trace_export.js bundles this into the ② button's download when present. */
export const get_shadow_capsule = () => {
  if (typeof window === 'undefined') return null
  const target = /** @type {any} */ (window)
  return target[SHADOW_CAPSULE] ?? null
}
