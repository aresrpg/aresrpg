// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EXPORT FIGHT TRACE — the browser-download edge over @aresrpg/fight's trace tap (issue #209). Downloads the
// most recently captured fight's INPUT LOG (fight/store's own reducer-door messages, verbatim) as a JSON file
// the player can attach to a bug report. No servers, no uploads — a local file only.
//
// THIS IS A TRACE, NOT A CAPSULE. packages/sim/src/recorder.js/timeline.js own that word for the CLI/Move-
// parity fixture format (sim commands replayed through reduce()). The live client never drives a WHOLE fight
// through sim's reduce() — only the local player's own next-cast preview crosses it (predict_cast.js),
// discarded the instant the chain receipt lands. Every other fact of the fight — mob turns, moves, other
// players, the real outcome — crosses fight/store's ONE input door, which IS the fight's true reducer; folding
// a trace's `inputs` back through a fresh store reproduces the exact same projection (pinned by
// packages/fight/src/trace_store_replay.test.js). Effect edge only: dump_current_trace does the real work
// (headless, testable without a DOM); this file owns the Blob/anchor download dance.
//
// V2 SHADOW BUNDLING (issue #522 follow-up, owner ruling 2026-07-24): when the shadow fan-out is armed and has
// captured a divergence capsule, export bundles it into the SAME file rather than shipping a second button/
// download — a bug report should never require a player to find and attach two files for one fight.
// `get_shadow_capsule` is the tee's own getter (fight_trace_tee.js owns `window`; this file never reads it
// directly). `build_export_payload` is the pure, testable seam: extend the trace shape MINIMALLY (one extra
// top-level field, only when a capsule exists) so a trace exported with no shadow armed round-trips through
// parse_trace byte-identical to before this file grew a second capsule.

import { fight_store } from '@aresrpg/fight/store'
import { stringify_trace } from '@aresrpg/fight/trace_tap'

import { get_shadow_capsule } from '../../../world-shell/fight_trace_tee.js'

// Vite injects this build-wide (vite.config.ts __APP_VERSION__); `typeof` guards the non-Vite context (bun
// test) — the same pattern core/report.js's RELEASE constant uses for __GIT_SHA__.
const app_version = () => (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')

/** Is there a fight trace worth offering right now? Cheap (reads the bounded in-memory ring buffer only) —
 *  gates the end-card export button's ENABLED state (FightReport.jsx) so it is never a dead click.
 * @returns {boolean} */
export const has_dumpable_trace = () =>
  fight_store.trace_tap.dump_current_trace(app_version(), Date.now()) != null

/** Shape the export payload: the replay trace, plus the shadow's last divergence capsule when one exists.
 *  Pure — testable without a DOM (see fight_trace_export.test.js). `shadow_capsule` rides as its own
 *  top-level field so a trace with no shadow armed/diverged is byte-identical to the pre-#522 shape.
 * @param {import('@aresrpg/fight/trace_tap').FightTrace} trace @param {object | null} shadow_capsule
 */
export const build_export_payload = (trace, shadow_capsule) =>
  shadow_capsule ? { ...trace, shadow_capsule } : trace

/** Dump the most recent fight's trace and trigger a browser download. No-op (returns false) when nothing was
 *  captured — never a fabricated empty file.
 * @returns {boolean} */
export function export_fight_trace() {
  const trace = fight_store.trace_tap.dump_current_trace(app_version(), Date.now())
  if (!trace) return false
  const payload = build_export_payload(trace, get_shadow_capsule())
  // BigInt-safe: decode_fight()'s chain u64 fields (world_seed, shape_mask, …) ride a 'snapshot' input's
  // msg.fight verbatim — a bare JSON.stringify throws the instant the walk reaches one (trace_recorder.js).
  const blob = new Blob([stringify_trace(payload, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `aresrpg-fight-trace-${trace.fight_id}-${trace.captured_at}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return true
}
