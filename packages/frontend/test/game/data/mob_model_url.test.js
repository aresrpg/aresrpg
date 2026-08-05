// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { configure_assets, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { mob_model_url } from '../../../src/game/data/mobs.js'
import { set_catalog_for_test } from '../../../src/game/data/mob_catalog.js'
import { set_pet_catalog_for_test } from '../../../src/game/data/pet_catalog.js'

afterEach(() => {
  set_catalog_for_test()
  set_pet_catalog_for_test()
  reset_assets_for_test()
})

describe('mob_model_url — the sole production mob URL constructor', () => {
  test('a mob_catalog basename resolves through the catalog asset resolver', () => {
    set_catalog_for_test({ rat: { appearance: 'Rat', glb: 'hy_rat' } })
    configure_assets({ aggregator: 'https://assets.example', classes: { mob: { published: true } } })

    expect(mob_model_url('hy_rat')).toBe('https://assets.example/models/mobs/hy_rat.glb')
  })

  test('an unlisted basename such as ln can never become a request URL', () => {
    set_catalog_for_test({ rat: { appearance: 'Rat', glb: 'hy_rat' } })
    configure_assets({ aggregator: 'https://assets.example', classes: { mob: { published: true } } })
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(mob_model_url('ln')).toBe('https://assets.example/models/mobs/hy__missing.glb')
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('[mob-model-catalog]')
      expect(String(error.mock.calls[0]?.[0])).toContain('ln.glb')
    } finally {
      error.mockRestore()
    }
  })

  test('manifest-sealed fast-travel models share the same constructor', () => {
    configure_assets({ aggregator: 'https://assets.example', classes: { mob: { published: true } } })
    expect(mob_model_url('dragon-fire.glb')).toBe('https://assets.example/models/mobs/dragon-fire.glb')
  })
})
