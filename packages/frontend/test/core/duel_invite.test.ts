// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE INVITATION IS A DERIVATION (2026-08-22). A duel's side B is reserved on chain for the
// challenged character, so the fight row already streaming to everyone nearby carries the
// invitation in `opener_b`. Nothing is received, nothing expires, nothing is matched by
// position — the previous handshake did all three and lost every duel to a coordinate bug.

import { describe, expect, test } from 'bun:test'

import { duel_accept_was_canceled, duels_awaiting } from '../../src/modules/duel.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

const fold = (state: AppState, ...inputs: readonly AppInput[]): AppState =>
  inputs.reduce((folded, input) => reduce_app_state(folded, input), state)

const born = (id: string, opener_b: string | null, phase = 'placement'): AppInput => ({
  type: 'server/packet',
  packet: {
    type: 'packet/fight_created',
    fight: {
      id,
      world: 'w',
      x: 50_000,
      z: 50_000,
      phase,
      access_a: 1,
      access_b: opener_b ? 2 : 255,
      opener_a: '0xhim',
      opener_b,
      managed: false,
      wagered: false,
      placement_ms: '0',
    },
  } as never,
})

const playing =
  (character_id: string) =>
  (state: AppState): AppState =>
    Object.freeze({ ...state, session: Object.freeze({ ...state.session, selected_character_id: character_id }) })

describe('the duel invitation', () => {
  const base = fold(playing('0xme')(initial_app_state(settings)), {
    type: 'server/packet',
    packet: { type: 'packet/tracked_zones', character_id: '0xme', world: 'w', zones: [{ zx: 97, zz: 97 }] },
  })

  test('a fight reserving OUR character is an invitation', () => {
    const state = fold(base, born('0xf1', '0xme'))
    expect(duels_awaiting(state).map(({ id }) => id)).toEqual(['0xf1'])
  })

  test("someone else's duel standing next to us is scenery", () => {
    // the position-anchored predecessor matched exactly this fight and joined the wrong one
    const state = fold(base, born('0xf1', '0xsomeone'), born('0xf2', null))
    expect(duels_awaiting(state)).toEqual([])
  })

  test('an invitation to a fight that already started is not an invitation', () => {
    const state = fold(base, born('0xf1', '0xme', 'active'))
    expect(duels_awaiting(state)).toEqual([])
  })

  test('a fight that ended leaves no invitation behind', () => {
    const state = fold(base, born('0xf1', '0xme'), {
      type: 'server/packet',
      packet: { type: 'packet/fight_phase', fight: '0xf1', phase: 'ended' } as never,
    })
    expect(duels_awaiting(state)).toEqual([])
  })

  test('playing no character means no invitation can name us', () => {
    const state = fold(initial_app_state(settings), born('0xf1', '0xme'))
    expect(duels_awaiting(state)).toEqual([])
  })
})

test('only a join placement abort classifies the accept race as a canceled duel', () => {
  expect(
    duel_accept_was_canceled(
      new Error("MoveAbort in 2nd command, abort code: 1706, in '0xgame::fight::jg' (instruction 7)")
    )
  ).toBeTrue()
  expect(duel_accept_was_canceled(new Error("abort code: 1706, in '0xgame::fight::aa'"))).toBeFalse()
  expect(duel_accept_was_canceled(new Error("abort code: 1724, in '0xgame::fight::jg'"))).toBeFalse()
})
