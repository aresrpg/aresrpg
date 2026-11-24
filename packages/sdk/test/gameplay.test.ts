// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Whole gameplay sessions through the real SDK over the fake chain: each action composes one pinned
// transaction, a door that takes &Random stays the last game call, and receipt facts come from events.

import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { SuinsClient } from '@mysten/suins'

import { character_actions } from '../src/character_actions.ts'
import { SDK } from '../src/client.ts'
import { fight_actions } from '../src/fight.ts'
import { friend_list_id, friends_actions } from '../src/friends.ts'
import { party_actions } from '../src/party.ts'
import { subdomain_config, suins_actions } from '../src/suins_actions.ts'
import { tournament_actions } from '../src/tournament.ts'

import registration from './fixtures/suins_registration.json'
import { digest, fake_client, id, pins, sample_gas, signer, type FakeClient } from './helpers/transport.ts'

const game_pins = {
  ...pins,
  package_original: id(1),
  kiosk_package: id(20),
  seed_package: id(60),
  seed_package_original: id(60),
  content_root: { id: id(61), shared_version: '1' },
  kares_coin_type: `${id(15)}::kares::KARES`,
  kares_economy: { id: id(16), shared_version: '1' },
}
const cap = (kiosk = id(4)): KioskOwnerCap => ({
  objectId: kiosk === id(5) ? id(301) : id(300),
  kioskId: kiosk,
  isPersonal: true,
  version: '1',
  digest,
})
const session = (
  events: readonly { type: string; json: Record<string, unknown> }[] = [],
  options: Parameters<typeof fake_client>[0] = {}
) => {
  const client = fake_client({ events, gas_used: sample_gas, ...options })
  return { client, sdk: SDK({ client, signer, pins: game_pins, transaction_storage: null }) }
}
const game_calls = (client: FakeClient, index: number) =>
  Transaction.from(client.calls.submitted[index]!)
    .getData()
    .commands.flatMap(({ MoveCall }) => (MoveCall && MoveCall.package === id(1) ? [MoveCall.function] : []))
const last_game_call = (client: FakeClient) => game_calls(client, client.calls.submitted.length - 1).at(-1)

test('a tournament runs from start to claims through its own doors, each in one transaction', async () => {
  const { client, sdk } = session([{ type: `${id(1)}::fight::FightClosed`, json: { fight: id(9) } }])
  const actions = tournament_actions(sdk, { kiosk_cap: async () => cap() })
  const match = { tournament: id(7), index: 0, fight: id(9) }
  const seat = { fighter_idx: 0n, custody: { kiosk: id(4), kiosk_cap: id(300) } }
  const steps: readonly [() => Promise<unknown>, string][] = [
    [() => actions.start(id(7)), 'start_tournament'],
    [() => actions.leave_team(id(7), 1, id(20)), 'leave_team'],
    [() => actions.donate(id(7), 'sui', 5n), 'donate_sui'],
    [() => actions.donate(id(7), 'kares', 5n), 'create_kares_pool'],
    [() => actions.donate(id(7), 'kares', 5n, id(8)), 'donate_kares'],
    [() => actions.crank_unopened(id(7), 3), 'crank_unopened'],
    [
      () => actions.open({ tournament: id(7), index: 0, character_id: id(20), custody: seat.custody }),
      'open_tournament_match',
    ],
    [() => actions.join({ ...match, character_id: id(20), custody: seat.custody }), 'join_tournament_match'],
    [() => actions.ready({ ...match, fighter_indices: [0n] }), 'ready_tournament_match'],
    [() => actions.crank(match), 'crank_tournament_match'],
    [() => actions.forfeit({ fight: id(9), ...seat }), 'forfeit_tournament_match'],
    [() => actions.settle({ ...match, ...seat, last: true }), 'close_tournament_match'],
    [() => actions.close(match), 'close_tournament_match'],
    [() => actions.claim_coins(id(7), 1, 0, { sui: true, pool: id(8) }), 'claim_kares'],
    [() => actions.refund_kares(id(7), id(8)), 'refund_kares'],
    [() => actions.expire(id(7), id(8)), 'refund_kares'],
  ]
  for (const [step, door] of steps) {
    await step()
    expect(last_game_call(client)).toBe(door)
  }
  expect(client.calls.executions).toBe(steps.length)
  expect(await actions.settle({ ...match, ...seat })).toMatchObject({ closed: true })
  await expect(actions.donate(id(7), 'sui', 0n)).rejects.toThrow('positive')
  expect(client.calls.executions).toBe(steps.length + 1)
})

