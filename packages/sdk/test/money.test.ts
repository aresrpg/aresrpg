// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every composer that moves SUI, items or tokens, driven through the real SDK over the fake chain and
// read back from the submitted bytes: amounts, recipients, caps and refusals before any signature.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import type { TradeCapRow, TradeRow } from '@aresrpg/protocol'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, SUI_TYPE_ARG } from '@mysten/sui/utils'

import {
  blast_purchase_actions,
  create_blast_claim_transaction,
  create_blast_purchase_transaction,
} from '../src/blast_purchase.ts'
import {
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_NAME_MIN_LENGTH,
  CHARACTER_PRICE_MIST,
  character_claim_id,
  character_create,
  character_id,
  normalize_character_name,
} from '../src/character.ts'
import { character_actions } from '../src/character_actions.ts'
import { SDK } from '../src/client.ts'
import { CHARACTER_FUNDING_MIST, GAS_BUDGET_MIST } from '../src/gas_budget.ts'
import { marketplace_actions } from '../src/marketplace.ts'
import { item_template_id, recipe_id } from '../src/seed_ids.ts'
import { sui_transfer_actions, sui_transfer_ptb } from '../src/sui_transfer.ts'
import { trade_actions, trade_create, trade_is_drained } from '../src/trade.ts'

import captured_sale from './fixtures/blast_presale.mainnet.json' with { type: 'json' }
import blast_live from './fixtures/blast_presale_live.mainnet.json' with { type: 'json' }
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
  kares_rewards_package_original: id(17),
}
const kiosk_cap = (kiosk = id(4)): KioskOwnerCap => ({
  objectId: id(Number(BigInt(kiosk) % 256n) + 300),
  kioskId: kiosk,
  isPersonal: true,
  version: '1',
  digest,
})
const game = (client: FakeClient = fake_client({ gas_used: sample_gas })) => ({
  client,
  sdk: SDK({ client, signer, pins: game_pins, transaction_storage: null }),
})
const submitted = (client: FakeClient, index = -1) => Transaction.from(client.calls.submitted.at(index)!)
const targets = (tx: Transaction) =>
  tx.getData().commands.flatMap(({ MoveCall }) => (MoveCall ? [`${MoveCall.module}::${MoveCall.function}`] : []))
const pure = (tx: Transaction, length: number) =>
  tx
    .getData()
    .inputs.flatMap(({ Pure }) => (Pure && fromBase64(Pure.bytes).length === length ? [fromBase64(Pure.bytes)] : []))
const u64s = (tx: Transaction) => pure(tx, 8).map((bytes) => BigInt(bcs.u64().parse(bytes)))
const addresses = (tx: Transaction) => pure(tx, 32).map((bytes) => bcs.Address.parse(bytes))

