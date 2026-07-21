// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character-keyed party store consent and six-slot invariants.
import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import i18n from '../i18n'
import { use_toast } from '../toast'

import { attach_executed_digest } from './tx_digest_error.js'

const action_calls = []
const read_calls = []
const published = []
const synced = []
const event_names = []
const selected = { id: '0xinvited', name: 'Invited', classe: 'senshi', world_id: 'world-a' }
const owned_alt = { id: '0xowned-alt', name: 'Alt', classe: 'shugo', world_id: 'world-a' }
let active_character_id = selected.id
let roster = [selected]
let projected_party
let read_party_impl
let resolve_docs_impl
const party = {
  id: '0xparty',
  leader_character: '0xleader',
  members: [
    { character: '0xleader', owner: '0xleader-owner', order: 0 },
    { character: selected.id, owner: '0xwallet', order: 1 },
  ],
}

reset_auth_mock({ address: '0xwallet' })
const [{ context }, read_party, lobby_room, core_toast, { use_dungeon }, party_actions, character_name_resolve] =
  await Promise.all([
    import('../game/store.js'),
    import('../chain/read_party'),
    import('../p2p/lobby-room'),
    import('../game/core/toast.js'),
    import('./dungeon_store.js'),
    import('./party_actions'),
    import('./character_name_resolve.js'),
  ])
const spies = [
  spyOn(context, 'get_state').mockImplementation(() => ({
    selected_character_id: active_character_id,
    sui: { characters: roster },
  })),
  spyOn(context.events, 'on').mockImplementation((name) => {
    event_names.push(name)
    return context.events
  }),
  spyOn(read_party, 'get_party').mockImplementation(async (character_id) => {
    read_calls.push(character_id)
    return read_party_impl(character_id)
  }),
  spyOn(lobby_room, 'broadcast_state').mockImplementation((state) => published.push(state)),
  spyOn(lobby_room, 'nudge_party_invite').mockImplementation(() => {}),
  spyOn(lobby_room, 'get_peer_state').mockImplementation(() => null),
  spyOn(lobby_room, 'sync_party_room').mockImplementation((party_id) => synced.push(party_id)),
  spyOn(core_toast, 'push_event_toast').mockImplementation(() => {}),
  spyOn(use_dungeon, 'getState').mockImplementation(() => ({ dungeon_id: null })),
  spyOn(use_dungeon, 'subscribe').mockImplementation(() => () => {}),
  spyOn(party_actions, 'create_party').mockImplementation(async (...args) => action_calls.push(['create', ...args])),
  spyOn(party_actions, 'invite_to_party').mockImplementation(async (...args) => action_calls.push(['invite', ...args])),
  spyOn(party_actions, 'join_owned_alts_to_party').mockImplementation(async (...args) => {
    action_calls.push(['join-owned', ...args])
    for (const character_id of args[0].invited_character_ids ?? []) await args[0].on_joined?.(character_id, {})
  }),
  spyOn(party_actions, 'accept_party_invite').mockImplementation(async (...args) =>
    action_calls.push(['accept', ...args])
  ),
  spyOn(party_actions, 'decline_party_invite').mockImplementation(async (...args) =>
    action_calls.push(['decline', ...args])
  ),
  spyOn(party_actions, 'kick_from_party').mockImplementation(async (...args) => action_calls.push(['kick', ...args])),
  spyOn(party_actions, 'leave_party').mockImplementation(async (...args) => action_calls.push(['leave', ...args])),
  spyOn(party_actions, 'disband_party').mockImplementation(async (...args) => action_calls.push(['disband', ...args])),
  spyOn(character_name_resolve, 'resolve_character_docs').mockImplementation((ids) => resolve_docs_impl(ids)),
]

const { use_party, wire_party_p2p } = await import('./party_store.js')

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
  published.length = 0
  synced.length = 0
  active_character_id = selected.id
  roster = [selected]
  projected_party = party
  read_party_impl = async () => projected_party
  resolve_docs_impl = async () => new Map()
  use_toast.setState({ toasts: [] })
  use_party.getState()._pending_invite_toast_ids.clear()
  use_party.setState({
    party_id: null,
    party: null,
    incoming_invite: null,
    pending_invites: [],
    busy: false,
    error: null,
    _awaiting_party_id: null,
    _awaiting_character_id: null,
    _party_character_id: null,
    _departed: null,
    _owned_join_blocked_ids: [],
  })
})

