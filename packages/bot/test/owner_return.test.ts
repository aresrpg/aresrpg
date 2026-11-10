// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_connect_service } from '../src/connect.ts'
import { empty_lane, lane_key_for, type Lane } from '../src/control.ts'
import { assert_live_grant, public_bot, type Bot, type Grant } from '../src/model.ts'
import { begin_owner_return } from '../src/owner_return.ts'

import { fixture_bot, fixture_config, memory_store, put } from './helpers/control_fixture.ts'

const fixture = async () => {
  const store = memory_store()
  const connect = create_connect_service(
    store,
    fixture_config,
    async () => {},
    () => 1000
  )
  const challenge = await connect.challenge(
    { purpose: 'session', owner: fixture_bot.owner, zklogin_public_identifier: fixture_bot.zklogin_public_identifier },
    ''
  )
  await connect.verify(challenge.result.challenge_id, 'fixture-proof', challenge.session)
  await put(store, `bot:${fixture_bot.id}`, fixture_bot)
  return { store, connect, id: challenge.result.authorization_id, session: challenge.session }
}

test('wrong owner session or reviewed wallet cannot begin return', async () => {
  const f = await fixture()
  await expect(f.connect.begin_return(f.id, 'foreign', public_bot(fixture_bot))).rejects.toThrow('invalid_session')
  await expect(
    f.connect.begin_return(f.id, f.session, { ...public_bot(fixture_bot), address: 'foreign' })
  ).rejects.toThrow('connection_changed')
  expect((await f.store.read<Bot>(`bot:${fixture_bot.id}`))?.status).toBe('ready')
})

test('return fences every old grant while retaining an uncertain envelope and its receipt lease', async () => {
  const lane: Lane = {
    ...empty_lane(fixture_bot),
    actor_id: 'actor',
    fence: 9,
    lease_until: 9000,
    active_command: 'command',
    pending: {
      command_id: 'command',
      grant_id: 'grant',
      digest: 'digest',
      phase: 'submitting',
      encrypted: 'retained',
      gas_budget_mist: '10',
    },
  }
  const result = begin_owner_return(fixture_bot, lane, public_bot(fixture_bot))
  expect(result.result.phase).toBe('draining')
  expect(result.bot).toMatchObject({ status: 'returning', generation: fixture_bot.generation + 1 })
  expect(result.lane).toMatchObject({ paused: true, fence: 9, lease_until: 9000, pending: lane.pending })
  const grant = {
    bot_id: fixture_bot.id,
    owner: fixture_bot.owner,
    network: fixture_bot.network,
    address: fixture_bot.address,
    descriptor: fixture_bot.multisig_public_key,
    generation: fixture_bot.generation,
    policy_revision: 1,
    authority_generation: fixture_config.authority_generation,
    resource: fixture_config.resource,
    revoked: false,
    scopes: fixture_config.scopes,
  } as Grant
  expect(() => assert_live_grant(fixture_config, grant, result.bot, 1000)).toThrow('invalid_token')
})

test('idempotent stop waits for receipt drain and cannot finish while a command remains active', async () => {
  const f = await fixture(),
    review = public_bot(fixture_bot),
    key = lane_key_for(fixture_bot)
  await put(f.store, key, { ...empty_lane(fixture_bot), active_command: 'command' })
  const first = await f.connect.begin_return(f.id, f.session, review)
  expect(first.phase).toBe('draining')
  expect(await f.connect.begin_return(f.id, f.session, review)).toEqual(first)
  await expect(f.connect.complete_return(f.id, f.session, first.bot)).rejects.toThrow('return_not_ready')
  const lane = (await f.store.read<Lane>(key))!
  await put(f.store, key, { ...lane, active_command: null })
  expect((await f.connect.begin_return(f.id, f.session, first.bot)).phase).toBe('stopped')
  const done = await f.connect.complete_return(f.id, f.session, first.bot)
  expect(done).toMatchObject({ phase: 'complete', bot: { status: 'ready', generation: first.bot.generation } })
  await expect(f.connect.begin_return(f.id, f.session, review)).rejects.toThrow('connection_changed')
})

test('owner stop retires the existing profession run without clearing a pending transaction', async () => {
  const f = await fixture(),
    key = lane_key_for(fixture_bot)
  await put(f.store, 'profession:run', { id: 'run', bot_id: fixture_bot.id, status: 'waiting' })
  await put(f.store, key, { ...empty_lane(fixture_bot), profession_run_id: 'run', active_command: 'step' })
  expect((await f.connect.begin_return(f.id, f.session, public_bot(fixture_bot))).phase).toBe('draining')
  expect(await f.store.read(key)).toMatchObject({ profession_run_id: null, active_command: 'step' })
  expect(await f.store.read('profession:run')).toMatchObject({ status: 'stopped' })
})
