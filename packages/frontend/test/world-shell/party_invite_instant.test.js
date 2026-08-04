// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2159 (owner ruling) — ACCEPTING AN INVITE DISMISSES THE POPUP INSTANTLY AT CLICK. The accept intent enters the
// reducer, the card dies, the transaction executes behind it. RED-first, for the reported reason: the popup used
// to be held hostage to execution latency (`busy` + `await accept_party_invite(...)` before the clear), so the
// invited player stared at an answered question for the whole round trip.
//
// The three facts this file pins:
//   ① the card is gone BEFORE the transaction settles (measured against a transaction that never resolves);
//   ② a poll tick landing mid-flight cannot resurrect the answered question;
//   ③ an EXECUTED failure resurfaces the question honestly, with its reason, and is never re-fired.

import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import i18n from '../../src/i18n'

const action_calls = []
const toasts = []
const selected = { id: '0xinvited', name: 'Invited', classe: 'senshi', world_id: 'world-a' }
const PARTY = '0xparty'
let active_character_id = selected.id
let accept_impl = async () => {}
let pending_invite_rows = []

reset_auth_mock({ address: '0xwallet' })
const [{ context }, read_party, lobby_room, core_toast, { use_dungeon }, party_actions, character_name_resolve] =
  await Promise.all([
    import('../../src/game/store.js'),
    import('../../src/chain/read_party'),
    import('../../src/p2p/lobby-room.js'),
    import('../../src/game/core/toast.js'),
    import('../../src/world-shell/dungeon_store.js'),
    import('../../src/world-shell/party_actions'),
    import('../../src/world-shell/character_name_resolve.js'),
  ])

const spies = [
  spyOn(context, 'get_state').mockImplementation(() => ({
    selected_character_id: active_character_id,
    sui: { characters: [selected] },
  })),
  spyOn(read_party, 'get_party').mockImplementation(async () => null),
  spyOn(read_party, 'get_party_invites').mockImplementation(async () => pending_invite_rows),
  spyOn(lobby_room, 'set_room_party').mockImplementation(() => {}),
  spyOn(lobby_room, 'publish_room_state').mockImplementation(() => {}),
  spyOn(core_toast, 'push_event_toast').mockImplementation((toast) => toasts.push(toast)),
  spyOn(use_dungeon, 'getState').mockImplementation(() => ({ dungeon_id: null })),
  spyOn(use_dungeon, 'subscribe').mockImplementation(() => () => {}),
  spyOn(party_actions, 'accept_party_invite').mockImplementation(async (...args) => {
    action_calls.push(['accept', ...args])
    return accept_impl()
  }),
  spyOn(party_actions, 'decline_party_invite').mockImplementation(async (...args) =>
    action_calls.push(['decline', ...args])
  ),
  spyOn(character_name_resolve, 'resolve_character_name').mockImplementation(async () => 'Leader'),
]

const { use_party } = await import('../../src/world-shell/party_store.js')

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const invite_card = () => use_party.getState().incoming_invite

afterAll(() => {
  use_party.getState()._stop_polling()
  for (const spy of spies) spy.mockRestore()
  reset_auth_mock()
})

beforeEach(() => {
  reset_auth_mock({ address: '0xwallet' })
  use_party.getState()._stop_polling()
  action_calls.length = 0
  toasts.length = 0
  active_character_id = selected.id
  accept_impl = async () => {}
  pending_invite_rows = []
  use_party.getState().reset_local()
  use_party.getState()._stop_polling()
  use_party.setState({
    incoming_invite: { party_id: PARTY, invited_character_id: selected.id, from_name: 'Leader' },
  })
})

test('the popup dies AT THE CLICK — never held for the accept transaction', async () => {
  // A transaction that never settles: anything the popup's dismissal depends on inside it would hang here.
  accept_impl = () => new Promise(() => {})

  const in_flight = use_party.getState().accept_invite()

  expect(invite_card()).toBe(null) // ① the answered question is gone before a single await resolved
  expect(action_calls).toEqual([['accept', PARTY, selected.id]]) // and the transaction did go out behind it
  expect(in_flight).toBeInstanceOf(Promise)
})

test('a poll tick mid-transaction cannot resurrect the answered question', async () => {
  accept_impl = () => new Promise(() => {})
  pending_invite_rows = [{ party: PARTY, leader_character: '0xleader' }] // the chain still lists it: the tx is in flight

  void use_party.getState().accept_invite()
  expect(invite_card()).toBe(null)

  await use_party.getState()._fold_pending_invites(selected.id) // ② the exact read the 4s poll performs
  expect(invite_card()).toBe(null)
})

test('an EXECUTED failure resurfaces the question honestly, with its reason, and re-fires nothing', async () => {
  accept_impl = async () => {
    throw new Error('accept failed on-chain')
  }
  pending_invite_rows = [{ party: PARTY, leader_character: '0xleader' }]

  await use_party.getState().accept_invite()
  await flush()

  // ③ the card is BACK — same party, same character, same inviter name — and the reason is said out loud.
  expect(invite_card()).toEqual({ party_id: PARTY, invited_character_id: selected.id, from_name: 'Leader' })
  expect(use_party.getState().error).toBeTruthy()
  expect(toasts).toEqual([{ state: 'error', title: i18n.t('party.answer_failed_title'), message: expect.any(String) }])
  // NEVER auto-retried (the tx-retry burn law): exactly one accept was ever composed.
  expect(action_calls).toEqual([['accept', PARTY, selected.id]])
  expect(use_party.getState().busy).toBe(false)

  // …and the poll may carry the still-pending invitation again, because the answer was released.
  use_party.setState({ incoming_invite: null })
  await use_party.getState()._fold_pending_invites(selected.id)
  expect(invite_card()?.party_id).toBe(PARTY)
})

test('decline dismisses at the click too — the same answer, the same law', async () => {
  const in_flight = use_party.getState().decline_invite()
  expect(invite_card()).toBe(null)
  await in_flight
  expect(action_calls).toEqual([['decline', PARTY, selected.id]])
})

test('a character cannot answer another character cached invitation', async () => {
  active_character_id = '0xsomeone-else'
  await use_party.getState().accept_invite()
  expect(action_calls).toEqual([]) // no transaction for a card that is not mine
  expect(invite_card()).toBe(null) // the stale card is dropped all the same
})
