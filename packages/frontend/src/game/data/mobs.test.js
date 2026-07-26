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
  expect(get_mob_icon_url(mob)).toBe('https://agg.example/mobs/alley_bunny.png')
  expect(get_mob_icon_url(mob, { hd: true })).toBe('https://agg.example/mobs/alley_bunny_hd.png')
})

// #1013: the two mob namespaces are keyed DIFFERENTLY on the asset host — geometry by the GLB
// basename (`models/mobs/hy_boar.glb` 200, `models/mobs/boar.glb` 404), the 2D icon by the CATALOG
// KEY (`mobs/broodfather.png` + `mobs/broodfather_hd.png` 200, `mobs/hy_scarak_broodmother_model_default.png`
// 404; `mobs/hy_boar.png` 404 too — all cache-busted probes, 2026-07-26). Deriving the icon filename
// from `entry.glb` therefore 404'd every mob, loudest on the ruled-mapping rows (755/770 of the
// published catalog, e.g. Broodfather/Eternwool) whose glb is not `hy_` + its key.
test('the mob icon resolves by CATALOG KEY, never the GLB basename (#1013)', () => {
  set_catalog_for_test({
    broodfather: { appearance: 'Scarak_Broodmother', glb: 'hy_scarak_broodmother_model_default' },
  })
  configure_walrus_assets({ aggregator: 'https://agg.example', classes: { mob_icon: { published: true } } })
  expect(get_mob_icon_url({ name: 'Broodfather' })).toBe('https://agg.example/mobs/broodfather.png')
  expect(get_mob_icon_url({ name: 'Broodfather' }, { hd: true })).toBe('https://agg.example/mobs/broodfather_hd.png')
  // the variant branch (a legacy roster id that keys the catalog directly) resolves by that same key
  expect(get_mob_icon_url({ variant: 'broodfather', name: 'Whatever' })).toBe('https://agg.example/mobs/broodfather.png')
})

test('no catalog match resolves to null regardless of publish state', () => {
  set_catalog_for_test({})
  configure_walrus_assets({ aggregator: 'https://agg.example', classes: { mob_icon: { published: true } } })
  expect(get_mob_icon_url({ name: 'Nonexistent Thing' })).toBeNull()
})