test('a marketplace buy proves every rule, pays ask and royalty from one finite coin and refuses a low cap', async () => {
  const { client, sdk } = game()
  const actions = marketplace_actions(sdk, { address: signer.toSuiAddress(), kiosk_cap: async () => kiosk_cap() })
  await actions.buy({
    kind: 'item',
    id: id(40),
    kiosk: id(41),
    price_mist: 1_000_000_000n,
    max_total_mist: 1_200_000_000n,
    existing: id(42),
    destination_kiosk: id(4),
  })
  const item = submitted(client)
  const calls = targets(item)
  expect(calls.indexOf('lot_rule::prove')).toBeLessThan(calls.indexOf('kiosk::lock'))
  expect(calls).toEqual(
    expect.arrayContaining([
      'listing_rule::prove',
      'royalty_rule::pay',
      'kiosk_lock_rule::prove',
      'personal_kiosk_rule::prove',
    ])
  )
  expect(calls.indexOf('transfer_policy::confirm_request')).toBeLessThan(calls.lastIndexOf('api::merge_stacks'))
  const { commands } = item.getData()
  const capped = commands.findIndex(({ SplitCoins }) => SplitCoins?.coin.$kind === 'GasCoin')
  const finite = commands.flatMap(({ SplitCoins }) =>
    SplitCoins && SplitCoins.coin.$kind !== 'GasCoin' ? [SplitCoins.coin] : []
  )
  expect(finite.length).toBeGreaterThan(1)
  expect(finite.every((coin) => coin.$kind === 'NestedResult' && coin.NestedResult[0] === capped)).toBe(true)
  expect(commands.find(({ MergeCoins }) => MergeCoins?.destination.$kind === 'GasCoin')?.MergeCoins?.sources).toEqual([
    { $kind: 'NestedResult', NestedResult: [capped, 0] },
  ])
  expect(u64s(item)).toEqual(expect.arrayContaining([1_000_000_000n, 1_200_000_000n]))

  await actions.buy({ kind: 'character', id: id(43), kiosk: id(44), price_mist: 2_000_000_000n })
  const character = targets(submitted(client))
  expect(character.indexOf('kiosk::borrow_val')).toBeLessThan(character.indexOf('naked_rule::prove'))
  expect(character.lastIndexOf('transfer_policy::confirm_request')).toBeGreaterThan(
    character.indexOf('kiosk::return_val')
  )
  const { executions } = client.calls
  await expect(
    actions.buy({ kind: 'item', id: id(40), kiosk: id(41), price_mist: 10n, max_total_mist: 9n })
  ).rejects.toThrow('Marketplace cap is below the ask.')
  expect(client.calls.executions).toBe(executions)

  const listed = game(fake_client({ created: { [id(45)]: `${id(1)}::item::Item` } }))
  const lots = marketplace_actions(listed.sdk, { address: signer.toSuiAddress(), kiosk_cap: async () => kiosk_cap() })
  const receipt = await lots.list({
    kind: 'item',
    id: id(40),
    kiosk: id(4),
    price_mist: 1_000_000_000n,
    amount: 10,
    source_amount: 57,
    merge_sources: [id(46)],
  })
  expect(receipt.listed_id).toBe(id(45))
  const listing = targets(submitted(listed.client))
  expect(listing.indexOf('api::merge_stacks')).toBeLessThan(listing.indexOf('api::split_stack'))
  expect(listing).toContain('kiosk::list')
  await expect(
    lots.list({ kind: 'item', id: id(40), kiosk: id(4), price_mist: 1n, amount: 7, source_amount: 57 })
  ).rejects.toThrow('1, 10, 100, or 1000')
})

const me = signer.toSuiAddress()
const other = id(8)
const trade_row = (overrides: Partial<TradeRow> = {}): TradeRow => ({
  id: id(21),
  a: me,
  b: other,
  phase: 'negotiating',
  offer_revision: 4,
  accept_a: false,
  accept_b: false,
  sui_a: '1000',
  sui_b: '0',
  kares_a: '0',
  kares_b: '0',
  caps_a: [],
  caps_b: [],
  ...overrides,
})
const item_cap = (object: number, item_type = 'wool', kiosk = 31): TradeCapRow => ({
  object: id(object),
  name: item_type,
  level: 1,
  amount: 10,
  item_type,
  category: 'resource',
  kiosk: id(kiosk),
})
const economy = (funded: boolean) => ({
  [id(16)]: {
    objectId: id(16),
    version: '1',
    digest,
    type: `${id(17)}::economy::Economy`,
    owner: { $kind: 'Shared' as const, Shared: { initialSharedVersion: '1' } },
    json: {
      id: id(16),
      token: funded ? game_pins.kares_coin_type : '',
      currency: id(18),
      staking_pool: id(19),
      combat_pot: id(22),
      community_pool: id(23),
      started_ms: '0',
    },
  },
})
const trading = (row: TradeRow, funded = true) => {
  const { client, sdk } = game(fake_client({ objects: economy(funded) }))
  return {
    client,
    actions: trade_actions(sdk, { trade: row, address: me, kiosk_cap: async (kiosk) => kiosk_cap(kiosk) }),
  }
}

