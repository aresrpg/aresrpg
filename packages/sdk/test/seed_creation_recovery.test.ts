// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { SDK, type SuiTransport } from '../src/client.ts'
import { create_seed_admin } from '../src/seed_admin.ts'
import type { SeedContent } from '../src/seed.ts'
import { giftcard_claim_id, giftcard_id, item_template_id } from '../src/seed_ids.ts'
import { seed_ledger_after_batch, seed_sync_rows } from '../src/seed_sync.ts'

const id = normalizeSuiAddress
const root = id('0x10')
const game = id('0x11')
const seed = id('0x12')
const admin = id('0x13')
const custody = id('0x14')
const card = giftcard_id(root, game, 'one')
const template = item_template_id(root, seed, 'ore')
const claim = giftcard_claim_id(root, card)
const content: SeedContent = {
  items: [{ item_type: 'ore', name: 'Ore', category: 'resource', level: 1 }],
  spells: [],
  mobs: [],
  recipes: [],
  dungeons: [],
  worlds: [],
  biome_maps: [],
  boards: [],
  mastery: { offers: [] },
  airdrop: { giftcards: [{ id: 'one', campaign: 'ore', item_type: 'ore', amount: 5, custody }] },
}
const fixture = async (authored = content) => {
  const receipt = {
    Transaction: {
      digest: 'ISSUED',
      effects: {
        status: { success: true },
        changedObjects: [
          {
            objectId: card,
            idOperation: 'Created',
            outputOwner: { AddressOwner: custody },
          },
        ],
      },
      objectTypes: { [card]: `${game}::distribution::Giftcard` },
      events: [{ eventType: `${game}::distribution::GiftcardMinted`, json: { giftcard: card, template, amount: 5 } }],
    },
  }
  const existing = new Set([root, admin, template, claim])
  const sdk = SDK({
    network: 'testnet',
    address: custody,
    pins: {
      package: game,
      math_package: id('0x15'),
      control_package: id('0x16'),
      seed_package: seed,
      seed_package_original: seed,
      content_root: { id: root, shared_version: '1' },
      loot_registry: { id: id('0x17'), shared_version: '1' },
    },
    client: {
      core: {
        getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
          objects: objectIds
            .filter((key) => existing.has(key))
            .map((key) => ({
              objectId: key,
              version: '1',
              digest: '11111111111111111111111111111111',
              owner: { AddressOwner: custody },
            })),
        }),
        getTransaction: async () => receipt,
        executeTransaction: async () => {
          throw new Error('Recovery must not submit a transaction')
        },
      },
    } as unknown as SuiTransport,
  })
  const session = await create_seed_admin({
    sdk,
    content: authored,
    config: { admin_cap: admin, content_root: root },
    gift_campaign: 'ore',
  })
  return { sdk, session }
}

test('a restarted session recovers a redeemed gift from original issuance, without submitting', async () => {
  const { session } = await fixture()
  expect((await session.check_changes({})).fixed).toHaveLength(1)
  const ledger = await session.recover_created_ledger({}, 'giftcards:0', 'ISSUED')
  expect((await session.check_changes(ledger)).fixed).toHaveLength(0)
  expect(await session.recover_created_ledger(ledger, 'giftcards:0', 'ISSUED')).toEqual(ledger)
  await expect(session.recover_created_ledger({}, 'giftcards:0', 'OTHER')).rejects.toThrow('certified receipt')
  await expect(
    session.recover_created_ledger({ [card]: { hash: 'changed', label: 'old' } }, 'giftcards:0', 'ISSUED')
  ).rejects.toThrow('fingerprint')
  await expect(session.execute('giftcards:0', ledger)).rejects.toThrow('not the next ready')
})

test('recovery requires proof for every missing fingerprint and preserves pre-existing rows', async () => {
  const authored = {
    ...content,
    airdrop: { giftcards: [...content.airdrop.giftcards, { ...content.airdrop.giftcards[0]!, id: 'two' }] },
  }
  const { session, sdk } = await fixture(authored)
  await expect(session.recover_created_ledger({}, 'giftcards:0', 'ISSUED')).rejects.toThrow('every unrecorded gift')
  const prior = giftcard_id(root, game, 'two')
  const ledger = seed_ledger_after_batch(
    seed_sync_rows(sdk, authored),
    { unrelated: { hash: 'keep', label: 'keep' } },
    [prior]
  )
  const recovered = await session.recover_created_ledger(ledger, 'giftcards:0', 'ISSUED')
  expect(recovered[card]).toBeDefined()
  expect(recovered[prior]).toBe(ledger[prior])
  expect(recovered.unrelated).toBe(ledger.unrelated)
  expect(ledger[card]).toBeUndefined()
})
