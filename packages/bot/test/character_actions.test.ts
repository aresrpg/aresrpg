// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { worlds_source } from '@aresrpg/engine/data'
import type { SuiTransport } from '@aresrpg/sdk'
import type { Receipt } from '@aresrpg/sdk/cache'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { CHARACTER_FUNDING_MIST, GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'
import { transaction_failure_kind } from '@aresrpg/sdk/transaction-error'

import { CHARACTER_ACTIONS, character_created_projected, validate_create_character } from '../src/character_actions.ts'
import { create_actor_runtime } from '../src/actor_runtime.ts'
import { public_command } from '../src/command_admission.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import {
  execute_gameplay_actions,
  parse_gameplay_action,
  validate_gameplay,
  type GameplayContext,
} from '../src/gameplay.ts'
import { public_command_error } from '../src/planning_failure.ts'
import { fake_client, id } from '../../sdk/test/helpers/transport.ts'

import { character, profession_context } from './helpers/profession_fixture.ts'
import { fixture } from './helpers/hero_runs_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'

const payload = { name: 'Newhero', classe: 'senshi', male: false, color_1: 0, color_2: 0xd9af57, color_3: 0xffffff }
const balance = (mist: bigint) => ({ address: id(99), balance_mist: String(mist), sampled_at: 0, expires_at: 1e9 })
const context_for = (patch: Readonly<Record<string, unknown>> = {}, funds = CHARACTER_FUNDING_MIST) => {
  const context = profession_context()
  return {
    ...context,
    balance: balance(funds),
    command: { ...context.command, kind: 'create_character' as const, payload: { ...payload, ...patch } },
  }
}
const recorder = () => {
  const calls: unknown[][] = []
  const actions = {
    create_character: async (...input: unknown[]) => {
      calls[calls.length] = input
      return { digest: 'created', character_id: id(77) }
    },
  } as unknown as Parameters<typeof execute_gameplay_actions>[1]
  return { calls, actions }
}

test('the creation schema takes exactly the six fields the SDK takes, under the game name rule', () => {
  expect(parse_gameplay_action('create_character', payload)).toEqual(payload)
  for (const patch of [
    { classe: 'wizard' },
    { male: 'yes' },
    { color_1: -1 },
    { color_2: 0x1000000 },
    { color_3: 1.5 },
    { first_world: 'nauvis' },
    { recipient: id(1) },
    { name: '' },
  ])
    expect(() => CHARACTER_ACTIONS.create_character.parse({ ...payload, ...patch })).toThrow('invalid_gameplay_payload')
  const { color_3: _dropped, ...missing } = payload
  expect(() => CHARACTER_ACTIONS.create_character.parse(missing)).toThrow('invalid_gameplay_payload')
  for (const name of ['abc', 'a'.repeat(20), 'two words', 'héros'])
    expect(() => CHARACTER_ACTIONS.create_character.parse({ ...payload, name })).toThrow('invalid_character_name')
})

test('a fresh snapshot validates the creation into the seed entry world', () => {
  const plan = validate_gameplay(context_for())
  expect(plan).toEqual({ kind: 'create_character', input: { ...payload, first_world: worlds_source[0]!.world } })
  expect(() => validate_gameplay({ ...context_for(), snapshot: { ...context_for().snapshot, ready: false } })).toThrow(
    'needs_resync'
  )
  const stale = context_for()
  expect(() => validate_gameplay({ ...stale, command: { ...stale.command, observation_revision: 0 } })).toThrow(
    'needs_resync'
  )
})

test('the wallet must hold the price and the gas ceiling, and the refusal is the existing funding refusal', () => {
  expect(CHARACTER_FUNDING_MIST).toBe(CHARACTER_PRICE_MIST + GAS_BUDGET_MIST)
  expect(CHARACTER_PRICE_MIST).toBe(10_000_000_000n)
  expect(validate_create_character(context_for()).kind).toBe('create_character')
  const short = context_for({}, CHARACTER_FUNDING_MIST - 1n)
  const refusal = (() => {
    try {
      validate_create_character(short)
    } catch (error) {
      return error
    }
    return null
  })()
  expect(transaction_failure_kind(refusal)).toBe('funding')
  // What the client reads once the bot stores that refusal on the command.
  expect(public_command_error('failed', String(refusal))).toBe('funding_required')
  // An unread balance decides nothing here: the SDK's own preparation stays the authority.
  expect(validate_create_character({ ...short, balance: null }).kind).toBe('create_character')
})

