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
