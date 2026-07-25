// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ZERO-DIVERGENCE TWIN — "class + gender → the GLB that renders it" is ONE rule with ONE home
// (game/screens/character-glb.js `character_model_urls`). Before the extraction it had FOUR bodies: the roam
// avatar (embed_voxel_player), remote players, the world fight board (world-shell/voxel_fight_folds) and the
// simulator board (simulator/board_paint) each re-wrote `has_character_model(x) ? x : 'senshi'` plus its own
// CHARACTER_MODELS[...][gender] lookup.
//
// The ONLY sanctioned difference is the placeholder POLICY, and it is an explicit argument: the world
// substitutes a Senshi body (a live board must show someone), the simulator substitutes nothing (it seats all
// twelve classes, so a Senshi body on an Iyashi would be a lie about the page's whole subject). This test
// pins BOTH halves: identical output for every RIGGED class on both surfaces, and the policy difference
// confined to the unrigged ones.

import { describe, expect, it } from 'bun:test'

import {
  CHARACTER_MODELS,
  PLACEHOLDER_RIG_CLASS,
  character_model_urls,
  character_rig_of,
  has_character_model,
} from '../game/screens/character-glb.js'
import { glb_variant_of, hair_variant_of } from '../world-shell/voxel_fight_folds.js'

import { class_body_url, class_hair_url } from './board_paint'

const RIGGED = Object.keys(CHARACTER_MODELS)
// the 8 classes that ship no art yet (classes.json minus the rigged four) — one representative is enough to
// pin the policy split, but the rig helper is asserted over the whole unrigged set below.
const UNRIGGED = ['iyashi', 'yogen', 'ikari', 'mori', 'tokei', 'rojin', 'shusen', 'asobi']

describe('rig twin — the world board and the simulator board resolve through one home', () => {
  it('a RIGGED class renders the exact same body + hair on both surfaces', () => {
    for (const class_id of RIGGED)
      for (const male of [true, false]) {
        const shared = character_model_urls(class_id, male)
        expect(class_body_url(class_id, male)).toBe(shared.body)
        expect(class_hair_url(class_id, male)).toBe(shared.hair)
        // the world fight board reads the same rule through its own fighter-shaped decode
        expect(glb_variant_of({ is_player: true, class_id, male })).toBe(shared.body)
        expect(hair_variant_of({ is_player: true, class_id, male })).toBe(shared.hair)
      }
  })

  it('the world substitutes the placeholder rig, the simulator substitutes nothing — the only difference', () => {
    for (const class_id of UNRIGGED) {
      expect(has_character_model(class_id)).toBe(false)
      // simulator: no url at all ⇒ the engine's own capsule stands in (honest "no art yet")
      expect(class_body_url(class_id, true)).toBeUndefined()
      expect(class_hair_url(class_id, true)).toBeUndefined()
      // world: the gender-matched placeholder body, never the engine's implicit male default
      expect(glb_variant_of({ is_player: true, class_id, male: true })).toBe(
        character_model_urls(PLACEHOLDER_RIG_CLASS, true).body
      )
      expect(glb_variant_of({ is_player: true, class_id, male: false })).toBe(
        character_model_urls(PLACEHOLDER_RIG_CLASS, false).body
      )
    }
  })

  it('the rig rule itself is one function — substitution is its argument, never a branch at a call site', () => {
    for (const class_id of RIGGED) expect(character_rig_of(class_id, PLACEHOLDER_RIG_CLASS)).toBe(class_id)
    for (const class_id of UNRIGGED) {
      expect(character_rig_of(class_id, PLACEHOLDER_RIG_CLASS)).toBe(PLACEHOLDER_RIG_CLASS)
      expect(character_rig_of(class_id)).toBeNull()
    }
    // a missing/empty class id is the roam avatar's real hydrate bug (classe='') — it must take the fallback
    expect(character_rig_of('', PLACEHOLDER_RIG_CLASS)).toBe(PLACEHOLDER_RIG_CLASS)
    expect(character_rig_of(undefined, PLACEHOLDER_RIG_CLASS)).toBe(PLACEHOLDER_RIG_CLASS)
    expect(character_rig_of(null)).toBeNull()
  })

  it("the world board honours the read-model's `sex` spelling as well as `male`", () => {
    const female = character_model_urls(PLACEHOLDER_RIG_CLASS, false).body
    expect(glb_variant_of({ is_player: true, class_id: PLACEHOLDER_RIG_CLASS, sex: 'female' })).toBe(female)
    expect(glb_variant_of({ is_player: true, class_id: PLACEHOLDER_RIG_CLASS, male: false })).toBe(female)
  })
})