test('the active leader adds same-world owned roster characters as distinct confirmed party members', async () => {
  roster = [selected, owned_alt]
  use_party.setState({
    party_id: party.id,
    party: {
      id: party.id,
      leader_character: selected.id,
      members: [{ character: selected.id, owner: '0xwallet', order: 0 }],
    },
    _party_character_id: selected.id,
  })

  expect(await use_party.getState().join_owned()).toBe(true)
  expect(action_calls).toEqual([
    [
      'join-owned',
      {
        party_id: party.id,
        leader_character_id: selected.id,
        invited_character_ids: [owned_alt.id],
        invited_names: { [owned_alt.id]: owned_alt.name },
        on_joined: expect.any(Function),
      },
    ],
  ])
  expect(use_party.getState().party.members.map((member) => member.character)).toEqual([selected.id, owned_alt.id])
})

test('accept signs for invited_character_id, then reads the selected-character party projection', async () => {
  use_party.setState({
    incoming_invite: { party_id: party.id, invited_character_id: selected.id, from_name: 'Leader' },
  })
  await use_party.getState().accept_invite()

  expect(action_calls).toEqual([['accept', party.id, selected.id]])
  expect(read_calls).toEqual([selected.id])
  expect(use_party.getState().party).toEqual(party)
  expect(use_party.getState().incoming_invite).toBe(null)
  use_party.getState()._stop_polling()
})

test('decline is its own signed action and never uses leave/adopt', async () => {
  use_party.setState({
    incoming_invite: { party_id: party.id, invited_character_id: selected.id, from_name: 'Leader' },
  })
  await use_party.getState().decline_invite()

  expect(action_calls).toEqual([['decline', party.id, selected.id]])
  expect(read_calls).toEqual([])
  expect(use_party.getState().party_id).toBe(null)
  expect(use_party.getState().incoming_invite).toBe(null)
})

test('character B cannot accept or decline character A cached invitation', async () => {
  active_character_id = '0xcharacter-b'
  const stale_invite = { party_id: party.id, invited_character_id: selected.id, from_name: 'Leader' }

  use_party.setState({ incoming_invite: stale_invite })
  await use_party.getState().accept_invite()
  expect(use_party.getState().incoming_invite).toBe(null)
  use_party.setState({ incoming_invite: stale_invite })
  await use_party.getState().decline_invite()

  expect(action_calls).toEqual([])
  expect(use_party.getState().incoming_invite).toBe(null)
})

test('six accepted characters is a local hard stop before an invite PTB', async () => {
  use_party.setState({
    party_id: party.id,
    party: {
      ...party,
      leader_character: selected.id,
      members: Array.from({ length: 6 }, (_, order) => ({
        character: order === 0 ? selected.id : `0xchar-${order}`,
        owner: `0xowner-${order}`,
        order,
      })),
    },
    _party_character_id: selected.id,
  })
  await use_party.getState().invite('0xseventh', '0xowner-seven')

  expect(action_calls).toEqual([])
  expect(use_party.getState().error).toBe(i18n.t('errors.party_full'))
})

test('a non-leader member cannot compose an invite', async () => {
  use_party.setState({ party_id: party.id, party, _party_character_id: selected.id })
  await use_party.getState().invite('0xtarget', '0xtarget-owner')

  expect(action_calls).toEqual([])
})

// ── REQUIREMENT: a loading toast shows until the invite is accepted or refused, with a cancel button ────────────────────────
test('invite() arms a persistent pending toast carrying the resolved invitee name + a cancel action', async () => {
  resolve_docs_impl = async (ids) => new Map(ids.map((id) => [id, { id, name: 'Ares' }]))
  use_party.setState({
    party_id: party.id,
    party: { ...party, leader_character: selected.id, members: [party.members[1]] }, // solo leader, room to invite
    _party_character_id: selected.id,
  })

  await use_party.getState().invite('0xtarget', '0xtarget-owner')

  expect(action_calls).toEqual([['invite', party.id, selected.id, '0xtarget', '0xtarget-owner', 'Ares']])
  expect(use_party.getState().pending_invites).toEqual([
    { party_id: party.id, invited_character_id: '0xtarget', invited_name: 'Ares', deadline: expect.any(Number) },
  ])
  const toast = use_toast.getState().toasts.at(-1)
  expect(toast.type).toBe('pending')
  expect(toast.persistent).toBe(true)
  expect(toast.message).toBe(i18n.t('party.invite_awaiting_toast', { name: 'Ares' }))
  expect(toast.action.label).toBe(i18n.t('party.cancel_invite_cta'))

  // Re-inviting the SAME still-pending character is a silent no-op — never a duplicate toast or a doomed re-fire.
  await use_party.getState().invite('0xtarget', '0xtarget-owner')
  expect(action_calls).toHaveLength(1)
  expect(use_toast.getState().toasts).toHaveLength(1)
})

