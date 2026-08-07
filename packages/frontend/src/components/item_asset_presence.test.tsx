// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { configure_assets, item_icon_url, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { ItemIcon } from '../game/screens/hud/ItemIcon.jsx'

import { ItemImage } from './item_image'

const HOST = 'https://assets.test'

afterEach(reset_assets_for_test)

describe('item icon presence comes from the asset manifest (#764)', () => {
  test('a present file renders while an absent file takes the honest-empty glyph branch without an img request', () => {
    configure_assets({
      aggregator: HOST,
      classes: { item: { published: true } },
      files: { items: ['bag_quartz.png'] },
    })

    const present = renderToStaticMarkup(<ItemIcon item="bag_quartz" category="resource" />)
    const absent_hud = renderToStaticMarkup(<ItemIcon item="tool_herbalist" category="pickaxe" />)
    const absent_surface = renderToStaticMarkup(<ItemImage id="tool_herbalist" category="pickaxe" />)

    expect(present).toContain(`<img`)
    expect(present).toContain(`${HOST}/items/bag_quartz.png`)
    expect(absent_hud).not.toContain('<img')
    expect(absent_surface).not.toContain('<img')
  })

  test('a published item class without its file inventory throws instead of coercing unverifiable presence', () => {
    configure_assets({ classes: { item: { published: true } } })

    expect(() => item_icon_url('bag_quartz')).toThrow('files')
  })
})
