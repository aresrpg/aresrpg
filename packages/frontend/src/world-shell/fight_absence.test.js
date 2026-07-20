// P0 teardown liveness: a RunPass can keep pointing at a Fight after another sender settled and deleted it.
// The object read is authoritative; rehydrate must never publish that dead id into the shared fight store.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const DEAD_FIGHT_ID = '0xdeadfight'
const RUN_PASS_ID = '0xrunpass'
const WORLD_ID = '0xworld'

let read_response = /** @type {(object_id:string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => read_response(objectId))

const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../auth')
const { _reset_rpc_client_for_test } = await import('../rpc/client')
const { use_dungeon } = await import('./dungeon_store.js')
const { resume_world_fight } = await import('./world_fight.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

const run_object = () => ({
  object: {
    json: {
      id: RUN_PASS_ID,
      world: WORLD_ID,
      room: 1,
      owner: OWNER,
      commit: { fight: DEAD_FIGHT_ID },
    },
    version: '7',
  },
})

const world_object = () => ({
  object: {
    json: { id: WORLD_ID, dungeon_rooms: [{ mobs: [] }], dungeon_key_template: null },
    version: '3',
  },
})

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('authoritative fight absence', () => {
  test('a deleted read mid-fight triggers teardown exactly once; a transient read holds the board', async () => {
    let fight_error = /** @type {any} */ ({ code: 'unavailable', message: 'transport interrupted' })
    read_response = async (object_id) => {
      if (object_id === RUN_PASS_ID) return run_object()
      if (object_id === DEAD_FIGHT_ID) throw fight_error
      throw new Error(`unexpected object read: ${object_id}`)
    }
    const collapse = mock(() => use_dungeon.getState().reset_local())
    use_dungeon.setState({
      fight_id: DEAD_FIGHT_ID,
      dungeon_id: RUN_PASS_ID,
      character_id: CHARACTER_ID,
      run_pass_id: RUN_PASS_ID,
      run: {
        id: RUN_PASS_ID,
        world: WORLD_ID,
        room: 1,
        owner: OWNER,
        fight: DEAD_FIGHT_ID,
        version: 7,
      },
      phase: 'playing',
      fight_syncing: false,
      _collapse_terminal_ghost: collapse,
    })

    await use_dungeon.getState().refresh()
    expect(collapse).not.toHaveBeenCalled()
    expect(use_dungeon.getState().fight_id).toBe(DEAD_FIGHT_ID)

    fight_error = { code: 'deleted', message: 'object read failed' }
    await use_dungeon.getState().refresh()
    await use_dungeon.getState().refresh()

    expect(collapse).toHaveBeenCalledTimes(1)
    expect(use_dungeon.getState().fight_id).toBeNull()
    expect(use_dungeon.getState().run_pass_id).toBeNull()
  })
})

test('dungeon rehydrate validates a persisted fight id before publication and lands in the world', async () => {
  read_response = async (object_id) => {
    if (object_id === RUN_PASS_ID) return run_object()
    if (object_id === WORLD_ID) return world_object()
    if (object_id === DEAD_FIGHT_ID) throw { code: 'deleted', message: 'object read failed' }
    throw new Error(`unexpected object read: ${object_id}`)
  }
  const published_fight_ids = /** @type {(string|null)[]} */ ([])
  const unsubscribe = use_dungeon.subscribe((state, previous) => {
    if (state.fight_id !== previous.fight_id) published_fight_ids.push(state.fight_id)
  })

  try {
    await use_dungeon.getState().resume_dungeon(RUN_PASS_ID, CHARACTER_ID)
  } finally {
    unsubscribe()
  }

  expect(published_fight_ids).not.toContain(DEAD_FIGHT_ID)
  expect(use_dungeon.getState().fight_id).toBeNull()
  expect(use_dungeon.getState().run_pass_id).toBeNull()
  expect(use_dungeon.getState().dungeon_id).toBeNull()
  expect(use_dungeon.getState().in_session).toBe(false)
  expect(use_dungeon.getState().phase).toBe('idle')
})

test('world rehydrate preflights a stale /v1 candidate before mounting it', async () => {
  globalThis.fetch = mock(async (input) => {
    const query = new URL(String(input)).searchParams
    const fights = query.has('id') ? [] : [{ fight_id: DEAD_FIGHT_ID, world: WORLD_ID, status: 'active' }]
    return new Response(JSON.stringify({ fights }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const published_fight_ids = /** @type {(string|null)[]} */ ([])
  const unsubscribe = use_dungeon.subscribe((state, previous) => {
    if (state.fight_id !== previous.fight_id) published_fight_ids.push(state.fight_id)
  })

  try {
    await resume_world_fight(CHARACTER_ID)
  } finally {
    unsubscribe()
  }

  expect(published_fight_ids).not.toContain(DEAD_FIGHT_ID)
  expect(use_dungeon.getState().fight_id).toBeNull()
  expect(use_dungeon.getState().dungeon_id).toBeNull()
  expect(use_dungeon.getState().phase).toBe('idle')
})
