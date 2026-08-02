// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ROW #2008 RED — the invite CARRIER. The leader's `party::invite` lands on chain and emits ZERO events (driven
// proof: digest B4m8vYhVPD5BVp1apg2XfCFeMiEJY5aerMiEkNvSCyB2); the invitee sampled `incoming_invite` null for 115s
// because nothing carried the pending row to it. The carrier is the AUTHORITATIVE pending-invites read folded on
// the store's EXISTING 4s poll tick, into the reducer's EXISTING `event:'invite'` door — no new clock, no P2P.
import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { use_toast } from '../../src/toast'

const invited = { id: '0xinvitee', name: 'Invitee', classe: 'senshi', world_id: 'world-a' }
const other = { id: '0xother', name: 'Other', classe: 'shugo', world_id: 'world-a' }
const PARTY = '0xparty'
const LEADER = '0xleader'

const action_calls = []
const invite_reads = []
let active_character_id = invited.id
let roster = [invited]
let projected_party = null
let projected_invites = []

reset_auth_mock({ address: '0xinvitee-wallet' })
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
    sui: { characters: roster },
  })),
  spyOn(read_party, 'get_party').mockImplementation(async () => projected_party),
  spyOn(read_party, 'get_party_invites').mockImplementation(async (character_id) => {
    invite_reads.push(character_id)
    return projected_invites
  }),
  spyOn(lobby_room, 'set_room_party').mockImplementation(() => {}),
  spyOn(lobby_room, 'publish_room_state').mockImplementation(() => {}),
  spyOn(core_toast, 'push_event_toast').mockImplementation(() => {}),
  spyOn(use_dungeon, 'getState').mockImplementation(() => ({ dungeon_id: null })),
  spyOn(use_dungeon, 'subscribe').mockImplementation(() => () => {}),
  spyOn(party_actions, 'decline_party_invite').mockImplementation(async (...args) =>
    action_calls.push(['decline', ...args])
  ),
  // The canonical name path (#328): the card's inviter name is resolved from the `/v1` character doc, never a
  // P2P alias and never a hand-rolled address slice.
  spyOn(character_name_resolve, 'resolve_character_docs').mockImplementation(
    async (ids) => new Map(ids.filter(Boolean).map((id) => [id, { id, name: id === LEADER ? 'Leader' : 'Someone' }]))
  ),
]

const { use_party } = await import('../../src/world-shell/party_store.js')

afterAll(() => {
  use_party.getState()._stop_polling()
  for (const spy of spies) spy.mockRestore()
  reset_auth_mock()
})

beforeEach(() => {
  reset_auth_mock({ address: '0xinvitee-wallet' })
  use_party.getState()._stop_polling()
  use_party.getState().reset_local()
  use_party.getState()._stop_polling()
  action_calls.length = 0
  invite_reads.length = 0
  active_character_id = invited.id
  roster = [invited]
  projected_party = null
  projected_invites = []
  use_toast.setState({ toasts: [] })
})

test('the poll tick carries an authoritative pending invite into incoming_invite (the drive-proven dead hop)', async () => {
  // Before the carrier: the chain holds the pending row, the invitee polls, and nothing ever populates the door.
  await use_party.getState().refresh()
  expect(use_party.getState().incoming_invite).toBe(null)

  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  await use_party.getState().refresh()

  expect(invite_reads).toEqual([invited.id, invited.id])
  expect(use_party.getState().incoming_invite).toEqual({
    party_id: PARTY,
    invited_character_id: invited.id,
    from_name: 'Leader',
  })
})

test('the pending read rides the SAME poll door as the party snapshot — one tick, no second clock', async () => {
  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  await use_party.getState().refresh()
  expect(invite_reads).toEqual([invited.id])
  expect(use_party.getState()._poll_timer).toBe(null)
})

test('an invite for a character that is not the selected one never binds (basis fence, reduce.js switch_basis)', async () => {
  // The read is issued for the SELECTED character only, and a result that lands after the selection moved is
  // dropped rather than bound — the same fence the party snapshot rides.
  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  active_character_id = other.id
  roster = [other]
  await use_party.getState().refresh()
  expect(invite_reads).toEqual([other.id])
  expect(use_party.getState().incoming_invite).toEqual({
    party_id: PARTY,
    invited_character_id: other.id,
    from_name: 'Leader',
  })

  // Selection moves back to the invitee: the card bound to `other` is dropped, never re-shown for the new basis.
  active_character_id = invited.id
  roster = [invited]
  use_party.getState()._clear_character_mismatch(invited.id)
  expect(use_party.getState().incoming_invite).toBe(null)
})

test('a signed decline is not re-shown by the lagging projection, and the latch drains itself', async () => {
  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  await use_party.getState().refresh()
  expect(use_party.getState().incoming_invite).not.toBe(null)

  await use_party.getState().decline_invite()
  expect(action_calls).toEqual([['decline', PARTY, invited.id]])
  expect(use_party.getState().incoming_invite).toBe(null)

  // The projector has not caught up yet — the same row comes back on the next tick and must NOT resurrect the card.
  await use_party.getState().refresh()
  expect(use_party.getState().incoming_invite).toBe(null)

  // Once the projection drops the row the latch drains, so a genuinely NEW invite to the same party still lands.
  projected_invites = []
  await use_party.getState().refresh()
  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  await use_party.getState().refresh()
  expect(use_party.getState().incoming_invite).toEqual({
    party_id: PARTY,
    invited_character_id: invited.id,
    from_name: 'Leader',
  })
})

test('the party we are already bound to never re-arms its own invite card after accept', async () => {
  projected_party = {
    id: PARTY,
    leader_character: LEADER,
    members: [
      { character: LEADER, owner: '0xleader-wallet', order: 0 },
      { character: invited.id, owner: '0xinvitee-wallet', order: 1 },
    ],
  }
  // A stale pending row for the party we just joined (the projector's two watermarks can disagree for a tick).
  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  await use_party.getState().refresh()

  expect(use_party.getState().party_id).toBe(PARTY)
  expect(use_party.getState().incoming_invite).toBe(null)
})

test('a read failure on the pending dimension never costs the party snapshot', async () => {
  projected_party = {
    id: PARTY,
    leader_character: LEADER,
    members: [{ character: invited.id, owner: '0xinvitee-wallet', order: 0 }],
  }
  const failing = spyOn(read_party, 'get_party_invites').mockImplementation(async () => {
    throw new Error('rpc down')
  })
  await use_party.getState().refresh()
  expect(use_party.getState().party_id).toBe(PARTY)
  failing.mockRestore()
})

test('a refusal held by one character is not drained by another character poll tick', async () => {
  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  await use_party.getState().refresh()
  await use_party.getState().decline_invite()
  expect(use_party.getState().incoming_invite).toBe(null)

  // A poll for a DIFFERENT selected character is no evidence about the refusal the invitee is still holding.
  active_character_id = other.id
  roster = [other]
  projected_invites = []
  await use_party.getState().refresh()

  active_character_id = invited.id
  roster = [invited]
  projected_invites = [{ party: PARTY, leader_character: LEADER }]
  await use_party.getState().refresh()
  expect(use_party.getState().incoming_invite).toBe(null)
})
