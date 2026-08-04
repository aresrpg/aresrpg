// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// oracle/laws.js — the L1 COMPOSITION laws (issue #930), fight half.
//
// The sim half asserts what one reducer step may do. This half asserts what the two folders must
// AGREE on: "one observable, two folders" (v2/fold.js header) — the sim folds commands into a
// FightState, the core folds the receipt rows into a committed state, and both project the same
// cell/hp/alive/active/winner. sim_chain.test.js pins that for ONE scripted fight; these laws pin
// it for arbitrary generated ones, which is the whole point of the rung.
//
// The fold side runs the REAL production path, never a shortcut:
//   snapshot -> board_state_from_fight -> base_from_view -> normalize_events -> apply_action
//
// PURE + TOTAL: a breach comes back as DATA in the same `{ rule, message }` shape the sim's
// tripwires use, so a runner keeps ONE violation list.

import { replay_capsule, stable_stringify, terminal_summary } from '@aresrpg/sim/timeline'

import { board_state_from_fight } from '../../src/board_state.js'
import { base_budget, base_from_view } from '../../src/fold.js'
import { apply_action, seat_resolver } from '../../src/inputs.js'
import { decode_fight_batch as normalize_events } from '../../src/core_inbox.js'
import { capsule_of, fold_projection, sim_projection } from '../../src/sim_chain.js'

/** The core's view of the fight, built from the chain snapshot exactly as production does. */
const view_of = (snapshot) => board_state_from_fight({ fight: snapshot, version: 1 })

/** Fold one receipt into the committed state through the real normalize -> apply_action door. */
const fold_receipt = (state, receipt, version, view) =>
  normalize_events(receipt, {
    version,
    fight_id: view.id,
    resolve_seat: seat_resolver(view),
    base_of: base_budget(view),
  }).reduce(apply_action, state)

/**
 * LAW 7 — fold-replay equality: folding the emitted rows reproduces the sim's own observable at
 * EVERY batch boundary. Reported boundary by boundary, so a drift names the exact turn it entered on.
 * @param {{ snapshot: object, batches: { version:number, receipt:object, sim:object }[] }} run
 * @returns {{ rule:string, message:string }[]}
 */
export const fold_equality_violations = ({ snapshot, batches }) => {
  const view = view_of(snapshot)
  return batches.reduce(
    (acc, batch, index) => {
      const state = fold_receipt(acc.state, batch.receipt, batch.version, view)
      const folded = stable_stringify(fold_projection(state))
      const sim = stable_stringify(batch.sim)
      return {
        state,
        hits:
          folded === sim
            ? acc.hits
            : [
                ...acc.hits,
                {
                  rule: 'fold_replay_equality',
                  message: `batch ${index}: the receipt fold reads ${folded}, the sim reads ${sim}`,
                },
              ],
      }
    },
    { state: base_from_view(view, snapshot.id), hits: /** @type {{rule:string,message:string}[]} */ ([]) }
  ).hits
}

/**
 * LAW 8 — capsule round-trip: the dumped capsule replays through the authored-golden door back to
 * the same fight (its own physics sweep included).
 * @param {object} chain a driven sim chain
 * @returns {{ rule:string, message:string }[]}
 */
export const capsule_roundtrip_violations = (chain) => {
  const capsule = capsule_of(chain)
  if (capsule == null) return [{ rule: 'capsule_roundtrip', message: 'the chain dumped no capsule' }]
  const replayed = replay_capsule(JSON.parse(JSON.stringify(capsule)))
  const physics = replayed.violations.map((message) => ({ rule: 'capsule_roundtrip', message }))
  const summary =
    stable_stringify(terminal_summary(replayed.terminal)) === stable_stringify(terminal_summary(chain.sim_state))
      ? []
      : [{ rule: 'capsule_roundtrip', message: 'the replayed terminal summary differs from the driven fight' }]
  const observable =
    stable_stringify(sim_projection(replayed.terminal)) === stable_stringify(sim_projection(chain.sim_state))
      ? []
      : [{ rule: 'capsule_roundtrip', message: 'the replayed observable differs from the driven fight' }]
  return [...physics, ...summary, ...observable]
}

