import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { prepare_boss_rewards, prepare_trade_close, read_rewards_economy } from '../src/kares_economy.ts'

import { kares_test_client, kares_test_pins } from './helpers/kares.ts'
import { id } from './helpers/transport.ts'

test.each([false, true])('boss preparation follows on-chain funding without an activation pin: %s', async (funded) => {
  const { client, state } = kares_test_client()
  state.objects[0]!.json.token = funded ? `${id(999)}::external::TOKEN` : ''
  const calls: unknown[] = []
  const sdk = {
    pins: {
      kares_economy: kares_test_pins.kares_economy,
      kares_rewards_package_original: kares_test_pins.kares_rewards_package_original,
    },
    sui_client: client,
    hydrate_unknown: async (ids: string[]) => {
      calls.push(ids)
    },
    doors: {
      prepare_boss_rewards_token: (_tx: Transaction, args: unknown) => {
        calls.push(['funded', args])
      },
      prepare_boss_rewards_unfunded: (_tx: Transaction, args: unknown) => {
        calls.push(['unfunded', args])
      },
    },
  }
  const compose = await prepare_boss_rewards(sdk as never)
  compose(new Transaction(), id(10), 3n)
  expect(calls).toEqual(
    funded
      ? [
          [kares_test_pins.kares_combat_pot.id],
          [
            'funded',
            {
              fight_object: id(10),
              fighter_idx: 3n,
              coin_type: `${id(999)}::external::TOKEN`,
              pot: kares_test_pins.kares_combat_pot.id,
            },
          ],
        ]
      : [['unfunded', { fight_object: id(10), fighter_idx: 3n }]]
  )
})

test('missing or foreign economy reads cannot silently disable payouts', async () => {
  const { client, state } = kares_test_client()
  const sdk = { pins: kares_test_pins, sui_client: client }
  state.objects[0]!.json.id = id(999)
  await expect(read_rewards_economy(sdk as never)).rejects.toThrow('UID')
  await expect(prepare_trade_close(sdk as never)).rejects.toThrow('UID')
  state.objects[0]!.type = `${id(999)}::economy::Economy`
  await expect(read_rewards_economy(sdk as never)).rejects.toThrow('canonical')
  await expect(prepare_trade_close(sdk as never)).rejects.toThrow('canonical')
  state.objects = []
  await expect(read_rewards_economy(sdk as never)).rejects.toThrow('canonical')
  await expect(prepare_trade_close(sdk as never)).rejects.toThrow('canonical')
})

test('funded trade closure uses the bound token even when local token configuration is wrong', async () => {
  const { client } = kares_test_client()
  const calls: unknown[] = []
  const sdk = {
    pins: { ...kares_test_pins, kares_coin_type: `${id(999)}::fake::KARES` },
    sui_client: client,
    doors: {
      trade_close_token: (_tx: Transaction, args: unknown) => {
        calls.push(args)
      },
      trade_close: () => {
        throw new Error('A funded trade must drain its token field')
      },
    },
  }
  const close = await prepare_trade_close(sdk as never)
  close(new Transaction(), id(10))
  expect(calls).toEqual([{ trade: id(10), coin_type: kares_test_pins.kares_coin_type }])
})