// ── #328: the initiating UI (PlayerActionMenu, a friend row, a party-member row) already carries the
// invitee's resolved display name — invite() must thread it straight through and skip the network resolve
// entirely (zero added latency ahead of the wallet prompt), never wait on/overwrite it with the async lookup. ──
test('invite() prefers a caller-supplied name over the network resolve — zero resolve calls on that path', async () => {
  let resolve_calls = 0
  resolve_docs_impl = async (ids) => {
    resolve_calls++
    return new Map(ids.map((id) => [id, { id, name: 'NetworkName' }]))
  }
  use_party.setState({
    party_id: party.id,
    party: { ...party, leader_character: selected.id, members: [party.members[1]] },
    _party_character_id: selected.id,
  })

  await use_party.getState().invite('0xtarget', '0xtarget-owner', 'CallerName')

  expect(action_calls).toEqual([['invite', party.id, selected.id, '0xtarget', '0xtarget-owner', 'CallerName']])
  expect(resolve_calls).toBe(0) // the caller already had the name — no round-trip needed
  expect(use_party.getState().pending_invites).toEqual([
    { party_id: party.id, invited_character_id: '0xtarget', invited_name: 'CallerName', deadline: expect.any(Number) },
  ])
})

// ── #328: a member appearing in a fresh snapshot (accepted our invite / joined via another surface) is
// announced by NAME — never a raw address/id slice. ──
test('a fresh member appearing in the snapshot announces by NAME, not a raw address slice', async () => {
  resolve_docs_impl = async (ids) => new Map(ids.map((id) => [id, { id, name: 'Ares' }]))
  use_party.setState({
    party_id: party.id,
    party: { ...party, leader_character: selected.id, members: [party.members[1]] },
    _party_character_id: selected.id,
  })
  core_toast.push_event_toast.mockClear()

  projected_party = {
    ...party,
    leader_character: selected.id,
    members: [party.members[1], { character: '0xnew-member', owner: '0xnew-owner', order: 1 }],
  }
  await use_party.getState().refresh()
  await Promise.resolve() // let the fire-and-forget name announcement settle

  expect(core_toast.push_event_toast).toHaveBeenCalledWith({
    state: 'success',
    title: i18n.t('party.member_joined_toast', { name: 'Ares' }),
  })
})

test('the pending toast is dismissed the moment a fresh snapshot shows the invitee joined', async () => {
  resolve_docs_impl = async (ids) => new Map(ids.map((id) => [id, { id, name: 'Ares' }]))
  use_party.setState({
    party_id: party.id,
    party: { ...party, leader_character: selected.id, members: [party.members[1]] },
    _party_character_id: selected.id,
  })
  await use_party.getState().invite('0xtarget', '0xtarget-owner')
  const toast_id = use_toast.getState().toasts.at(-1).id

  projected_party = {
    ...party,
    leader_character: selected.id,
    members: [party.members[1], { character: '0xtarget', owner: '0xtarget-owner', order: 1 }],
  }
  await use_party.getState().refresh()

  expect(use_party.getState().pending_invites).toEqual([])
  expect(use_toast.getState().toasts.find((t) => t.id === toast_id)).toBeUndefined()
})

