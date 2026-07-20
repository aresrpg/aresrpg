// [team-outline PROOF] Close-ups of the fight ENTITY OUTLINE on the REAL GPU (headed Metal, the studio
// project). Boots the ?team=1 flat open-sky board, dollies the locked iso rig in close, and screenshots
// the senshi ally rig at IDLE and mid-ATTACK.
//
// BEFORE the smoothed-normal fix the inverted hull was pushed along the rig's HARD per-face voxel
// normals, so the shell separated at EVERY interior cube corner (visible on all corners, weird with
// voxels). AFTER, the shell rides POSITION-WELDED smoothed normals, so only
// the outer silhouette separates — one clean dark rim (the default three.js OutlinePass look).
//
// Tag the output pair with OUTLINE_TAG (before|after) so a run on each side of the diff yields a
// comparison. This is a CAPTURE, not a pass/fail gate: it asserts only that the adapter is hardware and
// the board booted. Run: `OUTLINE_TAG=before bun run bench bench/team_outline.spec.js --project=studio-metal-headed`.

import path from 'node:path'
import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN, probe_gpu_adapter } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts'
const TAG = process.env.OUTLINE_TAG || 'run'

test('team entity outline — idle + attack close-ups', async ({ page }) => {
  await mkdir(OUT, { recursive: true })

  /** @type {string[]} */
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${DEMO_ORIGIN}/demo/index.html?team=1`)
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 }).catch(async () => {
    throw new Error(`team board did not boot — gate says: "${await page.locator('#gate').textContent()}"`)
  })

  const gpu = await probe_gpu_adapter(page)
  expect(gpu.ok, `hardware GPU required (§7): ${gpu.reason ?? ''}`).toBe(true)

  // Dolly the locked iso rig to its closest allowed distance + orbit to a 3/4 angle so a senshi ALLY
  // (south band) fills the frame — the outline detail must be read at close range.
  await page.evaluate(() => {
    const b = /** @type {any} */ (window).__board
    b.camera_rig.dolly_to(8) // DOLLY_MIN
    b.camera_rig.set_azimuth(0.7)
  })
  await page.waitForTimeout(450) // let the rig push its pose + settle a few frames
  await page.locator('#canvas').screenshot({ path: path.join(OUT, `team_outline_${TAG}_idle.png`) })

  // ATTACK — the senshi ally swings: proves the shell still DEFORMS with the skeleton (not a frozen
  // bind pose). Capture near the ~0.9s impact frame of the ~2s ATTACK clip.
  await page.evaluate(() => /** @type {any} */ (window).__board.entity_beat('a0', { anim: 'attack' }))
  await page.waitForTimeout(700)
  await page.locator('#canvas').screenshot({ path: path.join(OUT, `team_outline_${TAG}_attack.png`) })

  // Console errors are informational here (some WebGPU builds log benign warnings) — surfaced, not gated.
  if (errors.length) console.log(`[team_outline] page errors:\n  ${errors.join('\n  ')}`)
})
