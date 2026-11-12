// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

import { append_holder_gifts, holder_giftcard_batch } from '../prepare_holder_gifts.mjs'

const root = resolve(import.meta.dirname, '../..')
const directory = resolve(root, 'seed/content/snapshots/2026-11-11')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const airdrop = json(resolve(root, 'seed/content/airdrop.json'))
// Audited mainnet checkpoint 343987394, 2026-11-11T06:52:14.040Z.
// These are approved reward mappings, not collection identities inferred from artwork.
const allocations = [
  ['the_ones', 'title_chosen_one', 179],
  ['aeon', 'title_aeonkeeper', 534],
  ['suimilios', 'title_suimilionaire', 407],
  ['fuddies', 'title_fudbuster', 2978],
  ['enforcer_machin', 'title_enforcer', 338],
  ['rootlets', 'title_rootwarden', 1013, 76],
  ['puggies', 'title_pug_paladin', 815, 18],
  ['mystic_yetis', 'title_frostlord', 1884, 59],
  ['pawtato_heroes', 'title_tater_champion', 823, 26695],
]

// Independently audited source wallet sets, supplied 2026-11-11. Sorted addresses + final newline.
const recipient_hashes = {
  the_ones: 'f7128f209677ad1b551ec2bd2cb816d7c26fa4443d5456b07177a621dbbd2588',
  aeon: '27c881b9a2eb4202e18163452b074b99fed8e3a76f79b56caf71bc10e45a2d91',
  suimilios: '38cd7af907e03513c969cb8c4fa34371d56a04262e49c50b7ad36196044eab92',
  fuddies: '97f276504fc0cdacd13e05824fd04e6c625c298a23f89ac9821a557b483244e5',
  puggies: 'e59411ed9e284993fd8295e6716cf52b1778e35f9c6277fef0ff5f811e8a3eb0',
  rootlets: '9446133831c7788fb1831fe36799904542c0a5fc0b0681991b18942519014a50',
  pawtato_heroes: '03c3f8b20704bcdd4fb777bf7a965b4f6aa701c0917480d1081a43e58f2691a0',
  enforcer_machin: '54692062448a17c334a4c3b79bc22225c090ab94401ec70971a1fbb5709b98fe',
  mystic_yetis: '07c89d0a010b004f7faeaf76a1f4c37b14c9c5dd14ad1c8c685f09c804a29f00',
}
const recipient_set_hash = (recipients) =>
  createHash('sha256')
    .update(`${[...recipients].sort().join('\n')}\n`)
    .digest('hex')

test.each(allocations)(
  '%s title allocation exactly matches its approved saved snapshot',
  (collection, item_type, count, unresolved = 0) => {
    const snapshot = json(resolve(directory, `${collection}.json`))
    expect(snapshot.checkpoint).toBe(343987394)
    expect(snapshot.checkpoint_digest).toBe('4qcBq2G7DQDv4CBKWDRv4Nkh8RLqYHznrp6YoHsfePiP')
    expect(snapshot.inventory_complete).toBe(true)
    expect(snapshot.eligibility_classification_complete).toBe(true)
    expect(snapshot.unresolved).toHaveLength(unresolved)
    const campaign = airdrop.campaigns.find(({ id }) => id === item_type)
    expect(campaign.exclude_unresolved).toBe(unresolved ? true : undefined)
    // Canonical artifact integrity, not a new independent proof of chain ownership.
    // Raw inventory evidence remains in the manifest's external audit archive.
    const checksums = readFileSync(resolve(directory, 'SHA256SUMS'), 'utf8')
    const expected = checksums
      .split('\n')
      .find((line) => line.endsWith(`  ${collection}.json`))
      ?.split('  ')[0]
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(directory, `${collection}.json`)))
        .digest('hex')
    ).toBe(expected)
    expect(snapshot.inventory_sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(typeof snapshot.inventory_archive_member).toBe('string')
    const batch = holder_giftcard_batch(
      '2026-11-11',
      {
        item_type,
        types: snapshot.types,
        recipient: snapshot.recipient,
        exclude_unresolved: campaign.exclude_unresolved,
      },
      snapshot
    )
    expect(recipient_set_hash(snapshot.recipients)).toBe(recipient_hashes[collection])
    const prepared = airdrop.giftcard_batches.find(({ id }) => id === batch.id)
    expect(recipient_set_hash(prepared.recipients)).toBe(recipient_hashes[collection])
    expect(batch.amount).toBe(1)
    expect(batch.recipients).toHaveLength(count)
    expect(new Set(batch.recipients).size).toBe(count)
    expect(airdrop.giftcard_batches.find(({ id }) => id === batch.id)).toEqual(batch)
    expect(append_holder_gifts(airdrop, [batch])).toBe(airdrop)
  }
)

test('only the four approved holder subsets opt into custody exclusions', () => {
  expect(
    airdrop.campaigns
      .filter(({ exclude_unresolved }) => exclude_unresolved)
      .map(({ id }) => id)
      .sort()
  ).toEqual(['title_frostlord', 'title_pug_paladin', 'title_rootwarden', 'title_tater_champion'])
  expect(json(resolve(directory, 'puggies.json')).exclusion_counts).toEqual({
    known_custody: 18,
    zero_address_controller: 1,
  })
  const pawtato = json(resolve(directory, 'pawtato_heroes.json'))
  expect(pawtato.selection_method).toBe('all_verified_wallets_below_cap')
  expect(pawtato.recipient_cap).toBe(5000)
  expect(pawtato.gameplay_level_filter).toBeNull()
  expect(pawtato.eligible_object_count).toBe(3305)
  expect(pawtato.exclusion_counts).toEqual({ game_bridge_custody: 26695 })
  expect(airdrop.giftcards.some(({ item_type }) => item_type === 'title_crew_member')).toBe(false)
  expect(airdrop.campaigns.find(({ id }) => id === 'title_crew_member')).toEqual({
    id: 'title_crew_member',
    name: 'Blast',
    visibility: 'public',
    items: ['title_crew_member'],
    delivery: 'wallet',
  })
})

test('every community title preview has its authored thumbnail and HD artwork', () => {
  for (const item_type of [...allocations.map(([, item_type]) => item_type), 'title_crew_member']) {
    for (const suffix of ['', '_hd']) {
      const bytes = readFileSync(resolve(root, `seed/icons/items/${item_type}${suffix}.png`))
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    }
  }
})

// Final sale awards verified 2026-11-12 against the retained 2026-10-31 export.
test('Blast title uses the complete finalized sale whitelist, once per wallet on mainnet', () => {
  const batches = airdrop.giftcard_batches.filter(({ item_type }) => item_type === 'title_crew_member')
  expect(batches).toHaveLength(1)
  const [batch] = batches
  expect(batch.id).toBe('title_crew_member_sale_whitelist_20261112')
  expect(batch.campaign).toBe('title_crew_member')
  expect(batch.network).toBe('mainnet')
  expect(batch.amount).toBe(1)
  expect(batch.recipients).toHaveLength(164)
  expect(new Set(batch.recipients).size).toBe(164)
  expect(batch.recipients.every((address) => /^0x[0-9a-f]{64}$/u.test(address))).toBe(true)
  expect(recipient_set_hash(batch.recipients)).toBe('e9acb45b269d4d17683269c242eb6d75fae6c2386d604e625ee26ab6239fd307')
})
