// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// ROW #2086 — THE PUSHED PARTY CARRIER, DRIVEN. Party membership and pending invitations used to reach this
// client on ONE four-second poll; the invite leg was the felt wait (folded #2204: the invitee's card must be up
// within about a second of the send). These gates drive the REAL party store through the REAL carrier with the
// RECONCILIATION CLOCK DISARMED — `set_timeout` never fires — so the ONLY thing that can move the store is the
// pushed SSE frame. On edge that is nothing at all: the poll is the sole carrier and the card never appears.
//
// The transport is faked exactly the way the fight adapter's own gate fakes it
// (packages/frontend/test/world-shell/fight_sse_adapter.test.js): a hand-rolled EventSource whose `emit_named`
// delivers one server frame. Nothing else about the store is stubbed away — the reducer, the invite carrier and
// the authoritative `/v1` reads are the shipped ones.

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { use_toast } from '../../src/toast'

const INVITED = { id: '0xinvited', name: 'Invited', classe: 'senshi', world_id: 'world-a' }
const INVITE_ROW = { party: '0xparty', leader_character: '0xleader' }

let active_character_id = INVITED.id
let projected_party = null
let pending_invites = []
let name_resolves = []

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
    sui: { characters: [INVITED] },
  })),
  spyOn(read_party, 'get_party').mockImplementation(async () => projected_party),
  spyOn(read_party, 'get_party_invites').mockImplementation(async () => pending_invites),
  spyOn(lobby_room, 'set_room_party').mockImplementation(() => {}),
  spyOn(lobby_room, 'publish_room_state').mockImplementation(() => {}),
  spyOn(core_toast, 'push_event_toast').mockImplementation(() => {}),
  spyOn(use_dungeon, 'getState').mockImplementation(() => ({ dungeon_id: null })),
  spyOn(use_dungeon, 'subscribe').mockImplementation(() => () => {}),
  spyOn(party_actions, 'create_party').mockImplementation(async () => ({ party_id: '0xparty' })),
  spyOn(character_name_resolve, 'resolve_character_name').mockImplementation(async (id) => {
    name_resolves = [...name_resolves, id]
    return 'Leader'
  }),
  spyOn(character_name_resolve, 'resolve_character_docs').mockImplementation(async () => new Map()),
]

const { use_party } = await import('../../src/world-shell/party_store.js')
const { start_party_carriers } = await import('../../src/world-shell/party_stream_link.js')

let latest_event_source = null
const fake_event_source = (url) => {
  let ready_state = 0
  let listeners = new Map()
  const source = {
    url,
    get readyState() {
      return ready_state
    },
    addEventListener(type, listener) {
      listeners = new Map([...listeners, [type, listener]])
    },
    open() {
      ready_state = 1
      listeners.get('open')?.()
    },
    emit_named(type, data) {
      listeners.get(type)?.({ data: JSON.stringify(data) })
    },
    close() {
      ready_state = 2
    },
  }
  latest_event_source = source
  return source
}

/** The reconciliation clock, DISARMED — a handle that is never invoked, so no tick can ever carry anything. */
const never = () => 'no-tick'

/** Drain the fire-and-forget reads a frame kicks off (`refresh` → `/v1` → the reducer door). */
const settle = async () => {
  for (let pass = 0; pass < 6; pass += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const start = () =>
  start_party_carriers({
    character_id: () => active_character_id,
    refresh: () => use_party.getState().refresh(),
    event_source_factory: fake_event_source,
    base_url: 'https://rpc.test',
    set_timeout: never,
    clear_timeout: () => {},
  })

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
  reset_auth_mock()
})

beforeEach(() => {
  reset_auth_mock({ address: '0xwallet' })
  use_party.getState()._stop_polling()
  active_character_id = INVITED.id
  projected_party = null
  pending_invites = []
  name_resolves = []
  latest_event_source = null
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

describe('#2086 · the invite arrives on the PUSHED channel, not on a poll tick', () => {
  test('a scope frame puts the invitee card up with the reconciliation clock disarmed', async () => {
    const stop = start()
    await settle()
    expect(use_party.getState().incoming_invite).toBe(null)

    // The leader signs `party::invite`: the projection gains the row and the stream frames the new scope. A
    // client with no pushed channel has nothing to be framed ON — that is the shape of the red this row fixes.
    pending_invites = [INVITE_ROW]
    latest_event_source?.open()
    latest_event_source?.emit_named('party', { party: null, invites: [INVITE_ROW.party] })
    await settle()

    expect(latest_event_source?.url).toBe(`https://rpc.test/v1/stream/party/${INVITED.id}`)
    expect(use_party.getState().incoming_invite).toEqual({
      party_id: INVITE_ROW.party,
      invited_character_id: INVITED.id,
      from_name: 'Leader',
    })
    stop()
    expect(latest_event_source.readyState).toBe(2)
  })

  test('the reconciliation read carrying the SAME invitation is a no-op — two carriers, one door', async () => {
    const stop = start()
    pending_invites = [INVITE_ROW]
    latest_event_source?.emit_named('party', { party: null, invites: [INVITE_ROW.party] })
    await settle()

    const delivered = use_party.getState().incoming_invite
    expect(delivered).not.toBe(null)
    expect(name_resolves).toEqual([INVITE_ROW.leader_character])

    // THE RECONCILIATION GUARD: the poll is not deleted, it is demoted — so the very same row arrives again on
    // the slow tick, and again on a re-frame after a reconnect. Re-entry through the one door must change
    // nothing and must not re-resolve, re-dispatch or double the card.
    await use_party.getState().refresh()
    latest_event_source.emit_named('party', { party: null, invites: [INVITE_ROW.party] })
    await settle()

    expect(use_party.getState().incoming_invite).toEqual(delivered)
    expect(name_resolves).toEqual([INVITE_ROW.leader_character])
    stop()
  })

  test('selection moving re-keys the subscription rather than filtering a wrong-character stream', async () => {
    // This one arms the clock by hand: the re-key rides the carrier's OWN alignment, so no call site has to
    // remember to re-subscribe when the player switches character mid-session.
    let tick = null
    const stop = start_party_carriers({
      character_id: () => active_character_id,
      refresh: () => use_party.getState().refresh(),
      event_source_factory: fake_event_source,
      base_url: 'https://rpc.test',
      set_timeout: (fn) => {
        tick = fn
        return 'handle'
      },
      clear_timeout: () => {},
    })
    expect(latest_event_source.url).toBe(`https://rpc.test/v1/stream/party/${INVITED.id}`)
    const abandoned = latest_event_source

    active_character_id = '0xother'
    tick()
    await settle()

    expect(latest_event_source.url).toBe('https://rpc.test/v1/stream/party/0xother')
    expect(abandoned.readyState).toBe(2)
    stop()
  })
})
