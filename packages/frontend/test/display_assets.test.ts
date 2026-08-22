// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { class_names } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import { display_asset_rows } from '../display_assets.ts'

const repo_dir = resolve(import.meta.dir, '../../..')

test('every emitted Sui Display image URL resolves to one authored source asset', async () => {
  const rows = await display_asset_rows({
    characters_dir: resolve(repo_dir, 'seed/icons/characters'),
    items_dir: resolve(repo_dir, 'seed/icons/items'),
  })
  const routes = new Set(rows.map(({ route }) => route))

  expect(routes.size).toBe(rows.length)
  expect(routes.has('/item/crude_branch_hd.png')).toBeTrue()
  for (const classe of class_names)
    for (const sex of ['male', 'female']) expect(routes.has(`/classe/${classe}_${sex}.jpg`)).toBeTrue()
  expect(rows.every(({ source_path }) => existsSync(source_path))).toBeTrue()
})
