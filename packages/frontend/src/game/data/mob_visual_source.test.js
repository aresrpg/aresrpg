// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, spyOn, test } from 'bun:test'

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

  test('an unpublished mob class logs the gap and returns null, never a relative model URL', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const url = resolve_mob_visual_url(new Map(), 'hy_unpublished_probe', () => null)
      expect(url).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('mob')
    } finally {
      error.mockRestore()
    }
  })
})