test('cancel_invite() dismisses the toast LOCALLY — no PTB, the invite stays recorded on-chain', async () => {
  resolve_docs_impl = async (ids) => new Map(ids.map((id) => [id, { id, name: 'Ares' }]))
  use_party.setState({
    party_id: party.id,
    party: { ...party, leader_character: selected.id, members: [party.members[1]] },
    _party_character_id: selected.id,
  })
  await use_party.getState().invite('0xtarget', '0xtarget-owner')
  const pending_toast_id = use_toast.getState().toasts.at(-1).id

  use_party.getState().cancel_invite('0xtarget')

  expect(use_party.getState().pending_invites).toEqual([])
  expect(use_toast.getState().toasts.find((t) => t.id === pending_toast_id)).toBeUndefined() // the loading toast is gone
  expect(use_toast.getState().toasts.at(-1)?.message).toBe(i18n.t('party.invite_cancel_notice')) // honest on-chain notice
  expect(action_calls.filter((call) => call[0] === 'invite')).toHaveLength(1) // no 2nd tx — never a revoke PTB
})

test('character switch clears A binding, publishes null, and denies every A mutation for B', async () => {
  const stale = () =>
    use_party.setState({
      party_id: party.id,
      party,
      _party_character_id: selected.id,
      _awaiting_party_id: null,
      _awaiting_character_id: null,
    })
  active_character_id = '0xcharacter-b'
  projected_party = null

  stale()
  use_party.getState()._publish_state({ id: active_character_id, name: 'B', classe: 'senshi' })
  expect(synced.at(-1)).toBe(null)
  expect(published.at(-1)?.party_id).toBe(null)
  expect(use_party.getState().party_id).toBe(null)

  for (const [action, args] of [
    ['invite', ['0xtarget', '0xtarget-owner']],
    ['kick', ['0xtarget']],
    ['leave', []],
    ['disband', []],
  ]) {
    stale()
    await use_party.getState()[action](...args)
  }
  expect(action_calls).toEqual([])
})

test('an already-wired remount restarts projection polling without duplicate listeners', async () => {
  event_names.length = 0
  wire_party_p2p()
  await Promise.resolve()
  use_party.getState()._stop_polling()
  const listeners_after_first_wire = [...event_names]
  const reads_after_first_wire = read_calls.length

  wire_party_p2p()
  await Promise.resolve()
  use_party.getState()._stop_polling()

  expect(event_names).toEqual(listeners_after_first_wire)
  expect(read_calls.length).toBeGreaterThan(reads_after_first_wire)
})

test('an in-flight A projection cannot bind after selection changes to B', async () => {
  let resolve_a
  read_party_impl = (character_id) =>
    character_id === selected.id
      ? new Promise((resolve) => {
          resolve_a = resolve
        })
      : Promise.resolve(null)

  const refreshing_a = use_party.getState().refresh()
  await Promise.resolve()
  active_character_id = '0xcharacter-b'
  resolve_a(party)
  await refreshing_a
  await Promise.resolve()

  expect(read_calls).toEqual([selected.id, active_character_id])
  expect(use_party.getState().party).toBe(null)
  expect(use_party.getState()._party_character_id).toBe(null)
})

test('leave latches the departed party — a stale poll frame still listing the player is refused, not re-adopted (audit row 4)', async () => {
  use_party.setState({ party_id: party.id, party, _party_character_id: selected.id })
  projected_party = party // the indexer has not dropped the leaving character yet

  await use_party.getState().leave()

  expect(action_calls).toEqual([['leave', party.id, selected.id]])
  expect(use_party.getState().party_id).toBe(null)
  expect(use_party.getState().party).toBe(null)
  expect(use_party.getState()._departed).toEqual({
    party_id: party.id,
    character_id: selected.id,
    deadline: expect.any(Number),
  })

  await use_party.getState().refresh() // a stale poll frame lands: still lists the departed character
  expect(use_party.getState().party_id).toBe(null) // refused — not re-adopted
  expect(use_party.getState().party).toBe(null)
})

test('kick latches the departed target — a stale poll frame is refused and the optimistic removal survives (audit row 4)', async () => {
  const target_id = '0xtarget'
  const kick_party = {
    id: party.id,
    leader_character: selected.id,
    members: [
      { character: selected.id, owner: '0xwallet', order: 0 },
      { character: target_id, owner: '0xtarget-owner', order: 1 },
    ],
  }
  use_party.setState({ party_id: kick_party.id, party: kick_party, _party_character_id: selected.id })
  projected_party = kick_party // stale: the indexer has not dropped the kicked target yet

  await use_party.getState().kick(target_id)

  expect(action_calls[0]).toEqual(['kick', kick_party.id, selected.id, target_id])
  expect(use_party.getState().party.members.map((member) => member.character)).toEqual([selected.id])
  expect(use_party.getState()._departed).toEqual({
    party_id: kick_party.id,
    character_id: target_id,
    deadline: expect.any(Number),
  })
})