test('a fight is placed, started, cranked, forfeited, settled and closed with its gas attributed', async () => {
  const fight = id(9)
  const { client, sdk } = session([
    { type: `${id(1)}::fight::FightStarted`, json: { fight, queue: ['0', '1'] } },
    { type: `${id(1)}::fight::FightClosed`, json: { fight } },
  ])
  const actions = fight_actions(sdk, { kiosk_cap: async () => cap() })
  const custody = { kiosk: id(4), kiosk_cap: id(300) }
  await actions.join({ fight, character_id: id(20), custody, team: 0 })
  expect(last_game_call(client)).toBe('join_fight')
  await actions.join_many({ fight, character_ids: [id(20), id(21)], custody, team: 0, party: id(22) })
  expect(game_calls(client, 1).filter((name) => name === 'join_fight_grouped')).toHaveLength(2)
  await expect(actions.join_many({ fight, character_ids: [], custody, team: 0 })).rejects.toThrow(
    'at least one character'
  )
  await actions.place({ fight, fighter_idx: 0n, cell: 4n })
  expect(last_game_call(client)).toBe('place_fighter')
  await actions.start({ fight })
  expect(last_game_call(client)).toBe('start_fight')
  await actions.crank({ fight })
  expect(last_game_call(client)).toBe('crank_fight')
  await actions.forfeit({ fight, fighter_idx: 0n, custody })
  expect(last_game_call(client)).toBe('forfeit_fight_terminal')
  const settled = await actions.settle({
    fight,
    custody,
    last: true,
    settlements: [
      {
        fighter_idx: 0n,
        loot: [
          { item_type: 'wool', existing: null },
          { item_type: 'wool', existing: null },
        ],
      },
    ],
  })
  expect(settled).toMatchObject({ closed: true })
  const settle_calls = game_calls(client, client.calls.submitted.length - 1)
  expect([settle_calls.filter((name) => name === 'prepare_fight_loot').length, settle_calls.at(-1)]).toEqual([
    1,
    'settle_last_fight',
  ])
  await expect(actions.settle({ fight, custody, settlements: [] })).rejects.toThrow('empty')
  await actions.close({ fight })
  expect(last_game_call(client)).toBe('close_fight')
  expect(actions.gas_spent(fight)).toBe(2_500_000n * BigInt(client.calls.executions))
})

test('a party lives through invitations, membership and disbanding; friends keep one list', async () => {
  const { client, sdk } = session()
  const leader = { id: id(30), name: 'Ari', kiosk: id(4), kiosk_cap: id(300), custody: 'kiosk' } as never
  const member = { id: id(31), name: 'Bex', kiosk: id(5), kiosk_cap: id(301), custody: 'kiosk' } as never
  const party = { id: id(32), members: [], invited: [] } as never
  const actions = party_actions(sdk, { kiosk_cap: async (kiosk) => cap(kiosk) })
  const steps: readonly [() => Promise<unknown>, string][] = [
    [() => actions.invite(null, leader, { id: id(31), name: 'Bex' }), 'create_party_invitation'],
    [() => actions.invite(party, leader, { id: id(33), name: 'Cyr' }), 'party_invitation'],
    [() => actions.accept(id(32), member), 'party_accept'],
    [() => actions.decline(id(32), member), 'party_invitation'],
    [() => actions.rescind(party, leader, id(33)), 'party_invitation'],
    [() => actions.kick(party, leader, id(31)), 'party_kick'],
    [() => actions.leave(party, member), 'party_leave'],
    [() => actions.disband(party, leader), 'party_disband'],
  ]
  for (const [step, door] of steps) {
    await step()
    expect(game_calls(client, client.calls.submitted.length - 1)).toContain(door)
  }
  const in_fight = { ...(leader as object), custody: 'fight', active_fight: { id: id(9), seat: 1n } } as never
  await actions.invite(party, in_fight, { id: id(33), name: 'Cyr' })
  expect(last_game_call(client)).toBe('party_invitation_from_fight')
  await expect(actions.invite(null, in_fight, { id: id(33), name: 'Cyr' })).rejects.toThrow('kiosk custody')

  const address = signer.toSuiAddress()
  const list = friend_list_id(id(10), id(1), address)
  const fresh = session()
  const friends = friends_actions(fresh.sdk, { address })
  expect(friends.list).toBe(list)
  await friends.add(id(40))
  expect(last_game_call(fresh.client)).toBe('create_friend_list')
  await expect(friends.remove(id(40))).rejects.toThrow('no friend list')
  const existing = session([], { owned_versions: new Map([[list, ['3']]]) })
  const listed = friends_actions(existing.sdk, { address })
  await listed.add(id(41))
  await listed.remove(id(41))
  expect([game_calls(existing.client, 0), game_calls(existing.client, 1)].map((calls) => calls.at(-1))).toEqual([
    'set_friend',
    'set_friend',
  ])
})