test('a name this wallet already holds is refused before any signature', async () => {
  const { calls, actions } = recorder()
  const held = context_for({ name: ' NEWHERO ' })
  const taken = {
    ...held,
    snapshot: { ...held.snapshot, characters: [character, { ...character, id: id(77), name: 'newhero' }] },
  }
  expect(() => validate_gameplay(taken)).toThrow('character_name_taken')
  await expect(execute_gameplay_actions(taken, actions)).rejects.toThrow('character_name_taken')
  expect(calls).toEqual([])
})

test('a creation is exactly one SDK call with the validated input, and nothing without an executor', async () => {
  const { calls, actions } = recorder()
  const context = context_for()
  expect<unknown>(await execute_gameplay_actions(context, actions)).toEqual({ digest: 'created', character_id: id(77) })
  expect(calls).toEqual([[payload, worlds_source[0]!.world]])
  await expect(execute_gameplay_actions(context, {} as Parameters<typeof execute_gameplay_actions>[1])).rejects.toThrow(
    'character_executor_unavailable'
  )
  const short = context_for({}, 1n)
  await expect(execute_gameplay_actions(short, actions)).rejects.toThrow('NOT submitted')
  expect(calls).toHaveLength(1)
})

test('the creation is projected only once the receipt-named hero is in the observed roster', () => {
  const receipt: Receipt = {
    Transaction: {
      digest: 'created',
      effects: { status: { success: true }, lamportVersion: '9', changedObjects: [] },
      events: [{ type: `${id(1)}::character::CharacterCreated`, json: { character: id(77) } }],
    },
  }
  expect(character_created_projected(receipt, [character])).toBe(false)
  expect(character_created_projected(receipt, [character, { ...character, id: id(77) }])).toBe(true)
  expect(character_created_projected({ Transaction: { digest: 'other' } }, [character])).toBe(false)
})

test('an uncertain creation is never asked to sign again, and the born hero refuses a second send', async () => {
  const f = await fixture()
  const { decision_revision, observation_revision } = await f.lane()
  const create = await f.control.accept(f.grant, {
    idempotency_key: 'create',
    kind: 'create_character',
    payload,
    decision_revision,
    observation_revision,
  })
  expect(await f.pass()).toMatchObject({ id: create.id, kind: 'create_character' })
  // The submission was lost after signing: the outcome is unknown and the slot is released.
  await f.store.transaction([`command:${create.id}`, f.key], async (tx) => {
    await tx.put(`command:${create.id}`, { ...create, status: 'uncertain', error: 'Error: connection lost' })
    await tx.put(f.key, { ...(await tx.get(f.key))!, active_command: null })
  })
  for (const _ of [1, 2, 3]) expect(await f.pass()).toBeNull()
  expect((await f.store.read<Command>(`command:${create.id}`))?.status).toBe('uncertain')
  expect(f.errors).toEqual([])
  // It did execute: the hero is observed, so the same request is refused before it could be signed twice.
  const context: GameplayContext = context_for()
  const born = { ...context.snapshot, characters: [character, { ...character, id: id(77), name: 'newhero' }] }
  expect(() => validate_gameplay({ ...context, snapshot: born })).toThrow('character_name_taken')
  await f.runtime.stop()
})

test('the live runtime refuses an unfunded creation unsigned, as a funding refusal with the judged balance', async () => {
  const f = await runtime_fixture()
  const chain = fake_client({ simulate_ok: true })
  const client = {
    ...chain,
    core: { ...chain.core, getBalance: async () => ({ balance: { balance: '5000000000' } }) },
  } as unknown as SuiTransport
  const runtime = create_actor_runtime({ ...f.options, sdk_options: { client } })
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  await runtime.observe(f.grant, {})
  await f.admit()
  await runtime.settle()
  const { decision_revision, observation_revision } = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  const create = await control.accept(f.grant, {
    idempotency_key: 'create',
    kind: 'create_character',
    payload,
    decision_revision,
    observation_revision,
  })
  for (const _ of [1, 2]) {
    await runtime.tick()
    await runtime.settle()
  }
  const refused = (await f.store.read<Command>(`command:${create.id}`))!
  expect(refused).toMatchObject({ status: 'failed', funding_balance_mist: '5000000000' })
  expect(public_command(refused).error).toBe('funding_required')
  // Nothing was prepared, simulated or submitted for it.
  expect(chain.calls).toMatchObject({ executions: 0, simulations: 0 })
  expect((await f.store.read<Lane>(lane_key_for(f.bot)))!.pending).toBeNull()
  await runtime.stop()
  await f.runtime.stop()
})
