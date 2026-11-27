// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The SDK is a projection of the Move source and of captured chain bytes: generated files match a fresh
// generation, every door composes pre-resolved inputs, and every hand decoder reads a real payload.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { basis_points, marketplace_royalty_bps } from '@aresrpg/immutable'
import { ObjectError } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, fromHex } from '@mysten/sui/utils'

import {
  API_MOVE_PATH,
  CHARACTER_MOVE_PATH,
  CHARACTER_PRICE_OUT_PATH,
  DOORS_OUT_PATH,
  TOURNAMENT_BRACKET_PATH,
  TOURNAMENT_MOVE_PATH,
  TOURNAMENT_RULES_OUT_PATH,
  TRADE_MOVE_PATH,
  generate_character_price,
  generate_game_doors,
  generate_tournament_rules,
  parse_doors,
} from '../scripts/generate_doors.mjs'
import {
  SEED_CONTRACT_OUT_PATH,
  SEED_DOORS_OUT_PATH,
  generate_seed_contract,
  generate_seed_doors,
  seed_doors,
} from '../scripts/generate_seed_doors.mjs'
import { SDK, absorb_receipt } from '../src/client.ts'
import { DOORS } from '../src/doors.gen.ts'
import { fight_actions } from '../src/fight.ts'
import { LOOT_BOX_BATCH_LIMIT } from '../src/loot_boxes.ts'
import { read_item_snapshot } from '../src/item_snapshot.ts'
import {
  COMBAT_POT_BCS,
  COMMUNITY_POOL_BCS,
  KARES_CURRENCY_BCS,
  STAKE_POSITION_BCS,
  STAKING_POOL_BCS,
  project_community_claimable,
} from '../src/kares_decode.ts'
import { COMMUNITY_VESTING_MS, KARES_ALLOCATION, KARES_SUPPLY } from '../src/kares_economics.ts'
import { ROYALTY_FLOOR_MIST, buyer_total } from '../src/marketplace.ts'
import { claim_marketplace_royalties, read_marketplace_royalties } from '../src/marketplace_admin.ts'
import { recipe_matches, verified_recipe_ledger } from '../src/seed_recipe_audit.ts'
import { seed_sync_view, type SeedSyncRow } from '../src/seed_sync.ts'
import { name_record_bytes } from '../src/suins_record.ts'
import rolled from '../../indexer/tests/rolled_stats.localnet.json'

import { changed, fake_client, id, pins as base_pins, sample_gas, shared_row, signer } from './helpers/transport.ts'
import pet from './fixtures/item_snapshot_pet.mainnet.json'
import policies from './fixtures/marketplace_policies.mainnet.json'
import mushroom from './fixtures/mainnet_mushroom_lacquer.json'
import rewards from './fixtures/rewards.testnet.json'
import name_record from './fixtures/suins_name_record.json'

const pins = { ...base_pins, math_package: id(2) }
const read = (path: string) => readFileSync(path, 'utf8')
const calls_of = (tx: Transaction) =>
  tx.getData().commands.flatMap((command) => (command.MoveCall ? [command.MoveCall] : []))

test('committed generated files are byte-identical to a fresh generation over the Move sources', async () => {
  expect(read(DOORS_OUT_PATH)).toBe(
    await generate_game_doors(read(API_MOVE_PATH), read(TRADE_MOVE_PATH), read(TOURNAMENT_MOVE_PATH))
  )
  expect(read(TOURNAMENT_RULES_OUT_PATH)).toBe(
    await generate_tournament_rules(read(TOURNAMENT_MOVE_PATH), read(TOURNAMENT_BRACKET_PATH))
  )
  expect(read(CHARACTER_PRICE_OUT_PATH)).toBe(await generate_character_price(read(CHARACTER_MOVE_PATH)))
  expect(read(SEED_DOORS_OUT_PATH)).toBe(await generate_seed_doors())
  expect(read(SEED_CONTRACT_OUT_PATH)).toBe(await generate_seed_contract())
})

