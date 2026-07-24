// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #701 — V2 ↔ V1 COMMITTED PARITY. The v2 headless fold (`project_board`) and the OLD store's `committed_state`
// derive the observable board through the SAME `apply_action` reducer over the SAME `base_from_view` base, so fed
// the SAME input stream they must produce BYTE-EQUAL observable boards — active + per-fighter cell/hp/alive/
// turn_number (the shadow's field set, fight_v2_shadow FIGHTER_FIELDS). This is the shuffle-test idiom extended
// from a hash to full observable-board equality, driven through BOTH real pipelines exactly as the production tee
// does (fight_trace_tee.js: the OLD store commits, then its board is compared against the v2 core's).
//
// THE DEFECT this pins (RED on edge, GREEN after): v2's `adopt_snapshot` RE-ADOPTED every newer Fight OBJECT as the
// base and pruned the events it "subsumed". But the object read is a 4s-stale / possibly-torn checkpoint, and
// `base_from_view` can only DERIVE turn_number as `status===ACTIVE ? 1 : 0` — so re-adopting RESET every fighter's
// accumulated per-turn count to 1 and stranded their cells at the stale object, discarding the canonical event
// tail. The OLD store DEMOTED the object read to a bootstrap base + checkpoint (M2b #291 — "everything that guessed
// history from an object read is deleted"); the fix makes v2 bootstrap ONCE at the earliest object and fold the
// whole canonical tail on top, matching v1.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import { create_fight_store, committed_state } from '../../src/store.js'
import { empty_core_state, ingest, project_board, revive_wire } from '../../src/v2/index.js'
import { input_envelope } from '../../src/envelope.js'
import { classify_input } from '../../src/classify_input.js'

/** The observable board = exactly the shadow's field set (fight_v2_shadow.js FIGHTER_FIELDS + active). Fighters
 *  sorted by key so equality is order-stable — the "byte-equal board" the ticket names. */
const observable = (board) => ({
  active: board?.active ?? null,
  fighters: Object.fromEntries(
    Object.keys(board?.fighters ?? {})
      .sort()
      .map((key) => {
        const f = board.fighters[key]
        return [
          key,
          { cell: f.cell ?? null, hp: f.hp ?? null, alive: f.alive ?? null, turn_number: f.turn_number ?? null },
        ]
      })
  ),
})

/** Fold a `{ msg, at }` stream through BOTH pipelines — the OLD store (committed_state) and the v2 core
 *  (project_board) — the way fight_trace_tee.js's shadow does: one classify per msg, compared post-commit. Returns
 *  the per-step observable pair so a divergence names its exact step. Pure w.r.t. its inputs (fresh store + core). */
const fold_both = (stream) => {
  const store = create_fight_store()
  let v2 = empty_core_state()
  let seq = 0
  const steps = []
  for (const { msg: raw, at } of stream) {
    const msg = revive_wire(raw) // the captured trace serializes u64s as `{$bigint}`; production feeds revived data
    const now = at ?? seq
    store.getState().input(msg, now)
    v2 = ingest(
      v2,
      input_envelope({
        session_id: msg?.fight_id ?? store.getState().fight_id ?? null,
        input_seq: seq++,
        observed_at_ms: now,
        payload: classify_input(msg),
      })
    )
    steps.push({ old: observable(committed_state(store.getState())), v2: observable(project_board(v2)) })
  }
  return steps
}

const assert_parity = (stream) => {
  const steps = fold_both(stream)
  for (let i = 0; i < steps.length; i++)
    expect(steps[i].v2, `v2 project_board diverged from v1 committed_state at step ${i}`).toEqual(steps[i].old)
  return steps
}

