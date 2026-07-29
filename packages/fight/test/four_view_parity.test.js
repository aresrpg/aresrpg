// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE FOUR-VIEW CLASS GATE (#1336). A fight behaves IDENTICALLY in all four views — solo, coop, spectate,
// simulator — or it is broken. `viewer_fingerprint_parity.test.js` already proves the HEADLESS CORE is
// viewer-free; that gate stops at `ingest`, so a view re-pointed at a second fold ANYWHERE ABOVE the core —
// the store's own `recompute`, `board_view`, `engine_view` — stayed green. This gate closes that layer: ONE
// recorded event sequence is driven through the FOUR real store compositions and their projected canonical
// state must be byte-identical, step for step.
//
// WHAT A "VIEW COMPOSITION" IS. All four ship the SAME singleton store and the SAME `input()` door; they
// differ only in the `ctx` their shim supplies and in which ingresses they carry:
//   · solo      — the run store's own ctx (dungeon_run_store.refresh), receipts + journal + own intents
//   · coop      — solo PLUS the party transport's courtesy relay (a peer's committed draft, fight-stream.js)
//   · spectate  — world_fight.spectate_world_fight: spectator ctx, no address, no seat; local pushes refuse
//   · simulator — fight_shim.start's ctx (LOCAL_ADDRESS), sim receipts through the same door
// Viewer identity may select CONTROLS. It may never select TRUTH.
//
// THE IMAGE is deliberately the CHAIN-COMMITTED one, read through the projections the product renders from
// (`board_view(...).committed`, `engine_view(...).committed_*`) plus the viewer-free `fight_fingerprint`.
// Presentation legitimately differs per viewer (my own turn paints at click; a peer's paces over ~3s), so
// pacing is not compared — what every viewer must agree on is what the chain says happened.
//
// POSITIVE CONTROL ships in this file: the last test re-points one view at a SECOND fold (the store's
// presentation `recompute`, i.e. `s.fighters`, instead of the committed projections) and asserts the
// comparator goes RED. A parity gate without a demonstrated failure mode is decoration.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { board_view, engine_view } from '../src/project.js'
import { committed_truth } from '../src/store_state.js'
import { fight_fingerprint } from '../src/fingerprint.js'

// The recorded production trace, read out of the sanctioned corpus rather than transcribed: the fight id is
// evidence inside the capture, so this file locates it by shape (the chain-id gate's rule — a test that CAN
// read its evidence never hardcodes an id out of it).
const TRACES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'traces')
const TRACE_FILE = readdirSync(TRACES_DIR).find((name) => name.startsWith('trace_0x') && name.endsWith('.json'))
const trace = JSON.parse(readFileSync(join(TRACES_DIR, TRACE_FILE), 'utf8'))

/** The simulator's own owner address (fight_shim → sim_chain LOCAL_ADDRESS): every sim seat is owned by it. */
const SIM_ADDRESS = '0x51m0000000000000000000000000000000000000000000000000000000000000'

/** Patch a composition's ctx onto the session-opening `init` — the ONE message a shim is allowed to shape. */
const with_ctx = (msg, patch) => (msg.type === 'init' ? { ...msg, ctx: { ...(msg.ctx ?? {}), ...patch } } : msg)

const VIEWS = {
  solo: { map: (msg) => msg },
  coop: { map: (msg) => msg, courtesy: true },
  spectate: { map: (msg) => with_ctx(msg, { spectator: true, address: null, creator: null, my_entity_id: null }) },
  simulator: { map: (msg) => with_ctx(msg, { address: SIM_ADDRESS, creator: SIM_ADDRESS, spectator: false }) },
}

/**
 * THE CANONICAL IMAGE every view must publish — chain-committed truth, read through the SAME projections the
 * product renders from. Viewer-scoped fields (my_entity_id, controlled seats, armed spell, hand, local trap
 * ledger) are deliberately absent: those are CONTROLS, and controls are allowed to differ.
 */
const canonical_image = (s) => {
  const board = board_view(s)
  const engine = engine_view(s)
  const committed = committed_truth(s)
  return {
    fingerprint: fight_fingerprint(s.core),
    committed_fighters: Object.fromEntries(
      Object.entries(committed.fighters ?? {})
        .sort(([a], [z]) => a.localeCompare(z))
        .map(([key, f]) => [
          key,
          { cell: f.cell ?? null, hp: f.hp ?? null, alive: f.alive ?? null, ap: f.ap ?? null, mp: f.mp ?? null },
        ])
    ),
    committed_active: committed.active ?? null,
    board_status: board?.status ?? null,
    board_escrow: (board?.escrow ?? []).map((row) => row.committed),
    board_mobs: (board?.mobs ?? []).map((row) => row.committed),
    engine_fighters: [...(engine?.fighters ?? new Map()).entries()]
      .sort(([a], [z]) => String(a).localeCompare(String(z)))
      .map(([id, f]) => [
        id,
        {
          committed_health: f.committed_health,
          committed_alive: f.committed_alive,
          committed_dead: f.committed_dead,
          effects: f.effects,
        },
      ]),
    engine_active: engine?.active_entity_id ?? null,
    engine_turn_order: engine?.turn_order ?? [],
    engine_turn_ordinal: engine?.turn_ordinal ?? null,
    engine_winner: engine?.winner ?? -1,
  }
}