test('the parser reads every public door, refuses what it cannot project, and the indexer skips seed doors', () => {
  const api = read(API_MOVE_PATH)
  const declared = [...api.matchAll(/^(?:public entry fun|public fun|entry fun) (\w+)/gm)].map((match) => match[1])
  expect(
    parse_doors(api)
      .map(({ name }) => name)
      .toSorted()
  ).toEqual(declared.toSorted())
  expect(() => parse_doors('public fun bad(x: u256, ctx: &mut TxContext) {}')).toThrow(/unknown Move parameter type/)
  expect(() => parse_doors('module aresrpg::api;')).toThrow(/ZERO doors/)
  expect(api).not.toMatch(/public fun trade_get_[ic]\s*\([^)]*\)\s*:\s*PurchaseCap</)
  expect(/entry fun close_fight[\s\S]*?\n}/.exec(api)?.[0]).toContain('fight::assert_close_door_open(&fight_object)')
  const loot_box = read(new URL('../../move/sources/loot_box.move', import.meta.url).pathname)
  expect(Number(/const MAX_BOX_BATCH: u32 = (\d+)/.exec(loot_box)![1])).toBe(LOOT_BOX_BATCH_LIMIT)
  expect(DOORS.register_tournament).toContain('u64? team')
  expect(DOORS.start_fight.split(',')).toContain('random')
  expect(DOORS.raise_stat.split(',')).not.toContain('random')
  const names = seed_doors().map(({ export_name, name }) => export_name ?? name)
  expect(new Set(names).size).toBe(names.length)
  expect(names).toEqual(expect.arrayContaining(['add_item', 'add_loot_reward', 'freeze_forever', 'new_item_stats']))
  const pipeline = read(new URL('../../indexer/src/pipeline.rs', import.meta.url).pathname)
  const start = pipeline.indexOf('fn is_deployment_only_target')
  const exclusions = pipeline.slice(start, pipeline.indexOf('\n}\n', start))
  const game_targets = seed_doors().filter(({ package_key }) => package_key === 'package')
  expect([start > 0, game_targets.length]).toEqual([true, 7])
  for (const { module, name } of game_targets) expect(exclusions).toContain(`"${module}::${name}"`)
})

const game = () => {
  const sdk = SDK({ client: fake_client(), signer, pins, transaction_storage: null })
  absorb_receipt(sdk.cache, {
    effects: {
      changedObjects: [
        shared_row(id(11)),
        changed(id(12), '5'),
        changed(id(13), '5'),
        changed(id(14), '5'),
        shared_row(id(15)),
        changed(id(16), '5'),
      ],
    },
  })
  return sdk
}

test('the resolver law: pinned header, pre-resolved inputs, unknown ids and missing pins throw by name', () => {
  const sdk = game()
  const tx = sdk.tx()
  sdk.doors.create_character(tx, {
    payment: id(12),
    kiosk: id(11),
    cap: id(13),
    raw_name: 'nox',
    classe: 'senshi',
    male: true,
    color_1: 1,
    color_2: 2,
    color_3: 3,
    first_world: id(14),
  })
  const [header, call] = calls_of(tx)
  expect(header).toMatchObject({ package: pins.math_package, module: 'aresrpg', function: 'aresrpg' })
  expect([call?.package, call?.module, call?.function, call?.arguments.length]).toEqual([
    pins.package,
    'api',
    'create_character',
    14,
  ])
  expect(tx.getData().inputs.filter((input) => 'UnresolvedObject' in input || 'UnresolvedPure' in input)).toEqual([])
  const kinds = tx.getData().inputs.flatMap((input) => (input.Object ? [input.Object.$kind] : []))
  expect(new Set(kinds)).toEqual(new Set(['SharedObject', 'ImmOrOwnedObject']))
  const stat = { kiosk: id(77), cap: id(13), character_id: id(13), stat: 'strength', points: 5 }
  expect(() => sdk.doors.raise_stat(tx, stat)).toThrow(/unresolved object/)
  const unpinned = SDK({
    client: fake_client(),
    pins: { ...pins, version: { id: null, shared_version: null } },
    transaction_storage: null,
  })
  absorb_receipt(unpinned.cache, { effects: { changedObjects: [shared_row(id(11)), changed(id(13), '5')] } })
  expect(() => unpinned.doors.raise_stat(unpinned.tx(), { ...stat, kiosk: id(11) })).toThrow(/missing pin "version"/)
})

