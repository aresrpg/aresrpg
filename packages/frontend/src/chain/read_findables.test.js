import { afterAll, expect, spyOn, test } from 'bun:test'

import * as rpc_client from '../rpc/client'

import * as chain_sdk from './sdk'

const encyclopedia_calls = []
const get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia').mockImplementation(async (...args) => {
  encyclopedia_calls.push(args)
  return {
    items: [
      {
        template_id: '0xbox',
        item_type: 'pet_lootbox',
        name: 'Pet Lootbox',
        description: 'A box with one pet inside.',
        level: 1,
        category: 'consumable',
        supply: 3,
        last_sale_mist: '1000000000',
      },
    ],
    mobs: [],
    worlds: [],
    recipes: [],
  }
})
const get_sdk = spyOn(chain_sdk, 'get_sdk').mockImplementation(async () => {
  throw new Error('chain-direct template reads are forbidden')
})

afterAll(() => {
  get_encyclopedia.mockRestore()
  get_sdk.mockRestore()
})

const { get_template_by_item_type_map, get_template_map } = await import('./read_findables.js')

test('template maps resolve exact lootbox identity from the /v1 encyclopedia projection', async () => {
  const by_id = await get_template_map()
  const by_type = await get_template_by_item_type_map()

  expect(get_sdk).not.toHaveBeenCalled()
  expect(encyclopedia_calls).toEqual([['items']])
  expect(by_id.get('0xbox')).toEqual({
    id: '0xbox',
    item_type: 'pet_lootbox',
    name: 'Pet Lootbox',
    category: 'CONSUMABLE',
    level: 1,
    statsJson: '{}',
    display: null,
  })
  expect(by_type.get('pet_lootbox')?.id).toBe('0xbox')
})
