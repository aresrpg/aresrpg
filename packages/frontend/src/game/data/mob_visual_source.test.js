// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { resolve_mob_visual_url } from './mobs.js'

describe('mob visual source SSOT', () => {
  test('a late asset reconfiguration cannot split world and fight GLB URLs', () => {
    const cache = new Map()
    let quilt = 'MOB_A'
    const asset_url = (/** @type {string} */ _class, /** @type {string} */ file) => `https://assets.invalid/${quilt}/${file}`
    const world_url = resolve_mob_visual_url(cache, 'hy_rat', asset_url)
    quilt = 'MOB_B'
    const fight_url = resolve_mob_visual_url(cache, 'hy_rat', asset_url)
    expect(fight_url).toBe(world_url)
    expect(fight_url).toContain('/MOB_A/')
  })
})