test('hot potatoes chain through results and a drafted turn ends with its terminal door', async () => {
  const sdk = game()
  const tx = sdk.tx()
  const build = sdk.doors.engage_fight(tx, {
    kiosk: id(11),
    personal: id(13),
    character_id: id(13),
    zone_object: id(15),
    world_content: { objectId: id(21), initialSharedVersion: '7' },
    catalog: { objectId: id(22), initialSharedVersion: '8' },
    group_index: 0,
    access: 0,
  })
  sdk.doors.launch_fight(tx, { build: sdk.doors.add_fight_mob(tx, { build, template: id(16) }) })
  const composed = calls_of(tx).slice(1)
  expect(composed.map(({ function: name }) => name)).toEqual(['engage_fight', 'add_fight_mob', 'launch_fight'])
  expect(composed.slice(1).every(({ arguments: [first] }) => ['Result', 'NestedResult'].includes(first!.$kind))).toBe(
    true
  )

  const events = [
    { type: `${id(1)}::fight::TurnSeedUsed`, json: { fight: id(3), seat: '1', seed: '42' } },
    { type: `${id(1)}::fight::FightStarted`, json: { fight: id(3), queue: ['0', '1'] } },
  ]
  const client = fake_client({ events, gas_used: sample_gas })
  const turn_pins = { ...pins, content_root: { id: id(40), shared_version: '1' }, seed_package_original: id(41) }
  const fighter = SDK({ client, signer, pins: turn_pins, transaction_storage: null })
  const actions = fight_actions(fighter, { kiosk_cap: async () => null })
  expect(
    await actions.commit_turn({
      fight: id(3),
      actions: [
        { type: 'move', path: [2n, 3n] },
        { type: 'cast', fighter_idx: 0n, spell: 'slash', target_cell: 5n },
        { type: 'strike', fighter_idx: 0n, target_cell: 6n },
      ],
    })
  ).toEqual({ digest: client.calls.digests[0], turn_witnesses: [{ fighter: 1n, seed: 42n }] })
  const turn = calls_of(Transaction.from(client.calls.submitted[0]!)).map(({ function: name }) => name)
  expect(turn).toEqual(['aresrpg', 'move_fighter', 'cast_spell', 'weapon_strike', 'end_fight_turn'])
  expect(fighter.gas_spent_24h(`fight:${id(3)}`)).toBe(2_500_000n)
  const ready = await actions.ready_many({ fight: id(3), fighter_indices: [0n, 2n, 4n] })
  expect(ready).toMatchObject({ digest: client.calls.digests[1], started: true })
  const seats = calls_of(Transaction.from(client.calls.submitted[1]!)).map(({ function: name }) => name)
  expect(seats).toEqual(['aresrpg', 'ready_fight', 'ready_fight', 'ready_and_start_fight'])
})

// Real testnet objects captured 2026-10-02 after funded setup and two stakes/one claim.
test('captured KARES rewards objects decode with their pinned supply, reserves and stake layout', () => {
  const row = (name: string) => rewards.objects.find(({ type }) => type.includes(`::${name}<`))!
  const currency = KARES_CURRENCY_BCS.parse(fromBase64(row('Currency').bcs))
  expect([currency.decimals, currency.supply]).toEqual([9, { $kind: 'BurnOnly', BurnOnly: KARES_SUPPLY }])
  const community = COMMUNITY_POOL_BCS.parse(fromBase64(row('CommunityPool').bcs))
  expect([community.remaining, community.started_ms]).toEqual([KARES_ALLOCATION.community, 1_790_933_226_234n])
  expect(project_community_claimable(community, community.started_ms + COMMUNITY_VESTING_MS / 2n)).toBe(
    KARES_ALLOCATION.community / 2n
  )
  expect(COMBAT_POT_BCS.parse(fromBase64(row('CombatPot').bcs))).toMatchObject({
    id: row('CombatPot').object_id,
    balance: KARES_ALLOCATION.combat,
    authorized: {
      name: '4f532487e0cc336b593f79bc20b9f9220d02f8e554b754e0b5971f1dfc9e5d01::fight_rewards::BossVictory',
    },
    epoch: 1_240n,
    quota: 20_000n,
    work: 0n,
  })
  const pool = STAKING_POOL_BCS.parse(fromBase64(row('StakingPool').bcs))
  const positions = rewards.objects
    .filter(({ type }) => type.includes('::StakePosition<'))
    .map(({ bcs }) => STAKE_POSITION_BCS.parse(fromBase64(bcs)))
  expect(pool.principal).toBe(150_000_000_000_000n)
  expect(positions.reduce((sum, position) => sum + position.amount, 0n)).toBe(pool.principal)
  expect([pool.initial_released, pool.kares_rewards, pool.buckets.length]).toEqual([
    191_251_902_587n,
    KARES_ALLOCATION.rewards - 191_251_902_586n,
    31,
  ])
})

