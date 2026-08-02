// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, expect, test } from 'bun:test'
import { configure_assets, item_icon_url, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { encyclopedia_mob_icon_url } from './encyclopedia_assets'

afterAll(() => reset_assets_for_test())

// No mob_catalog seeding: since #1880 the portrait key comes from mob_slugs.json (the live population),
// never from the published catalog blob — which was a 779-key historical union that gated nothing.
test('mob icons resolve beside item icons on the asset host under mobs/', () => {
  configure_assets({ classes: { item: { published: true } } })

  const item_url = item_icon_url('asset_host_control')
  if (!item_url) throw new Error('expected the item icon control URL')
  const asset_host = item_url.slice(0, -'/items/asset_host_control.png'.length)

  expect(encyclopedia_mob_icon_url({ name: 'Alley Bunny' })).toBe(`${asset_host}/mobs/alley_bunny.png`)
})
