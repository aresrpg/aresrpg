// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MOUNT RIG — pick_mount_clips is the pure idle/move clip-naming convention (#175: the fast-travel dragon's
// flap/fly clip must be found even when it isn't literally named "fly"). No engine, no GLB, no mixer — the
// same headless discipline as fast_travel_flight.test.js.
import { describe, expect, test } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): mount_rig.js imports get_glb_loader/apply_avatar_material from
// @aresrpg/engine3/player, which unconditionally re-exports create_character_avatar — a static import of the
// absent-by-design senshi_male.glb (see test_helpers/glb_fixture.js). The whole module is unreachable without
// the asset, so the whole file guards together, same as fast_travel_flight.test.js.
const { pick_mount_clips } = SENSHI_MALE_GLB_AVAILABLE ? await import('./mount_rig.js') : {}

const clip = (/** @type {string} */ name) => ({ name })

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('pick_mount_clips — idle/move naming convention', () => {
  test('ground rig: idle + walk/run picked by name', () => {
    const { idle, move } = pick_mount_clips([clip('Idle'), clip('Walk'), clip('Run')])
    expect(idle?.name).toBe('Idle')
    expect(move?.name).toBe('Walk')
  })
  test('#175: a dragon clip named "Flap" (not "fly") is still found as the move clip', () => {
    const { idle, move } = pick_mount_clips([clip('Idle'), clip('Flap')])
    expect(idle?.name).toBe('Idle')
    expect(move?.name).toBe('Flap')
  })
  test('a dragon clip named "Wing" is also found as the move clip', () => {
    const { move } = pick_mount_clips([clip('Rest'), clip('Wing')])
    expect(move?.name).toBe('Wing')
  })
  test('a plain "Fly" clip still matches (the pre-existing convention keeps working)', () => {
    const { move } = pick_mount_clips([clip('Idle'), clip('Fly')])
    expect(move?.name).toBe('Fly')
  })
  test('ground names win over flight names when both are present (never pick a baked-altitude clip over a real gait)', () => {
    const { move } = pick_mount_clips([clip('Idle'), clip('Fly'), clip('Walk')])
    expect(move?.name).toBe('Walk')
  })
  test('a single unnamed clip becomes idle-only (no move clip, no crash) — the clip still always plays', () => {
    const { idle, move } = pick_mount_clips([clip('TPose')])
    expect(idle?.name).toBe('TPose')
    expect(move).toBe(null)
  })
  test('two unnamed clips fall back to positional (clip 0 = idle, clip 1 = move)', () => {
    const { idle, move } = pick_mount_clips([clip('A'), clip('B')])
    expect(idle?.name).toBe('A')
    expect(move?.name).toBe('B')
  })
  test('an empty clip list never throws', () => {
    const { idle, move } = pick_mount_clips([])
    expect(idle).toBe(null)
    expect(move).toBe(null)
  })
})

// GROUND TRUTH (#370 — "kill the regex guessing, pin the real name in a test with the clip list cited as
// fixture data"). Every test above uses INVENTED clip names ("Flap", "Wing", "TPose"…) never verified against a
// real GLB — exactly the gap #370 calls out. This fixture is the ACTUAL clip list of the fast-travel dragon's
// GLBs, fetched from the production CDN URL ft_dragon_glb_url() derives (walrus_asset_url('mob', file) → the
// published asset_manifest.json's 'mob' quilt) and enumerated from each GLB's own JSON chunk
// (`animations[].name` — a raw glTF-binary chunk read, not three.js's GLTFLoader, which needs a DOM):
//   dragon-fire.glb  (production default skin) — https://cdn.aresrpg.world/walrus/v1/blobs/by-quilt-id/
//     BxyR4mkAgTQ2s3NBytTar_Skzhec5vTP8gmkEt3aTDk/dragon-fire.glb — 1,147,800 bytes, fetched 2026-07-22 —
//     animations: ["IDLE", "RUN"]
//   dragon-frost.glb (DEV-only ?ftdragon=frost preview) — same quilt, dragon-frost.glb — 1,554,648 bytes —
//     animations: ["IDLE", "RUN", "ATTACK"]
//   dragon-void.glb  (DEV-only ?ftdragon=void preview)  — same quilt, dragon-void.glb  — 1,077,592 bytes —
//     animations: [] (ZERO clips)
// NONE of the three ships a fly/flap/wing clip — content follow-up needed (a real flight loop doesn't exist
// yet). RUN is the best available loop for all skins that have one: a cyclic locomotion clip beats a static
// IDLE for a mount that's supposed to read as airborne and moving; dragon-void's empty list already falls
// through the empty-list case proven above (idle=null, move=null — the rig still renders, just unanimated).
const DRAGON_FIRE_GLB_CLIPS = [clip('IDLE'), clip('RUN')]
const DRAGON_FROST_GLB_CLIPS = [clip('IDLE'), clip('RUN'), clip('ATTACK')]

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('pick_mount_clips — REAL dragon GLB clip lists (#370 ground truth)', () => {
  test('dragon-fire.glb (production default skin): RUN drives the flight loop — no fly clip exists in the real GLB', () => {
    const { idle, move } = pick_mount_clips(DRAGON_FIRE_GLB_CLIPS)
    expect(idle?.name).toBe('IDLE')
    expect(move?.name).toBe('RUN')
  })
  test('dragon-frost.glb (DEV preview skin): the extra ATTACK clip never wins the move/flight slot', () => {
    const { idle, move } = pick_mount_clips(DRAGON_FROST_GLB_CLIPS)
    expect(idle?.name).toBe('IDLE')
    expect(move?.name).toBe('RUN')
  })
})