test('trade escrow pins the rendered revision, settles once without the gas coin and recovers a whole offer', async () => {
  const offered = item_cap(30, 'old', 31)
  const commit = trading(trade_row({ caps_a: [offered] }))
  const item = {
    id: id(40),
    name: 'Wool',
    level: 1,
    amount: 10,
    item_type: 'wool',
    category: 'resource',
    kiosk: id(31),
  }
  expect(
    (
      await commit.actions.commit_offer({
        additions: [{ item, amount: 4 }],
        removals: [{ cap: offered }],
        sui: 1250n,
        kares: 0n,
      })
    ).offer_revision
  ).toBe(7)
  const offer = submitted(commit.client)
  expect(targets(offer)).toEqual(
    expect.arrayContaining([
      'api::trade_take_item',
      'api::split_stack',
      'api::trade_put_item',
      'trade::put_sui',
      'kiosk::list_with_purchase_cap',
    ])
  )
  const split = offer.getData().commands.findIndex(({ MoveCall }) => MoveCall?.function === 'split_stack')
  expect(
    offer.getData().commands.find(({ MoveCall }) => MoveCall?.function === 'list_with_purchase_cap')?.MoveCall
      ?.arguments[2]
  ).toEqual({ $kind: 'Result', Result: split })
  expect(u64s(offer)).toEqual(expect.arrayContaining([4n, 5n, 6n, 250n]))
  await commit.actions.accept()
  expect([targets(submitted(commit.client)), u64s(submitted(commit.client))]).toEqual([
    expect.arrayContaining(['trade::accept']),
    expect.arrayContaining([4n]),
  ])

  const [wool, ore, dust] = [item_cap(30, 'wool', 31), item_cap(32, 'ore', 32), item_cap(34, 'wool', 33)]
  const settle = trading(trade_row({ phase: 'settling', offer_revision: 5, sui_b: '500', caps_b: [wool, ore, dust] }))
  const settled = await settle.actions.settle_all({ [ore.object]: { id: id(41), kiosk: id(5) } })
  expect(settled.delta).toEqual({
    trade: id(21),
    phase: 'settling',
    offer_revision: 5,
    remove_caps: [id(30), id(32), id(34)],
    clear_balances: 'b',
    closed: false,
  })
  const claims = submitted(settle.client)
  expect(targets(claims).filter((target) => target === 'api::trade_claim_item')).toHaveLength(3)
  expect(targets(claims).filter((target) => target === 'api::merge_stacks')).toHaveLength(2)
  expect(JSON.stringify(claims.getData().commands.filter(({ TransferObjects }) => TransferObjects))).not.toContain(
    'GasCoin'
  )

  const cancel = trading(trade_row({ caps_a: [item_cap(30)], caps_b: [item_cap(31)], sui_a: '500' }))
  expect((await cancel.actions.cancel_and_recover()).delta).toMatchObject({
    phase: 'cancelled',
    remove_caps: [id(30)],
    clear_balances: 'a',
    closed: false,
  })
  expect(targets(submitted(cancel.client))).toEqual(
    expect.arrayContaining(['trade::cancel', 'api::trade_recover_item', 'trade::recover_sui'])
  )

  const tokens = trade_row({ phase: 'settling', sui_a: '0', kares_a: '7', kares_b: '9' })
  expect([
    trade_is_drained(trade_row()),
    trade_is_drained(trade_row({ sui_a: '0' })),
    trade_is_drained(tokens),
  ]).toEqual([false, true, false])
  const kares = trading(tokens)
  expect((await kares.actions.settle_all({})).delta).toMatchObject({ clear_balances: 'b', closed: false })
  expect(targets(submitted(kares.client))).toEqual(expect.arrayContaining(['trade::claim_token']))
  const unfunded = trading(trade_row({ phase: 'cancelled' }), false)
  expect((await unfunded.actions.recover_all()).delta.closed).toBe(true)
  expect(targets(submitted(unfunded.client))).toContain('trade::close')

  const create = game(fake_client({ objects: economy(true), created: { [id(23)]: `${id(1)}::trade::Trade` } }))
  await trade_create(create.sdk, { address: me, counterparty: other, cleanup: [id(21)] })
  expect(targets(submitted(create.client))).toEqual(['trade::close_token', 'trade::create'])
})