test('a hero equips, raises, burns and leaves through one kiosk transaction each', async () => {
  const { client, sdk } = session([], { owned_versions: new Map([[id(42), ['3']]]) })
  const actions = character_actions(sdk, { kiosk_cap: async () => cap() })
  const custody = { kiosk: id(4), kiosk_cap: id(300) }
  const character_id = id(20)
  await actions.equip({
    character_id,
    custody,
    to_equip: [{ slot: 'hat', item_id: id(41) }],
    to_unequip: [{ slot: 'hat', item_id: id(42) }],
  })
  expect(game_calls(client, 0)).toEqual(['unequip_item', 'equip_item'])
  await actions.raise_stats({ character_id, custody, spending: { strength: 3, wisdom: 0, agility: 2 } })
  expect(game_calls(client, 1)).toEqual(['raise_stat', 'raise_stat'])
  await actions.raise_spell({ character_id, custody, spell: 'spark' })
  expect(last_game_call(client)).toBe('raise_spell')
  await actions.destroy_item({ item_id: id(43), amount: 2, custody, merge_sources: [id(44)] })
  expect(game_calls(client, 3)).toEqual(['merge_stacks', 'burn_item'])
  await actions.delete({ character_id, custody })
  expect(last_game_call(client)).toBe('delete_character')
  await expect(actions.equip({ character_id, custody, to_equip: [], to_unequip: [] })).rejects.toThrow('empty')
  await expect(actions.raise_stats({ character_id, custody, spending: { strength: 0 } })).rejects.toThrow('empty')
  await expect(actions.destroy_item({ item_id: id(43), amount: 0, custody })).rejects.toThrow('positive integer')
  expect(client.calls.executions).toBe(5)
})

afterEach(() => mock.restore())