/**
 * Replay the recorded door messages through ONE view composition and return its canonical image sequence
 * (deduped on change — a view that folds the same fact through more inputs than another still has to publish
 * the same succession of canonical states).
 */
const replay_view = ({ map, courtesy = false }, image = canonical_image, inputs = trace.inputs) => {
  const store = create_fight_store()
  const sequence = []
  let last = null
  for (const row of inputs) {
    store.getState().input(map(row.msg), row.at)
    // COOP's extra ingress: the party transport relays a peer's committed draft into the same door as a
    // legality-gated PREDICTION. It may paint; it may never move canonical truth — that is what this asserts.
    if (courtesy && row.msg.type === 'predicted' && Array.isArray(row.msg.actions))
      store.getState().input(
        {
          type: 'courtesy',
          peer: 'courtesy-relay-probe',
          intent_id: `courtesy:${row.seq}`,
          actions: row.msg.actions,
        },
        row.at
      )
    const next = image(store.getState())
    const serialized = JSON.stringify(next)
    if (serialized === last) continue
    last = serialized
    sequence.push(next)
  }
  return sequence
}

describe('four-view class gate — one recorded fight, one fold (#1336)', () => {
  const sequences = Object.fromEntries(Object.entries(VIEWS).map(([label, view]) => [label, replay_view(view)]))

  test('the recorded sequence is a real, progressing fight (never a vacuous pass)', () => {
    const { solo } = sequences
    expect(solo.length).toBeGreaterThan(4)
    expect(new Set(solo.map((step) => step.fingerprint.hash)).size).toBeGreaterThan(2)
    // a fighter actually died in this capture — an image that never moves proves nothing about parity
    const dead_at_end = Object.values(solo.at(-1).committed_fighters).filter((f) => f.alive === false)
    expect(dead_at_end.length).toBeGreaterThan(0)
    // and HP actually moved between the first and last canonical states
    expect(JSON.stringify(solo[0].committed_fighters)).not.toBe(JSON.stringify(solo.at(-1).committed_fighters))
  })

  for (const label of ['coop', 'spectate', 'simulator'])
    test(`${label} publishes the byte-identical canonical sequence solo does`, () => {
      expect(sequences[label]).toEqual(sequences.solo)
    })

  test('POSITIVE CONTROL: re-pointing one view at a second fold turns this gate RED', () => {
    // The store's presentation `recompute` (`s.fighters`) is a DIFFERENT fold from committed truth — it layers
    // this viewer's own optimistic intents. Any view sourced from it is, by definition, a second home. The gate
    // must notice, or it is not a gate.
    const second_fold_image = (s) => ({
      ...canonical_image(s),
      committed_fighters: Object.fromEntries(
        Object.entries(s.fighters ?? {})
          .sort(([a], [z]) => a.localeCompare(z))
          .map(([key, f]) => [
            key,
            { cell: f.cell ?? null, hp: f.hp ?? null, alive: f.alive ?? null, ap: f.ap ?? null, mp: f.mp ?? null },
        ])
      ),
    })
    // TOOTH, not a second full parity sweep: committed and presentation truth first CAN diverge on the trace's
    // first non-empty `predicted` input. The 42 rows before it establish the real init/snapshot/journal context;
    // row 43 paints the optimistic fold and is the first possible red. Replaying the remaining 1264 messages
    // proved no additional failure mode, but made this positive control load-flaky at Bun's 5 s budget.
    const first_prediction = trace.inputs.findIndex(
      (row) => row.msg.type === 'predicted' && Array.isArray(row.msg.actions) && row.msg.actions.length > 0
    )
    const tooth = trace.inputs.slice(0, first_prediction + 1)
    expect(tooth).toHaveLength(43) // captured-trace bound: setup + the first divergent input, never the 1307-row tail
    expect(tooth.at(-1).msg.type).toBe('predicted') // non-vacuity: the divergence trigger is present

    const committed = replay_view(VIEWS.solo, canonical_image, tooth)
    const repointed = replay_view(VIEWS.solo, second_fold_image, tooth)
    expect(repointed).not.toEqual(committed)
  })
})
