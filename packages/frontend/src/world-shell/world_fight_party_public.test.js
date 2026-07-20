// Fix 2 — NO DISCARDED TX. A PUBLIC world fight discards the party id (anyone in placement may join), so
// auto-forming an owned party on that entry is a wasted on-chain create tx. enter_world_fight (the fresh-create
// ferry, reached from world_spawns.engage) must skip the pre-form when the fight is public and keep forming it
// for a GROUP (private) fight. THE ORACLE is the tx door: party_actions.create_party invocation count — the
// money law (count txs, never toast-absence). The real party_store.ensure_owned_party / create run underneath;
// only the tx door and the heavy fight-ferry internals (fight-core open, receipt poll) are mocked.

import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xwallet'
const LEADER = { id: '0xleader', name: 'Leader', classe: 'senshi', world_id: 'world-a' }
const ALT = { id: '0xalt', name: 'Alt', classe: 'shugo', world_id: 'world-a' } // same world → join-eligible
const FIGHT_ID = '0xfight'
const WORLD_ID = 'world-a'

let roster = [LEADER, ALT]

const [{ context }, read_party, lobby_room, { use_dungeon }, party_actions, shim, receipt, { use_party }, world_fight] =
  await Promise.all([
    import('../game/store.js'),
    import('../chain/read_party'),
    import('../p2p/lobby-room'),
    import('./dungeon_store.js'),
    import('./party_actions'),
    import('./dungeon_fight_shim.js'),
    import('./world_fight_receipt.js'),
    import('./party_store.js'),
    import('./world_fight.js'),
  ])
const { enter_world_fight } = world_fight

const create_calls = []

const spies = [
  spyOn(context, 'get_state').mockImplementation(() => ({
    selected_character_id: LEADER.id,
    sui: { characters: roster },
  })),
  spyOn(context.events, 'on').mockImplementation(() => context.events),
  spyOn(read_party, 'get_party').mockImplementation(async () => null),
  spyOn(lobby_room, 'broadcast_state').mockImplementation(() => {}),
  spyOn(lobby_room, 'sync_party_room').mockImplementation(() => {}),
  spyOn(lobby_room, 'nudge_party_invite').mockImplementation(() => {}),
  spyOn(lobby_room, 'get_peer_state').mockImplementation(() => null),
  spyOn(party_actions, 'create_party').mockImplementation(async (...args) => {
    create_calls.push(args)
    return { party_id: '0xnew-party', receipt: {} }
  }),
  spyOn(party_actions, 'join_owned_alts_to_party').mockImplementation(async () => new Map()),
  spyOn(shim, 'init_dungeon_fight').mockImplementation(() => {}),
  spyOn(receipt, 'poll_receipt_fight').mockImplementation(async () => {}),
]

const initial_dungeon = use_dungeon.getInitialState()

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 25))
}

const until = async (predicate, timeout_ms = 500) => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return predicate()
}

const reset_party = () =>
  use_party.setState({
    party_id: null,
    party: null,
    incoming_invite: null,
    busy: false,
    error: null,
    _awaiting_party_id: null,
    _awaiting_character_id: null,
    _party_character_id: null,
    _departed: null,
    _owned_join_blocked_ids: [],
  })

beforeEach(() => {
  reset_auth_mock({ address: OWNER, wallet_name: 'wallet' })
  roster = [LEADER, ALT]
  create_calls.length = 0
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  use_party.getState()._stop_polling()
  reset_party()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_party.getState()._stop_polling()
})

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
  reset_auth_mock()
  restore_browser_globals()
})

test('a PUBLIC fight forms NO owned party — the create tx is never signed (discarded-tx waste eliminated)', async () => {
  enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: LEADER.id, is_public: true })
  await flush()

  expect(create_calls).toHaveLength(0)
})

test('a PRIVATE fight with a same-world alt forms the owned party exactly once (unchanged)', async () => {
  enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: LEADER.id, is_public: false })

  expect(await until(() => create_calls.length === 1)).toBe(true) // the pre-form fired (setup oracle is live)
  await flush()
  expect(create_calls).toHaveLength(1) // …exactly once, no double-fire
})

test('a PRIVATE fight that already has a party never re-creates (join path, zero create tx)', async () => {
  use_party.setState({
    party_id: '0xexisting',
    party: {
      id: '0xexisting',
      leader_character: LEADER.id,
      members: [{ character: LEADER.id, owner: OWNER, order: 0 }],
    },
    _party_character_id: LEADER.id,
  })

  enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: LEADER.id, is_public: false })
  await flush()

  expect(create_calls).toHaveLength(0) // an existing party takes the join path — never a second create
})
