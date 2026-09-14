// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { recipe_matches, verified_recipe_ledger } from '../src/seed_recipe_audit.ts'
import { seed_sync_view, type SeedSyncRow } from '../src/seed_sync.ts'

// Public mainnet recipe 0xa5c95e…bbb9, version 855012001, captured 2026-09-14.
import capture from './fixtures/mainnet_mushroom_lacquer.json'

const { object } = capture
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

test('live recipe comparison exposes a falsely current ledger with matching revisions', () => {
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
  expect(verified[row.key]).toBeUndefined()
  expect(
    seed_sync_view(
      [row],
      verified,
      () => true,
      0,
      () => revision
    ).changed
  ).toEqual([row])
  expect(ledger[row.key]!.hash).toBe(row.hash)
})

test('correct chain contents retain evidence and retired or reordered recipes need reconciliation', () => {
  const json = {
    ...object.json,
    data: { ...object.json.data, inputs: object.json.data.inputs.map((input) => ({ ...input, quantity: '1' })) },
  }
  expect(recipe_matches(expected, json)).toBe(true)
  expect(verified_recipe_ledger([row], ledger, [{ ...object, json }])).toEqual(ledger)
  expect(recipe_matches(expected, { ...json, active: false })).toBe(false)
  expect(recipe_matches(expected, { ...json, data: { ...json.data, inputs: [...json.data.inputs].reverse() } })).toBe(
    false
  )
})

test('missing or older reads stop instead of authorizing another write', () => {
  expect(() => verified_recipe_ledger([row], ledger, [])).toThrow('read is missing')
  expect(() => verified_recipe_ledger([row], ledger, [{ ...object, version: '1' }])).toThrow(
    'older than its certified revision'
  )
  expect(() => recipe_matches(expected, undefined)).toThrow('inputs are unavailable')
})
