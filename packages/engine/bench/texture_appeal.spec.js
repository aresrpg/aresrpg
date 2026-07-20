// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// VISUAL PROOF spec (texture appeal, W4 seam/repetition pass) — captures the three owner-complaint
// poses so before/after can be diffed by eye:
//   (a) low grazing over a meadow  → the "grid of 1m tiles + seam shimmer" pose
//   (b) mid-distance hillside      → repetition + mip-derivative sparkle at tile edges
//   (c) close-up on a grass step   → the dirt-side / grass-rim voxel grammar
// Bare headed Chromium (no custom GPU args — the Metal adapter is exposed by default; see
// playwright.config.js). Hard-navigates the demo so the world regenerates, pins each pose by
// monkeypatching the engine camera setters (the demo rAF loop pushes `state` every frame, so
// pinning the setters is the only way to hold a pose under automation), drains the ring, screenshots.
//
// PHASE selects the output suffix: `APPEAL_PHASE=before` or `APPEAL_PHASE=after` (default before).
// Writes /tmp/aresrpg-engine-artifacts/texture_appeal_{a,b,c}_{phase}.png — artifacts NEVER in-repo.

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { MASTER_SEED } from '../src/config/world_config.js'

import { goto_demo, probe_gpu_adapter, capture_canvas_screenshot } from './harness.js'

const ARTIFACTS = '/tmp/aresrpg-engine-artifacts'
const PHASE = process.env.APPEAL_PHASE === 'after' ? 'after' : 'before'

/**
 * @typedef {object} Pose
 * @property {string} tag artifact letter (a|b|c)
 * @property {[number, number, number]} pos world-space camera position (m)
 * @property {number} yaw radians
 * @property {number} pitch radians
 * @property {string} note what the pose is meant to show
 */

// Coastal hillside near spawn: surface rises +x from a shoreline (see hillside_lit.spec.js — a
// terraced slope at [-4,168,4] fills the frame side-on). Poses derived from that vantage.
/** @type {Pose[]} */
const POSES = [
  {
    tag: 'a',
    // Low, near-horizontal skim just above the meadow surface — grazing angle maximises the
    // tile-grid + seam-shimmer read (glancing texel footprints are where clamp seams sparkle).
    pos: [-2, 150, 18],
    yaw: -Math.PI / 4,
    pitch: -0.12,
    note: 'low grazing over meadow (grid/seams)',
  },
  {
    tag: 'b',
    // Higher + further back, looking down the slope — mid-distance repetition + mip sparkle.
    pos: [-10, 172, 12],
    yaw: -Math.PI / 4,
    pitch: -0.42,
    note: 'mid-distance hillside (repetition + mip sparkle)',
  },
  {
    tag: 'c',
    // Close, steep-down onto a single grass step so the vertical riser (side face) fills the
    // frame next to the lit top — the dirt-side-with-grass-rim grammar.
    pos: [2, 152, 10],
    yaw: -Math.PI / 3,
    pitch: -0.62,
    note: 'close-up grass step (dirt-side rim)',
  },
]

test('texture appeal: capture meadow / hillside / grass-step poses', async ({ page }) => {
  await mkdir(ARTIFACTS, { recursive: true })
  test.setTimeout(120_000)

  await goto_demo(page, { seed: MASTER_SEED })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)

  // Stash the ORIGINAL bound setters once, then replace the live ones with a version that pins to
  // `window.__pin` every frame. The override is (re)installed per pose and reads __pin fresh, so it
  // survives even if the engine re-inits mid-run — the earlier neuter-once approach froze every shot
  // at pose (a) (identical variances), and a stale override silently reverted b/c to the default pose.
  for (const pose of POSES) {
    await page.evaluate(
      ({ pos, yaw, pitch }) => {
        const w = /** @type {any} */ (window)
        const engine = w.__engine
        w.__pin = { pos, yaw, pitch }
        // (Re)install the pin override idempotently — guard so we bind the ORIGINAL setters only once.
        if (!engine.__pin_installed) {
          const set_pos = engine.set_camera_position.bind(engine)
          const set_orient = engine.set_camera_orientation.bind(engine)
          engine.set_camera_position = () => w.__pin && set_pos(w.__pin.pos)
          engine.set_camera_orientation = () => w.__pin && set_orient(w.__pin.yaw, w.__pin.pitch)
          engine.__pin_installed = true
        }
      },
      { pos: pose.pos, yaw: pose.yaw, pitch: pose.pitch }
    )

    // Wait until the LIVE camera actually reached the pinned pose (self-heals flaky pins) AND the ring
    // finished streaming the world around it, so mips are built and no chunk is missing. Both, not one.
    await page
      .waitForFunction(
        (p) => {
          const s = /** @type {any} */ (window).__engine?.get_stats?.()
          if (!s) return false
          const [x, y, z] = s.camera_position
          const near = Math.abs(x - p.pos[0]) + Math.abs(y - p.pos[1]) + Math.abs(z - p.pos[2]) < 2
          return near && s.chunk_queue_depth === 0
        },
        { pos: pose.pos },
        { timeout: 30_000 }
      )
      .catch(() => {})
    await page.waitForTimeout(2500)

    const name = `texture_appeal_${pose.tag}_${PHASE}`
    const shot = await capture_canvas_screenshot(page, name)
    const pos = await page.evaluate(() => /** @type {any} */ (window).__engine.get_stats().camera_position)
    console.log(`[appeal ${pose.tag}] ${pose.note} @ [${pos}] → ${shot.path} variance=${shot.variance.toFixed(2)}`)
    expect(shot.variance, `pose ${pose.tag} looks blank — see ${shot.path}`).toBeGreaterThan(3)
  }
})
