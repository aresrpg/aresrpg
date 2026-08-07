// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WORLD-RENDER TOOTH for the character rigs (P0, 2026-07-25): a player stood in the world as a
// floating nameplate over NOTHING. Every world surface that mounts a character body — the roam avatar
// (embed_voxel_player), remote players, the fight-board fighters (voxel_fight_folds) and the
// character-create pedestal (load_character_model) — resolves its GLB through the ONE seam this file
// pins, `character_glb_url`. #650 re-homed that seam onto the MinIO asset host under the mapping law's
// geometry shape ({host}/models/{family}/{key}.glb). The 13 served rigs now live in that canonical home;
// this test rejects any resurrection of the legacy sprites/characters exception.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { configure_assets, asset_url } from '@aresrpg/sdk/jobs'

import { reset_model_asset_errors_for_test } from '../model_asset_url.js'
import { CHARACTER_MODELS, character_glb_url } from './character-glb.js'

const HOST = 'https://assets.aresrpg.world'

// The 13 served keys. Written out rather than derived from CHARACTER_MODELS so a future map edit
// that adds a rig fails here loudly (an unprobed key is an unproven URL) instead of silently passing.
const SERVED_206 = new Set(
  [
    'senshi_male',
    'senshi_male_hair',
    'senshi_female',
    'senshi_female_hair',
    'shugo_male',
    'shugo_female',
    'tomoda_male',
    'tomoda_female',
    'tomoda_female_hair',
    'yajin_male',
    'yajin_male_hair',
    'yajin_female',
    'yajin_female_hair',
  ].map((key) => `${HOST}/models/characters/${key}.glb`)
)

/** Every body + hair GLB the world can mount, as the local paths CHARACTER_MODELS carries. */
const every_rig_local_url = () =>
  Object.values(CHARACTER_MODELS).flatMap((genders) =>
    Object.values(genders).flatMap(({ body, hair }) => (hair ? [body, hair] : [body]))
  )

afterEach(() => {
  // Explicit unpublish — bun shares the resolver's module state across the whole run; never leak a
  // published class forward to a later file (see reset_assets_for_test's doc).
  configure_assets({ aggregator: HOST, classes: { character: {} } })
  reset_model_asset_errors_for_test()
})

describe('character rigs resolve to URLs the asset host actually serves', () => {
  test('every class × gender × (body, hair) resolves under the probed 206 prefix', () => {
    configure_assets({ aggregator: HOST, classes: { character: { published: true } } })

    const resolved = every_rig_local_url().map(character_glb_url)

    expect(resolved).toHaveLength(13)
    expect(resolved.filter((url) => !SERVED_206.has(url))).toEqual([])
    expect(
      [...SERVED_206].every((url) =>
        existsSync(new URL(`../../../public${new URL(url).pathname}`, import.meta.url))
      )
    ).toBe(true)
  })

  test('the resolver seam itself maps a character .glb onto the served prefix', () => {
    configure_assets({ aggregator: HOST, classes: { character: { published: true } } })
    expect(asset_url('character', 'senshi_male.glb')).toBe(`${HOST}/models/characters/senshi_male.glb`)
  })

  test('an unpublished character class takes the explicit error path, never a relative fetch', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(character_glb_url('/models/characters/senshi_male.glb')).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('character')
    } finally {
      error.mockRestore()
    }
  })
})
