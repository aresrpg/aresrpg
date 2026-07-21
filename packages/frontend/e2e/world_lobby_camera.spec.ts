// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// WS-B — full legacy camera port. Proves against the REAL app:
//   1. free-orbit follow renders (canvas non-blank, avatar in frame),
//   2. right-drag ROTATES the orbit camera (azimuth changes),
//   3. WASD still moves the avatar (camera-relative), camera follows,
//   4. JUMP (Space) raises player.position.y then settles back to the floor,
//   5. FIGHT MODE locks the polar to the classic 2:1 isometric ~30°-above-horizon framing (rotate-around-board), and exit restores it.

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/world_camera_snaps'
mkdirSync(SNAP_DIR, { recursive: true })
const snap = (name: string, buf: Buffer) => writeFileSync(`${SNAP_DIR}/${name}.png`, buf)

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

const cam = (page: Page, fn: string) => page.evaluate((f) => (window as any).__ARES_CAMERA?.[f](), fn)
const player_pos = (page: Page) => page.evaluate(() => (window as any).__ARES_PLAYER?.position() as number[])

test('World tab: free-orbit camera + jump + fight iso-lock', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))
  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-nav="game-world"]')).toContainText('World', { timeout: 30_000 })

  // land in the scene (mint a character first if this key's roster is empty — full reload after).
  const createAndPlay = page.locator('button:has-text("PLAY")')
  let needsCreate = false
  for (let i = 0; i < 15 && !needsCreate; i++) {
    needsCreate = await createAndPlay.isVisible().catch(() => false)
    if (!needsCreate) await page.waitForTimeout(3000)
  }
  if (needsCreate) {
    await page.getByPlaceholder('Enter name...').fill(`WSBCam${Date.now() % 100000}`)
    await createAndPlay.click()
    await expect(createAndPlay).not.toBeVisible({ timeout: 40_000 })
    let selected = null
    for (let i = 0; i < 30 && !selected; i++) {
      await page.waitForTimeout(3000)
      selected = await page
        .evaluate(async () => (await import('/src/game/core/game.js')).context.get_state().selected_character_id)
        .catch(() => null)
    }
  }

  const canvas = page.locator('canvas.roam-canvas')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(6000)
  await expect(
    page.evaluate(() => !!(window as any).__ARES_CAMERA),
    'the free-orbit rig must be active (perspective)'
  ).resolves.toBe(true)

  // The first-session tutorial renders a full-screen `.tut__backdrop` that intercepts pointer events over
  // the canvas — dismiss it so mouse-drag camera rotation + wheel dolly reach camera-controls (keys work
  // through it, mouse does not). Real players click "Skip tour" / play through it; this is not a camera bug.
  // ROBUST dismissal: the tutorial can appear late on a slow RPC boot, so loop-click Skip until the backdrop
  // is gone (a single timed check races the boot).
  for (let i = 0; i < 12; i++) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await expect(
    page.locator('.tut__backdrop'),
    'tutorial backdrop must be gone (it eats canvas mouse input)'
  ).toHaveCount(0, { timeout: 5000 })
  snap('1_free_follow', await canvas.screenshot())

  // (2) LEFT-DRAG ORBIT (MMO-style remap): a left-button drag rotates the camera azimuth materially.
  const az0 = (await cam(page, 'azimuth')) as number
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(box.x + box.width / 2 + 250, box.y + box.height / 2, { steps: 12 })
  await page.mouse.up({ button: 'left' })
  await page.waitForTimeout(600)
  const az1 = (await cam(page, 'azimuth')) as number
  expect(Math.abs(az1 - az0), 'left-drag should orbit the camera azimuth').toBeGreaterThan(0.2)
  snap('2_after_rotate', await canvas.screenshot())

  // (2b) FREE LOOK (regression: could not look over the character's shoulder — the cage is GONE). Dragging UP
  // tilts toward a near-horizontal over-shoulder angle; the ONLY cap is the never-below-floor guard (<90°).
  // The horizon is hidden VISUALLY (sky-matched fog), not by an angle limit.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 500, { steps: 20 })
  await page.mouse.up({ button: 'left' })
  await page.waitForTimeout(700)
  const lowPolar = (await cam(page, 'polar')) as number
  expect(lowPolar, 'exploration must allow a near-horizontal over-shoulder look (>75° from vertical)').toBeGreaterThan(
    1.3
  )
  expect(lowPolar, 'but never below the floor (<90°)').toBeLessThan(1.56)
  snap('2b_over_shoulder_horizon', await canvas.screenshot())

  // (2c) FIRST-PERSON at max zoom-in: dollying all the way in drops below the FP
  // threshold and HIDES the own model (camera at the head). Zooming back out restores it.
  const box2 = (await canvas.boundingBox())!
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2)
  // Poll: dolly in and wait until BOTH the distance dropped below FP AND the model-hide toggle applied
  // (the wheel-dolly eases + the roam tick toggles model visibility a frame later).
  let fpDist = 99
  let modelHidden = true
  for (let i = 0; i < 20; i++) {
    for (let w = 0; w < 6; w++) await page.mouse.wheel(0, -120)
    await page.waitForTimeout(300)
    fpDist = (await cam(page, 'distance')) as number
    modelHidden = await page.evaluate(() => (window as any).__ARES_PLAYER?.model_visible())
    if (fpDist < 0.9 && modelHidden === false) break
  }
  expect(fpDist, 'max zoom-in should reach first-person distance (<0.9)').toBeLessThan(0.9)
  expect(modelHidden, 'the own model must be hidden in first-person').toBe(false)
  snap('2c_first_person', await canvas.screenshot())
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 120) // dolly back out
  await page.waitForTimeout(900)
  const outDist = (await cam(page, 'distance')) as number
  expect(outDist, 'zooming out should leave first-person').toBeGreaterThan(0.9)
  expect(
    await page.evaluate(() => (window as any).__ARES_PLAYER?.model_visible()),
    'model visible again after zoom-out'
  ).toBe(true)

  // (3) WASD MOVE: avatar position changes (camera-relative), camera follows.
  const p0 = await player_pos(page)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1000)
  await page.keyboard.up('KeyW')
  const p1 = await player_pos(page)
  expect(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), 'W should move the avatar horizontally').toBeGreaterThan(0.3)

  // (4) JUMP: Space raises y above 0 during the hop, then it settles back to the floor.
  let peakY = 0
  await page.keyboard.down('Space')
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(60)
    peakY = Math.max(peakY, (await player_pos(page))[1])
  }
  await page.keyboard.up('Space')
  expect(peakY, 'Space should raise the avatar off the floor (jump)').toBeGreaterThan(0.4)
  // Poll for the fall-back-to-floor rather than a fixed wait — the scene's rAF (hence the gravity
  // integration) can be throttled under load, so gravity may need more wall-clock to bring it down.
  let [, settledY] = await player_pos(page)
  for (let i = 0; i < 20 && settledY > 0.05; i++) {
    await page.waitForTimeout(300)
    ;[, settledY] = await player_pos(page)
  }
  expect(settledY, 'the avatar should fall back to the floor after a jump').toBeLessThan(0.05)
  snap('3_after_jump', await canvas.screenshot())

  // (5) FIGHT MODE: driven by the REAL path — a `fight` store slice (the same trigger WS-C's dungeon
  // driver uses). Inject a minimal synthetic fight (empty arena); the roam tick's camera-drive should
  // enter the iso lock. Then clear it and the tick restores the free cam.
  await page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    const W = 12
    context.dispatch('action/fight/spawn', {
      fight_id: 'wsb-cam-test',
      cells: new Uint8Array(W * W), // all walkable
      width: W,
      fighters: new Map(),
      my_entity_id: null,
      origin: { x: 0, y: 0 },
      started: true, // skip the placement overlay
    })
  })
  await page.waitForTimeout(1800)
  expect(await cam(page, 'in_fight'), 'a real fight should flip the rig into fight mode via the tick').toBe(true)
  const fightPolar = (await cam(page, 'polar')) as number
  // owner P0 #9: locked to the classic 2:1 isometric board angle — 60° from vertical (30° above horizon) =
  // ~1.047 rad. Assert it locked near that iso framing (was 50°/0.87 before the isometric pass).
  expect(fightPolar, 'fight polar should lock near the iso 30°-above-horizon (2:1) framing').toBeGreaterThan(0.95)
  expect(fightPolar, 'fight polar should lock near the iso framing (upper bound)').toBeLessThan(1.15)
  snap('4_fight_lock', await canvas.screenshot())

  await page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    context.dispatch('action/fight/clear')
  })
  await page.waitForTimeout(1800)
  expect(await cam(page, 'in_fight'), 'clearing the fight should restore free mode via the tick').toBe(false)
  snap('5_after_exit', await canvas.screenshot())

  expect(pageErrors, `unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