// ── LAW 6 — byte identity, with a verdict that says WHAT diverged and in WHICH SHAPE ─────────────
//
// ISSUE #2201. `expect(JSON.stringify(a)).toBe(JSON.stringify(b))` over a whole driven fight is a
// true law with an untriageable red: two ~100KB blobs, no section, no index, no shape. A
// determinism law is the one law that must be load-INDEPENDENT, so when it does go red the log
// itself has to discriminate the two readings, without a rerun:
//
//   TRUNCATED — the two captures have different LENGTHS. A drive's batch/command count is a pure
//               function of the seed, so a complete pair can NEVER differ in length: a length
//               mismatch is a partial capture, i.e. the HARNESS, and the comparison of the
//               remaining bytes is meaningless. It aborts here, loudly, under its own name.
//   VALUE     — same lengths, different bytes at a named path: something outside the seed reached
//               the twin's bytes. That is twin-severity, never a flake.

/** True byte identity — insertion-order sensitive, exactly what the law claims (never `stable_stringify`),
 *  and TOTAL: a chain snapshot carries u64 fields as BigInt, which raw `JSON.stringify` refuses. */
const bytes = (value) =>
  JSON.stringify(value, (_key, leaf) => (typeof leaf === 'bigint' ? `${leaf}n` : leaf)) ?? 'undefined'

const is_record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Longest values worth printing in a verdict — enough to read, short enough to stay a log line. */
const ELIDE = 240
const brief = (text) => (text.length <= ELIDE ? text : `${text.slice(0, ELIDE)}… (${text.length} bytes)`)

/**
 * Walk two values down to their FIRST divergence. Arrays of unequal length stop the walk: that IS
 * the truncation shape, and descending past it would compare misaligned rows.
 * @param {unknown} left @param {unknown} right @param {string} path
 * @returns {{ path:string, shape:'truncated'|'value', left:string, right:string } | null}
 */
const first_divergence = (left, right, path = '') => {
  if (bytes(left) === bytes(right)) return null
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length)
      return { path, shape: 'truncated', left: `${left.length} rows`, right: `${right.length} rows` }
    const index = left.findIndex((row, i) => bytes(row) !== bytes(right[i]))
    return first_divergence(left[index], right[index], `${path}[${index}]`)
  }
  if (is_record(left) && is_record(right)) {
    const key = [...new Set([...Object.keys(left), ...Object.keys(right)])].find(
      (name) => bytes(left[name]) !== bytes(right[name])
    )
    if (key != null) return first_divergence(left[key], right[key], `${path}.${key}`)
  }
  return { path, shape: 'value', left: brief(bytes(left)), right: brief(bytes(right)) }
}

/**
 * LAW 6 — two drives of one seed are byte-identical, section by section.
 * @param {Record<string, [unknown, unknown]>} sections named `[first_drive, second_drive]` pairs
 * @returns {{ rule:string, message:string }[]}
 */
export const byte_identity_violations = (sections) =>
  Object.entries(sections).flatMap(([section, [left, right]]) => {
    const hit = first_divergence(left, right, section)
    if (hit == null) return []
    const headline = hit.shape === 'truncated' ? 'TRUNCATED DRIVE' : 'VALUE DIVERGENCE'
    const tail =
      hit.shape === 'truncated'
        ? 'a complete pair cannot differ in length — the capture is partial, suspect the harness before the sim'
        : 'same lengths, different bytes — something outside the seed reached the twin'
    return [
      {
        rule: 'byte_identity',
        message: `${headline} at ${hit.path}: ${hit.left} vs ${hit.right} — ${tail}`,
      },
    ]
  })