// Mainnet SuinsRegistration 0xaa51f76346f51fb79295454d9f6f47b394bb7f288cd70c0ae6b98fd5e517c1da,
// version 996277083, captured 2026-09-11 by Core.getObject. Its SubDomainConfig field
// 0x3a02f9a7c77b13c91532613bd4b3345bce226cbf51f0604e857bb9b37f5d0e37, version 108677241,
// was captured 2026-11-11 from gRPC listDynamicFields at checkpoint 343956030.
test('a SuiNS parent creates two final-target leaves once and a clean application writes nothing', async () => {
  const config_bytes = new Uint8Array([1, 3, 115, 117, 105, 10, 3, 0, 92, 38, 5, 0, 0, 0, 0])
  expect(subdomain_config.parse(config_bytes)).toEqual({
    allowed_tlds: ['sui'],
    max_depth: 10,
    min_label_size: 3,
    minimum_duration: '86400000',
  })
  const owner = registration.owner.AddressOwner
  const agent = normalizeSuiAddress('0xa')
  type RecordValue = NonNullable<Awaited<ReturnType<SuinsClient['getNameRecord']>>>
  const node = (
    name: string,
    target = owner,
    expiration = Number(registration.json.expiration_timestamp_ms)
  ): RecordValue => ({
    name,
    nftId: registration.objectId,
    targetAddress: target,
    expirationTimestampMs: expiration,
    data: {},
  })
  const setup = () => {
    const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' })
    const state = {
      records: new Map([['sceat.sui', node('sceat.sui')]]),
      defaults: new Map<string, string>(),
      executions: [] as Transaction[],
      owned: [registration] as unknown[],
    }
    spyOn(SuinsClient.prototype, 'getNameRecord').mockImplementation(async (name) => state.records.get(name) ?? null)
    client.core.defaultNameServiceName = async ({ address }) => ({
      data: { name: state.defaults.get(address) ?? null },
    })
    client.core.resolveNameServiceAddress = async ({ name }) => ({
      address: state.records.get(name)?.targetAddress ?? null,
    })
    client.core.getDynamicField = async () => ({ dynamicField: { value: { bcs: config_bytes } } }) as never
    client.movePackageService.getDatatype = (async () => ({
      response: { datatype: { definingId: '0x00c2f85e07181b90c140b15c5ce27d863f93c4d9159d2a4e7bdaeb40e286d6f5' } },
    })) as never
    client.core.listOwnedObjects = async ({ type, cursor }) =>
      ({
        objects: cursor ? [] : state.owned.filter((object) => (object as { type: string }).type === type),
        hasNextPage: !cursor,
        cursor: cursor ? null : 'next',
      }) as never
    const sdk = {
      execute: async (transaction: Transaction, options?: { before_sign?: () => void }) => {
        options?.before_sign?.()
        state.executions.push(transaction)
        return { Transaction: { digest: 'confirmed' } } as never
      },
    }
    return {
      state,
      actions: suins_actions({ client, sdk, address: owner, managed: true, now: () => 1_789_100_000_000 }),
    }
  }
  const guard = () => {}
  const applied = setup()
  expect(await applied.actions.snapshot()).toEqual({
    default_name: null,
    names: [{ name: 'sceat.sui', object_id: registration.objectId, nft_id: registration.objectId, subname: false }],
  })
  await applied.actions.validate_parent('sceat.sui', guard)
  const review = await applied.actions.review_parent('sceat.sui', agent, guard)
  expect(await applied.actions.apply_parent('sceat.sui', agent, guard, undefined, review)).toEqual({
    name: 'aresrpg.sceat.sui',
    digest: 'confirmed',
    targets: { 'aresrpg.sceat.sui': owner, 'aresrpgagent.sceat.sui': agent },
  })
  const leaves = applied.state.executions[0]!.getData()
    .commands.map(({ MoveCall }) => MoveCall?.function)
    .filter((name) => ['new_leaf', 'set_reverse_lookup'].includes(name!))
  expect(leaves).toEqual(['new_leaf', 'new_leaf', 'set_reverse_lookup'])

  const clean = setup()
  clean.state.records.set('aresrpg.sceat.sui', node('aresrpg.sceat.sui', owner, 0))
  clean.state.records.set('aresrpgagent.sceat.sui', node('aresrpgagent.sceat.sui', agent, 0))
  clean.state.defaults.set(owner, 'aresrpg.sceat.sui')
  const unchanged = await clean.actions.review_parent('sceat.sui', agent, guard)
  expect(await clean.actions.apply_parent('sceat.sui', agent, guard, undefined, unchanged)).toEqual({
    name: 'aresrpg.sceat.sui',
    targets: { 'aresrpg.sceat.sui': owner, 'aresrpgagent.sceat.sui': agent },
  })
  expect(clean.state.executions).toHaveLength(0)

  const collision = setup()
  collision.state.records.set('aresrpgagent.sceat.sui', node('aresrpgagent.sceat.sui'))
  await expect(collision.actions.validate_parent('sceat.sui', guard)).rejects.toThrow('collision')
  collision.state.records.delete('aresrpgagent.sceat.sui')
  collision.state.records.set('sceat.sui', node('sceat.sui', owner, 1))
  await expect(collision.actions.validate_parent('sceat.sui', guard)).rejects.toThrow('invalid_parent')
  expect(collision.state.executions).toHaveLength(0)
})
