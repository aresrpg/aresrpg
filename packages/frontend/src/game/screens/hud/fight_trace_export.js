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

import { fight_store } from '@aresrpg/fight/store'
import { stringify_trace } from '@aresrpg/fight/trace_tap'

import { download_text_file } from '../../../utils/download_file.js'

// Vite injects this build-wide (vite.config.ts __APP_VERSION__); `typeof` guards the non-Vite context (bun
// test) — the same pattern core/report.js's RELEASE constant uses for __GIT_SHA__.
const app_version = () => (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')

/** Is there a fight trace worth offering right now? Cheap (reads the bounded in-memory ring buffer only) —
 *  gates the end-card export button's ENABLED state (FightReport.jsx) so it is never a dead click.
 * @returns {boolean} */
export const current_fight_trace = () => fight_store.trace_tap.dump_current_trace(app_version(), Date.now())

export const has_dumpable_trace = () => current_fight_trace() != null

/** Dump the most recent fight's trace and trigger a browser download. No-op (returns false) when nothing was
 *  captured — never a fabricated empty file.
 * @param {ReturnType<typeof current_fight_trace>} [trace]
 * @returns {boolean} */
export function export_fight_trace(trace = current_fight_trace()) {
  if (!trace) return false
  // BigInt-safe: decode_fight()'s chain u64 fields (world_seed, shape_mask, …) ride a 'snapshot' input's
  // msg.fight verbatim — a bare JSON.stringify throws the instant the walk reaches one (trace_recorder.js).
  download_text_file(`aresrpg-fight-trace-${trace.fight_id}-${trace.captured_at}.json`, stringify_trace(trace, 2))
  return true
}
