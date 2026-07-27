// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { content_path_candidates, pick_content_paths } from '../../scripts/verify_cosmetic_glbs.mjs'

const fixture_root = mkdtempSync(join(tmpdir(), 'ares-cosmetic-roots-'))
const seed_dir = join(fixture_root, 'seed', 'mainnet')
const equipment_dir = join(fixture_root, 'seed', 'models', 'equipment')

beforeAll(() => {
  mkdirSync(seed_dir, { recursive: true })
  mkdirSync(equipment_dir, { recursive: true })
  writeFileSync(join(seed_dir, 'shop.json'), '{"cosmetics":[]}')
})

afterAll(() => {
  rmSync(fixture_root, { recursive: true, force: true })
})

test('#1313: importing the verifier does not read removed checkout-local content roots', () => {
  expect(typeof pick_content_paths).toBe('function')
})

test('ARES_SEED_DIR is first and derives seed/models/equipment by default', () => {
  const [override] = content_path_candidates({ ARES_SEED_DIR: seed_dir })
  expect(override).toEqual({
    equipment_dir,
    seed_shop_path: join(seed_dir, 'shop.json'),
  })
})

test('ARES_EQUIPMENT_DIR overrides a separately-custodied model corpus', () => {
  const elsewhere = join(fixture_root, 'equipment-elsewhere')
  const [override] = content_path_candidates({
    ARES_SEED_DIR: seed_dir,
    ARES_EQUIPMENT_DIR: elsewhere,
  })
  expect(override.equipment_dir).toBe(elsewhere)
})

test('resolution skips dead roots and selects the first complete corpus pair', () => {
  const missing = {
    equipment_dir: join(fixture_root, 'missing-equipment'),
    seed_shop_path: join(fixture_root, 'missing-shop.json'),
  }
  const valid = { equipment_dir, seed_shop_path: join(seed_dir, 'shop.json') }
  expect(pick_content_paths([missing, valid])).toEqual(valid)
  expect(() => pick_content_paths([missing])).toThrow(/ARES_SEED_DIR/)
})
