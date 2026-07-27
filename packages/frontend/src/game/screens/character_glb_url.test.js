// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WORLD-RENDER TOOTH for the character rigs (P0, 2026-07-25): a player stood in the world as a
// floating nameplate over NOTHING. Every world surface that mounts a character body — the roam avatar
// (embed_voxel_player), remote players, the fight-board fighters (voxel_fight_folds) and the
// character-create pedestal (load_character_model) — resolves its GLB through the ONE seam this file
// pins, `character_glb_url`. #650 re-homed that seam onto the MinIO asset host under the mapping law's
// geometry shape ({host}/models/{family}/{key}.glb), but the character corpus was never uploaded there:
// it mirrors the frontend's own public/ tree instead. Every resolved URL 404'd, the GLTFLoader rejected,
// and the avatar root stayed an empty group.
//
// PROVENANCE — captured 2026-07-25 against the live host with
//   curl -s -o /dev/null -w '%{http_code}' -r 0-100 https://assets.aresrpg.world/<key>
// All 13 published rigs (4 classes × 2 genders + the 5 hair meshes) answered 206 under
// `sprites/characters/` and 404 under `models/characters/`. This asserts the resolver against where the
// bytes ACTUALLY are, not against where the law assumed they'd be — the assumption is what broke.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { configure_assets, asset_url } from '@aresrpg/sdk/jobs'

import { reset_model_asset_errors_for_test } from '../model_asset_url.js'
import { CHARACTER_MODELS, character_glb_url } from './character-glb.js'

const HOST = 'https://assets.aresrpg.world'

// The 13 keys probed 206. Written out rather than derived from CHARACTER_MODELS so a future map edit
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
  ].map((key) => `${HOST}/sprites/characters/${key}.glb`)
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
  })

  test('the resolver seam itself maps a character .glb onto the served prefix', () => {
    configure_assets({ aggregator: HOST, classes: { character: { published: true } } })
    expect(asset_url('character', 'senshi_male.glb')).toBe(`${HOST}/sprites/characters/senshi_male.glb`)
  })

  test('an unpublished character class takes the explicit error path, never a relative fetch', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(character_glb_url('/sprites/characters/senshi_male.glb')).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('character')
    } finally {
      error.mockRestore()
    }
  })
})
