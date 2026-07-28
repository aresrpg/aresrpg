// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, expect, test } from 'bun:test'
import { configure_assets, item_icon_url, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { set_catalog_for_test } from '../../game/data/mob_catalog.js'

import { encyclopedia_mob_icon_url } from './encyclopedia_assets'

afterAll(() => {
  set_catalog_for_test()
  reset_assets_for_test()
})

test('mob icons resolve beside item icons on the asset host under mobs/', () => {
  set_catalog_for_test({ alley_bunny: { appearance: null, glb: 'hy_bunny' } })
  configure_assets({ classes: { item: { published: true } } })

  const item_url = item_icon_url('asset_host_control')
  if (!item_url) throw new Error('expected the item icon control URL')
  const asset_host = item_url.slice(0, -'/items/asset_host_control.png'.length)

  expect(encyclopedia_mob_icon_url({ name: 'Alley Bunny' })).toBe(`${asset_host}/mobs/alley_bunny.png`)
})