test('the departed latch drains once a fresh snapshot drops the player, and a genuine re-join then still works (audit row 4)', async () => {
  use_party.setState({ party_id: party.id, party, _party_character_id: selected.id })
  projected_party = party
  await use_party.getState().leave()
  expect(use_party.getState()._departed).not.toBe(null)

  projected_party = null // the projector caught up — a normal null, not a stale frame
  await use_party.getState().refresh()
  expect(use_party.getState()._departed).toBe(null)

  projected_party = party // a genuine re-join must not be blocked by the drained latch
  await use_party.getState().adopt_party_id(party.id, selected.id)
  expect(use_party.getState().party_id).toBe(party.id)
  expect(use_party.getState().party).toEqual(party)
  use_party.getState()._stop_polling()
})

// ── Fix 1: the quiet choice has ONE home (ensure_owned_party = system entry → silent; create() = human → visible).
//    Oracle: the create tx door (create_party) invocation + its silent arg — money law, never toast-absence. ──

test('system-initiated ensure_owned_party creates QUIETLY — one create tx, marked silent, no double-fire', async () => {
  roster = [selected, owned_alt] // a same-world alt makes the owned-join sweep non-empty, so create() is reached
  party_actions.create_party.mockImplementation(async (...args) => {
    action_calls.push(['create', ...args])
    return { party_id: '0xnew', receipt: {} }
  })

  await use_party.getState().ensure_owned_party()

  const creates = action_calls.filter((call) => call[0] === 'create')
  expect(creates).toHaveLength(1) // exactly one create — silencing never double-fires the tx
  expect(creates[0][2]).toEqual({ silent: true }) // system entry → quiet create
  use_party.getState()._stop_polling()
})

test('a human create() stays VISIBLE — one create tx, marked not-silent', async () => {
  roster = [selected]
  party_actions.create_party.mockImplementation(async (...args) => {
    action_calls.push(['create', ...args])
    return { party_id: '0xnew', receipt: {} }
  })

  await use_party.getState().create()

  const creates = action_calls.filter((call) => call[0] === 'create')
  expect(creates).toHaveLength(1)
  expect(creates[0][2]).toEqual({ silent: false }) // explicit-user entry → the visible toast is preserved
  use_party.getState()._stop_polling()
})

// ── #329: the phantom-follower / phantom-fight-seat bug — inviting ONE other player cold-started through
//    create() above, which unconditionally swept every owned alt into the party as REAL, accepted, on-chain
//    members (join_owned_alts_to_party signs+executes one party_invite_accept_own_ptb per alt — a live owner
//    repro confirmed the phantoms held real fight turn slots, not just a rendering glitch). PlayerActionMenu.jsx
//    now cold-starts through create_bare() instead — same tx door, zero alt sweep. ──

test('create_bare() never sweeps owned alts, even when eligible alts exist — the #329 repro shape', async () => {
  roster = [selected, owned_alt] // a same-world alt WOULD be swept if this reached create()'s owned-join branch
  party_actions.create_party.mockImplementation(async (...args) => {
    action_calls.push(['create', ...args])
    return { party_id: '0xnew', receipt: {} }
  })

  const created = await use_party.getState().create_bare()

  expect(created).toEqual({ party_id: '0xnew', character_id: selected.id, address: '0xwallet' })
  expect(action_calls).toEqual([['create', selected.id, { silent: false }]])
  expect(action_calls.some((call) => call[0] === 'join-owned')).toBe(false) // the #329 assertion: no alt sweep
  use_party.getState()._stop_polling()
})

test('an executed-failed system create is never refired (burn-law) — create_party called exactly once', async () => {
  roster = [selected, owned_alt]
  party_actions.create_party.mockImplementation(async (...args) => {
    action_calls.push(['create', ...args])
    throw attach_executed_digest(new Error('MoveAbort in party::create'), '0xburned') // a digest exists = gas burned
  })

  await use_party.getState().ensure_owned_party() // the failure is surfaced through create()'s catch, never retried

  expect(action_calls.filter((call) => call[0] === 'create')).toHaveLength(1) // one attempt, zero refire
  use_party.getState()._stop_polling()
})
