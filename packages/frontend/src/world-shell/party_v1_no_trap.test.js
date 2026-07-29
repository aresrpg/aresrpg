// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE NO-TRAP-STATE INVARIANT (a legacy-compat rider, lane 46b): a legacy V1 party (address-keyed
// `{ id, leader: address, members: address[] }` — the pre-republish `aresrpg::party` shape, see
// bd4ea8e:packages/frontend/src/chain/read_party.js) either resolves READABLE+LEAVABLE or degrades
// HONEST-EMPTY (no party rendered + a clean create path). NO member is ever locked in a party the client
// can't read or leave. The shipped V2 Move (packages/move/social/sources/party.move) has no V1→V2 migration
// door and the live social lineage is a fresh publish, so honest-empty IS the migration: V1 objects are inert,
// `/v1/parties` can never serve them (character-keyed projection + fail-closed membership check), and these
// tests fence the CLIENT layers — the reducer's snapshot merge and the store's mutation doors — against any
// V1-shaped frame that still reaches them (stale cache, legacy p2p party_id, corrupted read).
import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { reduce, empty_party_state, project_party_view, is_bound_member } from '@aresrpg/party/reduce'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'

const ME = '0xmy-character'
const NOW = 1_752_700_000_000

// The authentic V1 client shape: leader is an ADDRESS, members are bare address strings.
const v1_frame = () => ({
  id: '0xv1party',
  leader: '0xalice-address',
  members: ['0xalice-address', '0xbob-address'],
})

// A V1-poisoned bound state — legacy persisted/p2p-adopted membership predating the V2 cutover.
const v1_poisoned_state = () => ({
  ...empty_party_state(),
  party_id: '0xv1party',
  party: v1_frame(),
  _party_character_id: ME,
})

const snapshot = (party, state) => reduce(state, { kind: 'snapshot', basis: ME, current: ME, party, now: NOW })

// ── Reducer level: the snapshot merge is the adoption door ─────────────────────────────────────────────

test('a V1 address-keyed frame is never adopted — the client stays honest-empty with the create path open', () => {
  const { state } = snapshot(v1_frame(), empty_party_state())

  expect(state.party_id).toBe(null)
  expect(state.party).toBe(null)
  const view = project_party_view(state)
  expect(view.is_solo).toBe(true) // PartyFrame renders the solo invite card — create stays reachable
  expect(view.members).toEqual([])
})

test('a V1-poisoned bound party exits to honest-empty on the FIRST snapshot — never a stuck frame', () => {
  const poisoned = v1_poisoned_state()
  // The trap precondition: V1 members are unreadable, so every mutation door is already closed.
  expect(is_bound_member(poisoned, ME)).toBe(false)

  // Even a stale projector still sending the same V1 frame cannot keep the poisoned party bound.
  const { state, outputs } = snapshot(v1_frame(), poisoned)

  expect(state.party_id).toBe(null)
  expect(state.party).toBe(null)
  expect(state._party_character_id).toBe(null)
  expect(outputs.publish).toBe(true) // peers are told the stale party binding is gone
  expect(project_party_view(state).is_solo).toBe(true)
})

test('a V1-poisoned bound party also exits to honest-empty when /v1 (which never indexes V1) returns null', () => {
  const { state } = snapshot(null, v1_poisoned_state())

  expect(state.party_id).toBe(null)
  expect(state.party).toBe(null)
  expect(project_party_view(state).is_solo).toBe(true)
})

test('a legacy p2p party id that /v1 never confirms renders honest-empty while the latch holds — not a ghost party', () => {
  // V1 discovery rode p2p: a reloaded legacy client can adopt a party id with no /v1 row behind it.
  const adopted = reduce(empty_party_state(), {
    kind: 'receipt_patch',
    action: 'accept',
    party_id: '0xv1party',
    character_id: ME,
  }).state

  const view = project_party_view(adopted)
  expect(view.members).toEqual([]) // nothing unreadable is ever rendered
  expect(view.is_solo).toBe(true)
  expect(is_bound_member(adopted, ME)).toBe(false) // no mutation can compose a garbage PTB

  // Selection change drains the latch — the unconfirmable id cannot outlive its basis.
  const { state } = reduce(adopted, { kind: 'intent', action: 'switch_basis', to_character_id: '0xother' })
  expect(state.party_id).toBe(null)
  expect(state._awaiting_party_id).toBe(null)
})

