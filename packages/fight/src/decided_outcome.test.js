// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A9 VICTORY-UNDER-LAG — the dead-air seam (seat ruling 2026-07-19, constitution hardened): the Victory dialog
// MUST mount on CLIENT-KNOWABLE, RECEIPT-PROVEN fight-over state — never gated solely on the terminal settle read.
// Under lag A9 won the fight ON SCHEDULE (Strawman dead in 5 casts) yet the dialog never mounted >150s: the whole
// open chain (DungeonBoard terminal effect → claim → outcome_winner) reads ONLY settlement.chain_terminal, so a
// won fight whose terminal settle stalls shows NOTHING (rank-2 dead-air). RED-FIRST: the killing RECEIPT folds
// (every enemy mob dead in the COMMITTED fold — receipt-proven, intents excluded) while the terminal settle is
// delayed (no Victory action, no WON snapshot) → at HEAD `outcome_winner` is null (dialog never opens). GREEN:
// `outcome_winner` / `board_view().decided_winner` derive the fight-over from the committed kill. The REWARDS
// stay receipt-gated (chain_terminal / settlement_request UNCHANGED — a17c9fc stands): the card opens pending
// and fills when the settle receipt lands.
import { describe, test, expect } from 'bun:test'

import { create_fight_store } from './store.js'
import * as project from './project.js'
import { committed_state } from './fold.js'

const FIGHT = '0xvl'
const ME = '0xhero'
const OWNER = '0xowner'
const T0 = 1_000_000
const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const fight_object = ({ status = 1, mob = {}, deadline = T0 + 30_000 } = {}) => ({
  id: FIGHT,
  status,
  width: 20,
  height: 19,
  participants: [
    {
      owner: OWNER,
      character: ME,
      class: 'warrior',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 12,
      mp: 3,
      base_ap: 12,
      base_mp: 3,
      cell: 21,
      ready: true,
      casts_this_turn: 0,
      weapon: null,
    },
  ],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 6, max_hp: 30, cell: 45, ap: 6, mp: 3, ...mob }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [{ is_mob: false, idx: 0 }],
  turn_deadline_ms: deadline,
  placement_deadline_ms: T0 + 60_000,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

/** active solo fight: my playable turn, ONE mob at 6 HP (one killing blow away). `rooms_total` = the last room. */
const active_store = (ctx = {}) => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: ME, address: OWNER, beat_ctx: { grid_width: 20 }, rooms_total: 1, ...ctx },
    },
    T0
  )
  store.getState().input({ type: 'snapshot', fight: fight_object({ status: 1 }), version: 1 }, T0 + 100)
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 30_000 })] },
      version: 2,
    },
    T0 + 1_000
  )
  return store
}

/** the killing RECEIPT — the last mob's death is receipt-proven — but the terminal settle is DELAYED (no Victory
 *  action rides this segment, and no WON object read has adopted yet). This is the exact A9 dead-air window. */
const fold_killing_receipt = (store, version = 3) =>
  store.getState().input(
    {
      type: 'receipt',
      version,
      fight_id: FIGHT,
      receipt: {
        events: [
          ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
          ev('Hit', {
            victim_is_mob: true,
            victim_idx: 0,
            amount: 6,
            remaining_hp: 0,
            caster_is_mob: false,
            caster_idx: 0,
          }),
        ],
      },
    },
    T0 + 6_000
  )

describe('A9 — the victory dialog mounts on client-knowable fight-over (settle may lag)', () => {
  test('the killing receipt folds → the fight is receipt-provably over, yet the terminal settle has NOT armed', () => {
    const store = active_store()
    fold_killing_receipt(store)
    const s = store.getState()
    // client-knowable, RECEIPT-PROVEN: every enemy mob is dead in the COMMITTED fold (intents excluded).
    const mobs = Object.values(committed_state(s).fighters ?? {}).filter((f) => f.is_mob)
    expect(mobs.length).toBeGreaterThan(0)
    expect(mobs.every((f) => !f.alive)).toBe(true)
    // the receipt-gated settle machine is deliberately NOT armed (no Victory action / WON read) — a17c9fc stands.
    expect(project.chain_terminal_status(s)).toBe(null)
    expect(project.settlement_request(s)).toBe(null)
  })

  test('THE SEAM: outcome_winner opens the dialog from the receipt-proven kill (RED at HEAD: it is null)', () => {
    const store = active_store()
    fold_killing_receipt(store)
    // the dialog-driving gate (DungeonBoard effect → claim → outcome_winner). At HEAD it reads ONLY the settle
    // terminal → null → the won fight shows nothing. It must resolve VICTORY (0) from the client-knowable state.
    expect(project.outcome_winner(store.getState())).toBe(0)
    expect(project.board_view(store.getState()).decided_winner).toBe(0)
  })

  test('receipt-proven ONLY: an OPTIMISTIC kill (my intent) never decides the dialog (no false victory)', () => {
    const store = active_store()
    // my optimistic cast predicts the kill (source intent) — committed_state excludes it, so it must NOT decide.
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 } }, T0 + 2_000)
    // paint an optimistic Hit-to-0 as a predicted composite (still an intent — never receipt truth)
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 3,
        actions: [{ kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 }],
      },
      T0 + 2_100
    )
    const s = store.getState()
    expect(project.outcome_winner(s)).toBe(null) // optimistic prediction is NOT a decided fight-over
    expect(project.board_view(s).decided_winner).toBe(null)
  })

  test('a NON-terminal room clear (rooms remain) is NOT a terminal victory dialog — the recap path owns it', () => {
    const store = active_store({ run: { id: '0xrun', room: 1, world: '0xw' }, rooms_total: 3 })
    fold_killing_receipt(store)
    const s = store.getState()
    // every mob dead, but room 1 of 3 — decided_outcome must stay null (RewardRecap, not the terminal card).
    expect(project.outcome_winner(s)).toBe(null)
    expect(project.board_view(s).decided_winner).toBe(null)
  })

  test('the clean receipt (Victory rides the segment) still arms BOTH the terminal settle and the dialog', () => {
    const store = active_store()
    store.getState().input(
      {
        type: 'receipt',
        version: 3,
        fight_id: FIGHT,
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 6,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('Victory', {}),
          ],
        },
      },
      T0 + 6_000
    )
    const s = store.getState()
    expect(project.chain_terminal_status(s)).not.toBe(null) // settle machine armed (unchanged)
    expect(project.settlement_request(s)).not.toBe(null)
    expect(project.outcome_winner(s)).toBe(0) // dialog opens
    expect(project.board_view(s).decided_winner).toBe(0)
  })

  test('MUTUAL WIPE: every mob dead but MY seat also dead → no client-knowable victory (defers to the chain)', () => {
    const store = active_store()
    // one receipt: the last mob dies AND my own seat drops to 0 (a trap/DoT/mob-strike wipe). The chain resolves
    // defeat FIRST on a mutual wipe, so an all-mobs-dead client read must NOT paint a false victory.
    store.getState().input(
      {
        type: 'receipt',
        version: 3,
        fight_id: FIGHT,
        receipt: {
          events: [
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 6,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('Hit', {
              victim_is_mob: false,
              victim_idx: 0,
              amount: 99,
              remaining_hp: 0,
              caster_is_mob: true,
              caster_idx: 0,
            }),
          ],
        },
      },
      T0 + 6_000
    )
    const s = store.getState()
    expect(committed_state(s).fighters.p0.alive).toBe(false) // I am down
    expect(project.outcome_winner(s)).toBe(null) // no false victory — the downed-winner case defers to the settle read
    expect(project.board_view(s).decided_winner).toBe(null)
  })
})