test('a SUI transfer moves the exact amount to the exact recipient, MAX moves the gas coin, zero is refused', async () => {
  const exact = sui_transfer_ptb({ sender: id(1), recipient: id(2), amount_mist: 1_234_567n })
  expect([exact.getData().commands.map(({ $kind }) => $kind), u64s(exact), addresses(exact)]).toEqual([
    ['SplitCoins', 'TransferObjects'],
    [1_234_567n],
    [id(2)],
  ])
  const max = sui_transfer_ptb({ sender: id(1), recipient: id(2), amount_mist: null })
  expect([max.getData().commands.map(({ $kind }) => $kind), u64s(max), addresses(max)]).toEqual([
    ['TransferObjects'],
    [],
    [id(2)],
  ])
  expect(() => sui_transfer_ptb({ sender: id(1), recipient: id(2), amount_mist: 0n })).toThrow('positive')
  const { client, sdk } = game()
  let current = true
  const actions = sui_transfer_actions(sdk, me, () => {
    if (!current) throw new Error('changed')
  })
  expect(await actions.estimate_sui_transfer(id(4), 123n, false)).toBeGreaterThan(0n)
  await actions.send_sui(id(4), 123n, false)
  const sent = submitted(client)
  expect([sent.getData().sender, u64s(sent), addresses(sent)]).toEqual([me, [123n], [id(4)]])
  await expect(actions.send_sui('invalid', 1n, false)).rejects.toThrow('valid Sui address')
  current = false
  await expect(actions.send_sui(id(4), 123n, false)).rejects.toThrow('changed')
  expect(client.calls.executions).toBe(1)
})