// ── Store level: the edge refuses V1-garbage PTBs and lands honest-empty through the real refresh ──────

const action_calls = []
const read_calls = []
let active_character_id = ME
let projected_party = null

reset_auth_mock({ address: '0xwallet' })
const [{ context }, read_party, lobby, party_actions] = await Promise.all([
  import('../game/store.js'),
  import('../chain/read_party'),
  import('../p2p/lobby-room.js'),
  import('./party_actions'),
])
const spies = [
  spyOn(context, 'get_state').mockImplementation(() => ({
    selected_character_id: active_character_id,
    sui: { characters: [{ id: ME, name: 'Me', classe: 'senshi', world_id: 'world-a' }] },
  })),
  spyOn(context.events, 'on').mockImplementation(() => context.events),
  spyOn(read_party, 'get_party').mockImplementation(async (character_id) => {
    read_calls.push(character_id)
    return projected_party
  }),
  spyOn(lobby, 'sync_party_room').mockImplementation(() => {}),
  spyOn(party_actions, 'create_party').mockImplementation(async (...args) => {
    action_calls.push(['create', ...args])
    return { party_id: '0xfresh-v2-party', receipt: {} }
  }),
  spyOn(party_actions, 'join_owned_alts_to_party').mockImplementation(async () => new Map()),
  spyOn(party_actions, 'leave_party').mockImplementation(async (...args) => action_calls.push(['leave', ...args])),
  spyOn(party_actions, 'kick_from_party').mockImplementation(async (...args) => action_calls.push(['kick', ...args])),
  spyOn(party_actions, 'disband_party').mockImplementation(async (...args) => action_calls.push(['disband', ...args])),
  spyOn(party_actions, 'invite_to_party').mockImplementation(async (...args) => action_calls.push(['invite', ...args])),
]

const { use_party } = await import('./party_store.js')

afterAll(() => {
  use_party.getState()._stop_polling()
  for (const spy of spies) spy.mockRestore()
  reset_auth_mock()
})

beforeEach(() => {
  reset_auth_mock({ address: '0xwallet' })
  use_party.getState()._stop_polling()
  action_calls.length = 0
  read_calls.length = 0
  active_character_id = ME
  projected_party = null
  use_party.setState({ ...empty_party_state(), busy: false, error: null })
})

test('from a V1-poisoned store, leave/kick/disband/invite compose ZERO PTBs and the refresh they trigger lands honest-empty', async () => {
  for (const [action, args] of [
    ['leave', []],
    ['kick', ['0xbob-address']],
    ['disband', []],
    ['invite', ['0xtarget', '0xtarget-owner']],
  ]) {
    use_party.setState({ ...empty_party_state(), party_id: '0xv1party', party: v1_frame(), _party_character_id: ME })
    await use_party.getState()[action](...args)
  }
  await Promise.resolve()

  expect(action_calls).toEqual([]) // no PTB was ever composed from unreadable V1 membership
  expect(read_calls.length).toBeGreaterThan(0) // each refusal re-read the projection instead
  expect(use_party.getState().party_id).toBe(null) // honest-empty
  expect(use_party.getState().party).toBe(null)
})

test('the poll itself heals a V1-poisoned store, and the create path then opens a clean V2 party', async () => {
  use_party.setState({ ...empty_party_state(), party_id: '0xv1party', party: v1_frame(), _party_character_id: ME })

  projected_party = v1_frame() // even a stale reader still yielding the V1 shape cannot re-trap
  await use_party.getState().refresh()
  expect(use_party.getState().party_id).toBe(null)
  expect(use_party.getState().party).toBe(null)

  await use_party.getState().create()
  use_party.getState()._stop_polling()
  expect(action_calls.map(([name]) => name)).toEqual(['create'])
  expect(use_party.getState().party_id).toBe('0xfresh-v2-party') // the clean V2 create path
  expect(use_party.getState().party.members).toEqual([{ character: ME, owner: '0xwallet', order: 0 }])
})
