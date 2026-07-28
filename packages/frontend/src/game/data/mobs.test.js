// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #353 regression tooth: get_mob_icon_url is asset-host-only (#650: MinIO) — the pre-CDN local icon
// folder was migration residue (gitignored, never tracked by git, never shipped past a dev's own disk —
// confirmed via git ls-tree on edge/master) and is deleted.

import { afterAll, expect, test } from 'bun:test'
import { configure_assets } from '@aresrpg/sdk/jobs'

import { set_catalog_for_test } from './mob_catalog.js'
import { get_mob_icon_url } from './mobs.js'

afterAll(() => set_catalog_for_test())

const mob = { name: 'Alley Bunny' }

test('mob icons resolve directly through the asset host without a manifest class', () => {
  set_catalog_for_test({ alley_bunny: { appearance: null, glb: 'hy_bunny' } })
  configure_assets({ aggregator: 'https://agg.example' })
  expect(get_mob_icon_url(mob)).toBe('https://agg.example/mobs/alley_bunny.png')
})

test('the asset host serves thumb + hd mob icons', () => {
  set_catalog_for_test({ alley_bunny: { appearance: null, glb: 'hy_bunny' } })
  configure_assets({ aggregator: 'https://agg.example' })
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
  configure_assets({ aggregator: 'https://agg.example' })
  expect(get_mob_icon_url({ name: 'Broodfather' })).toBe('https://agg.example/mobs/broodfather.png')
  expect(get_mob_icon_url({ name: 'Broodfather' }, { hd: true })).toBe('https://agg.example/mobs/broodfather_hd.png')
  // the variant branch (a legacy roster id that keys the catalog directly) resolves by that same key
  expect(get_mob_icon_url({ variant: 'broodfather', name: 'Whatever' })).toBe('https://agg.example/mobs/broodfather.png')
})

test('no catalog match resolves to null', () => {
  set_catalog_for_test({})
  configure_assets({ aggregator: 'https://agg.example' })
  expect(get_mob_icon_url({ name: 'Nonexistent Thing' })).toBeNull()
})