test('a Blast commitment carries its proof and version guard; a claim is refused before the sale ends', async () => {
  const config = {
    id: id(1),
    package: id(2),
    package_original: id(2),
    package_version: id(3),
    coin_type: `${id(4)}::kares::KARES`,
    url: 'https://www.blast.fun/',
  }
  for (const method of ['open', 'uncapped', 'allowlisted'] as const) {
    const intent =
      method === 'allowlisted'
        ? { method, amount: 125n, proof: { index: '0', cap_mist: '125', siblings: [] } }
        : { method, amount: 125n }
    const data = create_blast_purchase_transaction(config, id(5), intent).getData()
    const call = data.commands.find(({ MoveCall }) => MoveCall)!.MoveCall!
    expect([data.sender, call.function, call.arguments.length, data.commands.at(-1)?.$kind]).toEqual([
      id(5),
      `commit_${method}`,
      method === 'allowlisted' ? 7 : 4,
      'TransferObjects',
    ])
    expect(call.typeArguments.map(normalizeStructTag)).toEqual([
      normalizeStructTag(config.coin_type),
      normalizeStructTag(SUI_TYPE_ARG),
    ])
  }
  expect(() => create_blast_purchase_transaction(config, id(5), { method: 'open', amount: 0n })).toThrow('positive')
  expect(() =>
    create_blast_purchase_transaction(config, id(5), {
      method: 'allowlisted',
      amount: 1n,
      proof: { index: '65536', cap_mist: '10', siblings: [] },
    })
  ).toThrow('proof index')
  expect(create_blast_claim_transaction(config, id(5)).getData().commands).toHaveLength(1)
  const sale = {
    ...captured_sale.objects[0],
    objectId: config.id,
    type: normalizeStructTag(`${config.package_original}::blast_presale::Presale<${config.coin_type},${SUI_TYPE_ARG}>`),
    json: { ...captured_sale.objects[0].json, lifecycle: { '@variant': 'Open' }, start_ms: '0', duration_ms: '10000' },
  }
  const client = {
    network: 'mainnet',
    core: {
      getObjects: async () => ({
        objects: [
          sale,
          { objectId: id(6), owner: { $kind: 'Shared' }, type: '0x2::clock::Clock', json: { timestamp_ms: '1' } },
        ],
      }),
      getObject: async () => ({
        object: {
          owner: { $kind: 'Shared' },
          type: `${id(9)}::package_version::PackageVersion<${config.package_original}::blast_presale_package::BLAST_PRESALE_PACKAGE>`,
        },
      }),
    },
  }
  const executed: string[] = []
  const receipt = {
    $kind: 'Transaction',
    Transaction: {
      digest: 'certified',
      effects: { status: { success: true }, gasUsed: { computationCost: '10', storageCost: '20', storageRebate: '5' } },
    },
  }
  const sdk = {
    pins: { network: 'mainnet', kares_coin_type: config.coin_type, blast_presale: config },
    simulate: async () => receipt,
    execute: async (tx: Transaction) => {
      executed.push(tx.getData().commands.find(({ MoveCall }) => MoveCall)!.MoveCall!.function)
      return receipt
    },
  }
  const actions = blast_purchase_actions({ sdk, client, address: id(5) } as never)
  expect((await actions.simulate({ method: 'open', amount: 10n })).amount_mist).toBe(10n)
  await actions.purchase({ method: 'open', amount: 10n })
  await expect(actions.claim()).rejects.toThrow('claims are not open')
  sale.json.lifecycle = { '@variant': 'Migrated' }
  await expect(actions.purchase({ method: 'open', amount: 10n })).rejects.toThrow('not open')
  await actions.claim()
  expect(executed).toEqual(['commit_open', 'claim'])

  // Mainnet objects 0x247165…2b57e (version 1099635701) and 0xd9523c…3ba7 (version 1063892806), captured
  // 2026-11-20: Blast's live deployment shares a generic PackageVersion<…BLAST_PRESALE_PACKAGE>.
  const [live_sale, live_version] = blast_live.objects
  const blast_package = live_sale!.type.split('::')[0]!
  const live_type = normalizeStructTag(`${blast_package}::blast_presale::Presale<${config.coin_type},${SUI_TYPE_ARG}>`)
  const versioned = (version: unknown, package_original = blast_package) =>
    blast_purchase_actions({
      sdk: { ...sdk, pins: { ...sdk.pins, blast_presale: { ...config, package: blast_package, package_original } } },
      client: {
        network: 'mainnet',
        core: {
          getObjects: async () => ({
            objects: [
              {
                ...live_sale,
                objectId: config.id,
                type: live_type.replace(blast_package, package_original),
                json: { ...live_sale!.json, lifecycle: { '@variant': 'Open' }, start_ms: '0', duration_ms: '10000' },
              },
              { objectId: id(6), owner: { $kind: 'Shared' }, type: '0x2::clock::Clock', json: { timestamp_ms: '1' } },
            ],
          }),
          getObject: async () => ({ object: version }),
        },
      },
      address: id(5),
    } as never)
  expect((await versioned(live_version).simulate({ method: 'open', amount: 10n })).amount_mist).toBe(10n)
  await expect(versioned(live_version, id(2)).simulate({ method: 'open', amount: 10n })).rejects.toThrow(
    'another package'
  )
  await expect(
    versioned({ ...live_version, owner: { $kind: 'AddressOwner', AddressOwner: id(5) } }).simulate({
      method: 'open',
      amount: 10n,
    })
  ).rejects.toThrow('another package')
})

