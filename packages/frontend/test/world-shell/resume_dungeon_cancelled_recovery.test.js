// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })
const owner = '0xowner'
const character_id = '0xcharacter'
const next_character_id = '0xnext-character'
const run_pass_id = '0xrun-pass'
const fight_id = '0xfight'
const world_id = '0xworld'

let read_response = async () => {
  throw new Error('test read response was not configured')
}
const get_object = mock(({ objectId }) => read_response(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../../src/auth')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const initial_dungeon = use_dungeon.getInitialState()

const run_object = () => ({
  object: {
    json: {
      id: run_pass_id,
      world: world_id,
      room: 1,
      owner,
      commit: { fight: fight_id },
    },
    version: '7',
  },
})

beforeEach(() => {
  reset_auth_mock({ address: owner })
  set_expedition_sdk_mock(get_sdk)
  use_auth.setState({ address: owner })
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  get_object.mockClear()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

test('a cancelled liveness recovery cannot clear the replacement action lock', async () => {
  const fight_read = Promise.withResolvers()
  let is_current = true
  read_response = async (object_id) => {
    if (object_id === run_pass_id) return run_object()
    if (object_id === fight_id) return fight_read.promise
    throw new Error(`unexpected object read: ${object_id}`)
  }
  const recover_dead_fight = mock(() => {})

  const resume = use_dungeon.getState().resume_dungeon(run_pass_id, character_id, { is_current: () => is_current })
  while (get_object.mock.calls.length < 2) await Promise.resolve()

  is_current = false
  use_dungeon.getState().reset_local()
  use_dungeon.setState({
    busy: true,
    busy_since: 9_000,
    character_id: next_character_id,
    _recover_dead_fight_reference: recover_dead_fight,
  })
  fight_read.reject({ code: 'deleted', message: 'object read failed' })

  expect(await resume).toEqual({ status: 'refused', reason: 'cancelled' })
  expect(recover_dead_fight).not.toHaveBeenCalled()
  expect(use_dungeon.getState()).toMatchObject({
    busy: true,
    busy_since: 9_000,
    character_id: next_character_id,
  })
})