test('captured item snapshots: rolled stats decode exactly and a never-fed mainnet pet has zero power', async () => {
  // getDynamicField returns the value without the captured Field UID (32 bytes) and marker key (1).
  const stats = fromHex(rolled.bcs_hex).subarray(33)
  const item = {
    objectId: '0xhat',
    type: '0xgame::item::Item',
    json: { name: 'Fuwa Hat', item_type: 'fuwa_hat', category: 'hat', level: 12 },
  }
  const client = (bcs: Uint8Array, object = item) => ({
    core: {
      getObjects: async () => ({ objects: [object] }),
      listDynamicFields: async () => ({
        dynamicFields: [{ name: { type: '0xgame::item::StatsKey', bcs: new Uint8Array([0]) } }],
      }),
      getDynamicField: async () => ({ dynamicField: { value: { bcs } } }),
    },
  })
  expect(await read_item_snapshot(client(stats) as never, '0xgame', '0xhat')).toMatchObject({
    name: 'Fuwa Hat',
    level: 12,
    stats: { strength: 32_772, wisdom: 32_779 },
  })
  await expect(read_item_snapshot(client(stats.subarray(0, 30)) as never, '0xgame', '0xhat')).rejects.toThrow()
  await expect(
    read_item_snapshot(client(stats, { ...item, type: '0xother::item::Item' }) as never, '0xgame', '0xhat')
  ).rejects.toThrow()
  // Public mainnet Item; its id, version and capture timestamp are retained in the fixture.
  const captured = {
    core: {
      getObjects: async () => ({ objects: [pet.item] }),
      listDynamicFields: async () => ({
        dynamicFields: pet.fields.map(({ name }) => ({ name: { type: name.type, bcs: fromHex(name.bcs_hex) } })),
      }),
      getDynamicField: async ({ name }: { name: { type: string } }) => ({
        dynamicField: {
          value: { bcs: fromHex(pet.fields.find((field) => field.name.type === name.type)!.value_bcs_hex) },
        },
      }),
    },
  }
  expect(await read_item_snapshot(captured as never, pet.item.type.split('::')[0]!, pet.item.objectId)).toMatchObject({
    pet_power: 0,
    category: 'pet',
  })
})

test('the captured SuiNS name record re-encodes byte for byte and every field change is visible', () => {
  expect(Buffer.from(name_record_bytes(name_record.record)).toString('base64')).toBe(name_record.option_bcs_base64)
  expect([...name_record_bytes(null)]).toEqual([0])
  const { record } = name_record
  for (const other of [
    null,
    { ...record, data: { ...record.data, avatar: 'changed' } },
    { ...record, nftId: '0x1' },
    { ...record, targetAddress: '0x2' },
    { ...record, expirationTimestampMs: record.expirationTimestampMs + 1 },
  ])
    expect(name_record_bytes(other)).not.toEqual(name_record_bytes(record))
})

