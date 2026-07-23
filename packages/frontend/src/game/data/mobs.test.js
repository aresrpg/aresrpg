// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #353 regression tooth: get_mob_icon_url is asset-host-only (#650: MinIO) — the pre-CDN local icon
// folder was migration residue (gitignored, never tracked by git, never shipped past a dev's own disk —
// confirmed via git ls-tree on edge/master) and is deleted. An unconfigured/unpublished class must
// degrade to null (the caller's placeholder glyph), never a path pointing at a directory no
// deploy has ever contained.

import { afterAll, expect, test } from 'bun:test'
import { configure_walrus_assets } from '@aresrpg/sdk/jobs'

import { set_catalog_for_test } from './mob_catalog.js'
import { get_mob_icon_url } from './mobs.js'

afterAll(() => set_catalog_for_test())

const mob = { name: 'Alley Bunny' }

test('unconfigured mob_icon class resolves to null, never the deleted local path', () => {
  set_catalog_for_test({ alley_bunny: { appearance: null, glb: 'hy_bunny' } })
  // `configure_walrus_assets` only ever MERGES (Object.assign onto `classes`) — passing `{}` is a
  // no-op that can't undo a `mob_icon` class another test file already published in this same
  // process (bun test shares module state process-wide across files, not per-file). Overwrite the
  // `mob_icon` key itself to an unpublished class, which walrus_asset_url deterministically
  // resolves to null regardless of what ran before this test.
  configure_walrus_assets({ aggregator: 'https://agg.example', classes: { mob_icon: {} } })
  expect(get_mob_icon_url(mob)).toBeNull()
})

test('published mob_icon class resolves the asset-host URL (thumb + hd)', () => {
  set_catalog_for_test({ alley_bunny: { appearance: null, glb: 'hy_bunny' } })
  configure_walrus_assets({ aggregator: 'https://agg.example', classes: { mob_icon: { published: true } } })
  expect(get_mob_icon_url(mob)).toBe('https://agg.example/mobs/hy_bunny.png')
  expect(get_mob_icon_url(mob, { hd: true })).toBe('https://agg.example/mobs/hy_bunny_hd.png')
})

test('no catalog match resolves to null regardless of publish state', () => {
  set_catalog_for_test({})
  configure_walrus_assets({ aggregator: 'https://agg.example', classes: { mob_icon: { published: true } } })
  expect(get_mob_icon_url({ name: 'Nonexistent Thing' })).toBeNull()
})
