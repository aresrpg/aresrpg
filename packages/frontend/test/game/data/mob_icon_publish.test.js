// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { afterEach, expect, test } from 'bun:test'
import { configure_assets } from '@aresrpg/sdk/jobs'

import { set_catalog_for_test } from '../../../src/game/data/mob_catalog.js'
import {
  assert_mob_icon_publish_complete,
  mob_icon_filename,
  mob_icon_publish_plan,
} from '../../../src/game/data/mob_icon_name.js'
import { get_mob_icon_url } from '../../../src/game/data/mobs.js'

const renderer_source = readFileSync(new URL('../../../scripts/render_mob_icons.mjs', import.meta.url), 'utf8')

afterEach(() => set_catalog_for_test())

test('renderer and client derive the mob icon filename from one shared home (#1054)', () => {
  configure_assets({ aggregator: 'https://assets.test' })
  set_catalog_for_test({ broodfather: { appearance: 'Scarak', glb: 'hy_scarak_broodmother_model_default' } })

  expect(get_mob_icon_url({ name: 'Broodfather' })).toEndWith('/mobs/broodfather.png')
  expect(renderer_source).toContain("from '../src/game/data/mob_icon_name.js'")
  expect(renderer_source).not.toContain('`${glb}.png`')
})

test('the shared publish plan aliases a GLB render to catalog-key filenames and verifies both sizes', () => {
  const catalog = { broodfather: { glb: 'hy_scarak_broodmother_model_default' } }

  expect(mob_icon_publish_plan(catalog)).toEqual([
    {
      key: 'broodfather',
      glb: 'hy_scarak_broodmother_model_default',
      thumb: mob_icon_filename('broodfather'),
      hd: mob_icon_filename('broodfather', { hd: true }),
    },
  ])
  expect(() => assert_mob_icon_publish_complete(catalog, ['broodfather.png'])).toThrow('incomplete')
  expect(assert_mob_icon_publish_complete(catalog, ['broodfather.png', 'broodfather_hd.png'])).toBe(true)
})

test('the drift instrument throws when a catalog row omits the glb field', () => {
  expect(() => mob_icon_publish_plan({ broodfather: {} })).toThrow('missing glb')
})