test('royalties: captured policies decode, the predicted floor is the live one, and a claim splits certified amounts', async () => {
  // Captured from mainnet on 2026-11-19: the `royalty_rule::Rule` config of both transfer policies.
  const live_rule = { amount_bp: 1000, min_amount: '1000000' } as const
  expect([ROYALTY_FLOOR_MIST, marketplace_royalty_bps, basis_points]).toEqual([
    BigInt(live_rule.min_amount),
    live_rule.amount_bp,
    10_000,
  ])
  expect([buyer_total(2_000_000n), buyer_total(10_000_000n), buyer_total(1_000_000_000n)]).toEqual([
    3_000_000n,
    11_000_000n,
    1_100_000_000n,
  ])
  const address = id(200)
  const [item, character] = policies.objects
  const captured = await read_marketplace_royalties(
    {
      game_type_package: '0x427af9b0d1cc5145a5112bd5b473dd615d48b5389de296eb7c512afdec160e1d',
      pins: { item_policy: { id: item!.objectId }, character_policy: { id: character!.objectId } },
      get_owned_transfer_policies: async () => [],
      sui_client: { core: { getObjects: async () => ({ objects: [...policies.objects].reverse() }) } },
    } as never,
    address
  )
  expect(captured.map(({ balance_mist, cap }) => [balance_mist, cap])).toEqual([
    [3600000000n, null],
    [0n, null],
  ])

  const kares = id(88)
  const types = { item: `${id(31)}::item::Item`, character: `${id(31)}::character::Character` }
  const caps = [
    { type: types.item, policyId: id(33), policyCapId: id(55) },
    { type: types.character, policyId: id(34), policyCapId: id(56) },
  ]
  const executed: Transaction[] = []
  const admin = (
    owned = caps,
    objects: unknown[] = [
      {
        objectId: id(33),
        type: `0x2::transfer_policy::TransferPolicy<${types.item}>`,
        json: { balance: '2500000000' },
      },
      {
        objectId: id(34),
        type: `0x2::transfer_policy::TransferPolicy<${types.character}>`,
        json: { balance: '500000000' },
      },
    ]
  ) => ({
    game_type_package: id(31),
    pins: {
      package: id(77),
      item_policy: { id: id(33), shared_version: '1' },
      character_policy: { id: id(34), shared_version: '1' },
      kares_rewards_package: kares,
      kares_rewards_package_original: kares,
      kares_coin_type: `${kares}::kares::KARES`,
      kares_currency: { id: id(90), shared_version: '1' },
      kares_economy: { id: id(91), shared_version: '1' },
      kares_staking_pool: { id: id(92), shared_version: '1' },
      kares_combat_pot: { id: id(93), shared_version: '1' },
      kares_community_pool: { id: id(94), shared_version: '1' },
    },
    get_owned_transfer_policies: async () => owned,
    sui_client: { core: { getObjects: async () => ({ objects }) } },
    tx: () => new Transaction(),
    hydrate_unknown: async () => undefined,
    door_context: { obj: (transaction: Transaction, object: string) => transaction.object(object) },
    execute: async (transaction: Transaction) => {
      executed.push(transaction)
      return {
        digest: 'royalty',
        Transaction: {
          events: [{ type: `${kares}::staking::RoyaltyFunded`, json: { amount: '5000000000', staking: '1000000000' } }],
        },
      }
    },
  })
  expect(await claim_marketplace_royalties(admin() as never, address)).toEqual({
    digest: 'royalty',
    amount_mist: 5_000_000_000n,
    staking_mist: 1_000_000_000n,
    treasury_mist: 4_000_000_000n,
    policies: ['item', 'character'],
  })
  expect(calls_of(executed[0]!).map(({ function: name }) => name)).toEqual(['withdraw', 'withdraw', 'fund_royalties'])
  await expect(claim_marketplace_royalties(admin(caps.slice(0, 1)) as never, address)).rejects.toThrow(
    'character TransferPolicyCap'
  )
  for (const objects of [
    [{ objectId: id(33), type: 'wrong', json: { balance: '1' } }],
    [new Error('Policy RPC unavailable')],
  ])
    await expect(read_marketplace_royalties(admin(caps, objects) as never, address)).rejects.toThrow()
  expect(executed).toHaveLength(1)
})

// Public mainnet recipe 0xa5c95e…bbb9, version 855012001, captured 2026-09-14.
test('the captured mushroom lacquer recipe audits a seed ledger against live chain contents', () => {
  const { object } = mushroom
  const expected = {
    output_type: 'mushroom_lacquer',
    output_template: object.json.data.output_template,
    input_templates: object.json.data.inputs.map(({ template }) => template),
    input_quantities: [1, 1],
    job: 'ALCHEMIST',
  }
  const row: SeedSyncRow = {
    key: object.objectId,
    chain_id: object.objectId,
    addresses: [object.objectId],
    hydrate: [object.objectId],
    label: 'recipe mushroom_lacquer',
    kind: 'template',
    domain: 'recipe',
    hash: 'new-recipe-hash',
    recipe: expected,
  }
  const revision = `${object.version}:${object.digest}`
  const ledger = { [row.key]: { hash: row.hash, label: row.label, revisions: { [row.key]: revision } } }
  expect(
    seed_sync_view(
      [row],
      ledger,
      () => true,
      0,
      () => revision
    ).unchanged
  ).toBe(1)
  const verified = verified_recipe_ledger([row], ledger, [object])
  expect(
    seed_sync_view(
      [row],
      verified,
      () => true,
      0,
      () => revision
    ).changed
  ).toEqual([row])
  const json = {
    ...object.json,
    data: { ...object.json.data, inputs: object.json.data.inputs.map((input) => ({ ...input, quantity: '1' })) },
  }
  expect([recipe_matches(expected, json), recipe_matches(expected, { ...json, active: false })]).toEqual([true, false])
  expect(verified_recipe_ledger([row], ledger, [{ ...object, json }])).toEqual(ledger)
  expect(() => verified_recipe_ledger([row], ledger, [])).toThrow('read is missing')
  expect(() => verified_recipe_ledger([row], ledger, [{ ...object, version: '1' }])).toThrow(
    'older than its certified revision'
  )
})
