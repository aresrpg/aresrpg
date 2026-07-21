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

import { dump_current_trace } from '@aresrpg/fight/trace_tap'

// Vite injects this build-wide (vite.config.ts __APP_VERSION__); `typeof` guards the non-Vite context (bun
// test) — the same pattern core/report.js's RELEASE constant uses for __GIT_SHA__.
const app_version = () => (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')

/** Is there a fight trace worth offering right now? Cheap (reads the bounded in-memory ring buffer only) —
 *  the end-card row and the keybind both gate on this so neither is ever a dead affordance.
 * @returns {boolean} */
export const has_dumpable_trace = () => dump_current_trace(app_version(), Date.now()) != null

/** Dump the most recent fight's trace and trigger a browser download. No-op (returns false) when nothing was
 *  captured — never a fabricated empty file.
 * @returns {boolean} */
export function export_fight_trace() {
  const trace = dump_current_trace(app_version(), Date.now())
  if (!trace) return false
  const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' })
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
