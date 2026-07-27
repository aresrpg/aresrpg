// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MOUNT RIG — pick_mount_clips is the pure idle/move clip-naming convention (#175: the fast-travel dragon's
// flap/fly clip must be found even when it isn't literally named "fly"). No engine, no GLB, no mixer — the
// same headless discipline as fast_travel_flight.test.js.
import { describe, expect, test } from 'bun:test'

import { pick_mount_clips } from './cosmetic_glb.js'

const clip = (/** @type {string} */ name) => ({ name })

describe('pick_mount_clips — idle/move naming convention', () => {
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
// GLBs, fetched from the production CDN URL ft_dragon_glb_url() derives (walrus_asset_url('mob', file) →
// `https://assets.aresrpg.world/models/mobs/<file>`) and enumerated from each GLB's own JSON chunk
// (`animations[].name` — a raw glTF-binary chunk read, not three.js's GLTFLoader, which needs a DOM):
//   dragon-fire.glb  (production default skin, SADDLED variant) — https://assets.aresrpg.world/models/mobs/
//     dragon-fire.glb — 521,332 bytes, sha256
//     d7a4a93b0b4a89a64f14fe1af219cbe0cdf9444d0ae0ba85c8deec1090e2471e, fetched 2026-07-28 — animations:
//     ["idle", "walk", "idle_once", "fly", "fireball_air", "fireball_ground", "fireflame_air",
//     "fireflame_ground", "bite", "grab", "wing_swing", "falling", "death_ground", "death_fall"]
//     (a Cloudflare edge in front of this key ignores cache-busting QUERY strings — it served the previous
//     bytes for a fresh `?v=` URL; `Cache-Control: no-cache` is what actually reaches origin. The sha is the
//     anchor, never the URL.)
//   dragon-frost.glb (DEV-only ?ftdragon=frost preview) — .../dragon-frost.glb — 1,554,648 bytes —
//     animations: ["IDLE", "RUN", "ATTACK"]
//   dragon-void.glb  (DEV-only ?ftdragon=void preview)  — .../dragon-void.glb  — 1,077,592 bytes —
//     animations: [] (ZERO clips)
// LINEAGE (2026-07-28): dragon-fire.glb was RE-AUTHORED under the same key — the capture above REPLACES the
// 2026-07-22 one (1,147,800 bytes, animations ["IDLE", "RUN"]). That old model had no flight loop at all, so
// RUN drove the flight animation as a documented stopgap; the new model ships a real 1.3s `fly` loop, and
// mount_is_flight('dragon-fire') makes it win the move slot. frost/void are byte-identical to the 07-22
// capture: frost still flies on RUN (no fly clip to prefer), and void's empty list falls through the
// empty-list case proven above (idle=null, move=null — the rig still renders, just unanimated).
const DRAGON_FIRE_GLB_CLIPS = [
  'idle',
  'walk',
  'idle_once',
  'fly',
  'fireball_air',
  'fireball_ground',
  'fireflame_air',
  'fireflame_ground',
  'bite',
  'grab',
  'wing_swing',
  'falling',
  'death_ground',
  'death_fall',
].map(clip)
const DRAGON_FROST_GLB_CLIPS = [clip('IDLE'), clip('RUN'), clip('ATTACK')]

describe('pick_mount_clips — REAL dragon GLB clip lists (#370 ground truth)', () => {
  test('dragon-fire.glb (production default skin): the real `fly` clip drives the flight loop, not walk', () => {
    const { idle, move } = pick_mount_clips(DRAGON_FIRE_GLB_CLIPS, { flight: true })
    expect(idle?.name).toBe('idle')
    expect(move?.name).toBe('fly')
  })
  test('dragon-fire.glb: no combat/death/wing_swing clip can win a slot (14 clips, only 2 are locomotion)', () => {
    const { idle, move } = pick_mount_clips(DRAGON_FIRE_GLB_CLIPS, { flight: true })
    expect(['idle', 'fly']).toContain(idle?.name)
    expect(['idle', 'fly']).toContain(move?.name)
  })
  test('dragon-fire.glb ridden as a GROUND mount would still walk — flight only flips the preference', () => {
    const { move } = pick_mount_clips(DRAGON_FIRE_GLB_CLIPS)
    expect(move?.name).toBe('walk')
  })
  test('dragon-frost.glb (DEV preview skin): no fly clip, so RUN still flies it; ATTACK never wins a slot', () => {
    const { idle, move } = pick_mount_clips(DRAGON_FROST_GLB_CLIPS, { flight: true })
    expect(idle?.name).toBe('IDLE')
    expect(move?.name).toBe('RUN')
  })
})