test('a hero costs its price plus the gas reserve and a craft receipt must match the submitted batch', async () => {
  expect(CHARACTER_FUNDING_MIST).toBe(CHARACTER_PRICE_MIST + GAS_BUDGET_MIST)
  const character_move = readFileSync(new URL('../../move/sources/character.move', import.meta.url), 'utf8')
  expect(character_move).toContain(
    `name.length() > ${CHARACTER_NAME_MIN_LENGTH - 1} && name.length() < ${CHARACTER_NAME_MAX_LENGTH + 1}`
  )
  expect(character_id('0x2', '  AiDeN  ')).toBe('0x55b378d77ba06f8f5822d4b4f16ae3eb8b565ca0e9853b1bda4ff6d8935abce9')
  expect(character_claim_id('0x2', 'aiden')).toBe('0xd00bfc963baa398d636f64bad0a43e46b9b368836dcbda1c7c1026e247f7c2d3')
  expect(() => normalize_character_name('with space')).toThrow()
  const created = { [id(70)]: '0x2::kiosk::Kiosk', [id(71)]: `${id(5)}::personal_kiosk::PersonalKioskCap` }
  const events = [{ type: `${id(1)}::character::CharacterCreated`, json: { character: id(72) } }]
  const { client, sdk } = game(fake_client({ created, events }))
  const hero = { name: ' AiDeN ', classe: 'senshi', male: true, color_1: 1, color_2: 2, color_3: 3, kiosk_cap: null }
  await expect(character_create(sdk, { ...hero, name: 'Sceat 6' }, 'nauvis')).rejects.toThrow('4–19')
  expect(client.calls.executions).toBe(0)
  expect(await character_create(sdk, hero, 'nauvis')).toMatchObject({
    character_id: id(72),
    kiosk_cap: { objectId: id(71), kioskId: id(70) },
  })
  const mint = submitted(client)
  expect(targets(mint)).toContain('api::create_character')
  expect(u64s(mint)).toContain(CHARACTER_PRICE_MIST)
  expect(pure(mint, 6).map((bytes) => bcs.String.parse(bytes))).toContain('aiden')
  await expect(character_create(game().sdk, { ...hero, kiosk_cap: kiosk_cap() }, 'nauvis')).rejects.toThrow(
    'CharacterCreated'
  )

  const crafted = (overrides: Record<string, unknown> = {}) => [
    {
      type: `${id(1)}::crafting::Crafted`,
      json: {
        recipe: recipe_id(id(61), id(60), 'wheat_flour'),
        character: id(20),
        crafter: id(70),
        output_template: item_template_id(id(61), id(60), 'wheat_flour'),
        attempts: 100,
        successes: 63,
        job_xp_gained: '2500',
        ...overrides,
      },
    },
  ]
  const craft = {
    character_id: id(20),
    output_type: 'wheat_flour',
    input_item_ids: [id(31), id(32)],
    existing: id(33),
    attempts: 100,
    custody: { kiosk: id(4), kiosk_cap: kiosk_cap().objectId },
  }
  const crafter = game(fake_client({ events: crafted() }))
  const actions = character_actions(crafter.sdk, { kiosk_cap: async () => kiosk_cap() })
  expect(await actions.craft(craft)).toMatchObject({ attempts: 100, successes: 63, job_xp_gained: 2500 })
  expect(targets(submitted(crafter.client)).at(-1)).toBe('api::craft')
  await expect(actions.craft({ ...craft, attempts: 1_001 })).rejects.toThrow('1 to 1000')
  for (const forged of [crafted({ attempts: 99 }), crafted({ successes: 101 }), crafted({ character: id(21) })]) {
    const mismatch = game(fake_client({ events: forged }))
    await expect(character_actions(mismatch.sdk, { kiosk_cap: async () => kiosk_cap() }).craft(craft)).rejects.toThrow(
      'did not match'
    )
  }
})