// ── FIXTURE 1: a deterministic synthetic fight that reproduces BOTH divergence families ────────────────────────
// A bootstrap (active) snapshot, a receipt that MOVES both a mob and the player and STARTS the player's turn, then
// a 4s-STALE object re-read at a higher version whose fighter cells still show the pre-move positions. On edge, v2
// re-adopts that stale read → cells snap back (family ①) and turn_number resets 2→1 (family ②); v1 treats it as a
// checkpoint and holds the canonical fold. After the fix both agree.
const F = '0xfeed'
const CHAR = '0xa11ce'
const active_fight = (cells) => ({
  width: 12,
  height: 12,
  status: 1, // active → base_from_view derives base_turn_number 1
  participants: [{ character: CHAR, cell: String(cells.p0), hp: '70', ap: '6', mp: '3' }],
  mobs: [
    { cell: String(cells.m0), hp: '80' },
    { cell: String(cells.m1), hp: '60' },
  ],
})
const synthetic = [
  { msg: { type: 'init', fight_id: F, my_key: null, ctx: {} }, at: 1 },
  // BOOTSTRAP v100: p0@5, m0@9, m1@40 — the earliest object read, the base both pipelines fold on.
  { msg: { type: 'snapshot', fight_id: F, version: 100, fight: active_fight({ p0: 5, m0: 9, m1: 40 }) }, at: 2 },
  // RECEIPT v200: m0 walks to 30, p0's turn starts (turn 1→2), p0 walks to 7 — the canonical tail.
  {
    msg: {
      type: 'receipt',
      fight_id: F,
      version: 200,
      receipt: {
        events: [
          { type: '0x0::fight_events::MobMoved', parsedJson: { fight: F, idx: 0, to_cell: 30 } },
          {
            type: '0x0::fight_events::TurnStarted',
            parsedJson: { fight: F, is_mob: false, idx: 0, deadline_ms: 1784000000000 },
          },
          { type: '0x0::fight_events::Moved', parsedJson: { fight: F, character: CHAR, to_cell: 7 } },
        ],
      },
    },
    at: 3,
  },
  // STALE CHECKPOINT v300: a later object read that still shows the PRE-move cells (p0@5, m0@9) — the 4s-stale/torn
  // read the OLD store demotes. v1 ignores it; buggy-v2 re-adopts it and prunes the v200 tail.
  { msg: { type: 'snapshot', fight_id: F, version: 300, fight: active_fight({ p0: 5, m0: 9, m1: 40 }) }, at: 4 },
]

describe('#701 — v2 project_board ↔ v1 committed_state parity', () => {
  test('SYNTHETIC: a stale higher-version re-read must not reset turn_number or strand cells (both families)', () => {
    const steps = assert_parity(synthetic)
    // Ground the expectation: after the whole stream the canonical fold is p0@7 turn 2, m0@30 turn 1, m1@40 turn 1.
    expect(steps.at(-1).old).toEqual({
      active: 'p0',
      fighters: {
        m0: { cell: 30, hp: 80, alive: true, turn_number: 1 },
        m1: { cell: 40, hp: 60, alive: true, turn_number: 1 },
        p0: { cell: 7, hp: 70, alive: true, turn_number: 2 },
      },
    })
  })

  test('SYNTHETIC parity is deterministic (folded twice → identical)', () => {
    expect(fold_both(synthetic)).toEqual(fold_both(synthetic))
  })

  // ── FIXTURE 2: a REAL captured edge fight (trace_format-1). It re-adopts snapshots at 3 rising versions
  // (…675 → …767 → …918); on edge v2 strands turn_number at [1,1,1] while v1 accumulates [2,0,0]. ──────────────
  const TRACE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'parity', 'real_fight_trace.json')
  const trace = JSON.parse(readFileSync(TRACE, 'utf8'))
  const real_stream = trace.inputs.map((rec) => ({ msg: rec.msg, at: rec.at }))

  test('REAL TRACE: every step of a captured fight folds byte-equal through both pipelines', () => {
    const steps = assert_parity(real_stream)
    // The final committed board the fight ended on — pins the accumulated turn count the re-adopt used to erase.
    const final = steps.at(-1).old
    expect(final.fighters.p0.turn_number).toBe(2)
    expect(final.fighters.m0.turn_number).toBe(0)
    expect(final.fighters.m1.turn_number).toBe(0)
    expect(final.fighters.p0.cell).toBe(23)
  })

  test('REAL TRACE parity is deterministic (folded twice → identical)', () => {
    expect(fold_both(real_stream)).toEqual(fold_both(real_stream))
  })
})
