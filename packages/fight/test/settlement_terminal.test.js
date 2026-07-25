// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import * as project from '../src/project.js'
import { STATUS_WON } from '../src/board_state.js'
import { create_fight_store } from '../src/store.js'

const fight_id = '0xsettle-race'
const character_id = '0xhero'

const active_fight = {
  id: fight_id,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xowner',
      character: character_id,
      team: 0,
      hp: 40,
      max_hp: 40,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 20,
      ready: true,
    },
  ],
  mobs: [{ hp: 5, max_hp: 5, cell: 100 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 50_000,
}

const terminal_fight = {
  ...active_fight,
  status: 2,
  mobs: [{ ...active_fight.mobs[0], hp: 0 }],
}

const victory_event = {
  type: '0xengine::fight_events::Victory',
  parsedJson: { fight: fight_id },
}

const settlement_status = (state) =>
  typeof project.chain_terminal_status === 'function'
    ? project.chain_terminal_status(state)
    : (project.board_view(state)?.status ?? null)

describe('receipt-anchored settlement terminal', () => {
  test('optimistic terminal paints victory but does not arm settlement until the ending receipt', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: 'p0',
      ctx: { my_entity_id: character_id, rooms_total: 1 },
    })
    store.getState().input({ type: 'snapshot', fight: active_fight, version: 1 }, 1_000)

    store.getState().input({
      type: 'intent',
      version: 2,
      event_idx: 0,
      intent: { kind: 'Victory' },
    })

    expect(project.board_view(store.getState()).status, 'presentation stays prediction-first').toBe(STATUS_WON)
    expect(settlement_status(store.getState()), 'an optimistic terminal must not arm settlement').toBe(null)

    store.getState().input({
      type: 'receipt',
      version: 2,
      fight_id,
      receipt: { events: [victory_event] },
    })

    expect(settlement_status(store.getState()), 'the ending receipt arms settlement').toBe(STATUS_WON)
  })

  test('a consumed terminal request survives remount reads and only a newer confirmation re-arms it', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: 'p0',
      ctx: { my_entity_id: character_id, rooms_total: 1 },
    })
    store.getState().input({ type: 'snapshot', fight: active_fight, version: 1 }, 1_000)
    store.getState().input({
      type: 'receipt',
      version: 2,
      fight_id,
      receipt: { events: [victory_event] },
    })

    const fired = project.settlement_request(store.getState())
    expect(fired).not.toBe(null)
    store.getState().input({ type: 'settlement_request_consumed', signal: fired.signal })

    const remount_reads = []
    const unsubscribe = store.subscribe((state) => remount_reads.push(project.settlement_request(state)))
    remount_reads.push(project.settlement_request(store.getState()))
    expect(remount_reads.at(-1), 'a fresh consumer must not replay the consumed signal').toBe(null)
    expect(
      project.settlement_request(store.getState(), { include_consumed: true })?.signal,
      'the transaction coordinator can adopt the already-fired request'
    ).toBe(fired.signal)
    unsubscribe()

    store.getState().input({ type: 'settlement_attempt', signal: fired.signal })
    store.getState().input({ type: 'settlement_outcome', signal: fired.signal, verdict: 'transient' })
    expect(project.settlement_request(store.getState()), 'the refused signal stays consumed').toBe(null)
    expect(
      project.settlement_request(store.getState(), { include_consumed: true }),
      'the coordinator handoff cannot retry a refused signal'
    ).toBe(null)

    // M2b · ONE INGRESS: a newer terminal confirmation rides a Victory event through the canonical door (fresh
    // version), never a re-adopted object read — the settlement machine re-arms on the newer signal.
    store.getState().input({ type: 'receipt', version: 3, fight_id, receipt: { events: [victory_event] } })
    const rearmed = project.settlement_request(store.getState())
    expect(rearmed?.signal).not.toBe(fired.signal)
    store.getState().input({ type: 'settlement_request_consumed', signal: rearmed.signal })
    expect(project.settlement_request(store.getState()), 'the newer signal is consumed exactly once').toBe(null)
  })
})
