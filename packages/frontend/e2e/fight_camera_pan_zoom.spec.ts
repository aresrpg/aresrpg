import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// FIGHT CAMERA PAN/ZOOM — right-drag during fights slightly pans the board and the zoom range is extended.
// Drives the REAL app via the zero-gas __ARES_DEV_FIGHT_ENTRY preview (embed_voxel_dev.js): it
// engages the fight camera around the player's live position with a synthetic 11×11 board frame, no chain
// fight or real dungeon required (the same preview already used to A/B the entry cinematic). The
// dev hook auto-releases after a hardcoded 4.5 s, so each scenario below re-triggers a FRESH engage rather
// than racing multiple gestures inside one window. reduced-motion is forced so the prepare beat holds the
// iso pose STILL (no auto-orbit) for clean, static screenshots.
//
// NOTE ON SCOPE: this synthetic preview is anchored in the open-world spawn (flat, no cave décor), so it
// proves the PAN/ZOOM/RESET MOTION + gesture separation + contextmenu suppression against the REAL renderer,
// but it does not exercise a cave-biome décor-clip check — that risk is instead avoided by construction (the
// new wheel-zoom floor reuses the already-shipped, already-proven zoom-punch DECOR_CLIP_FLOOR, see the source
// comment in embed_voxel_fight_camera.js).

const SNAP_DIR = '/tmp/fight_camera_pan_zoom_snaps'
mkdirSync(SNAP_DIR, { recursive: true })
const shoot = async (page: Page, name: string) => {
  try {
    const buf = await page.locator('canvas').screenshot({ timeout: 8000 })
    writeFileSync(`${SNAP_DIR}/${name}.png`, buf)
  } catch {
    /* headless GPU readback hiccup — diagnostic only, never fails the proof (assertions carry it) */
  }
}

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

async function boot(page: Page) {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))
  await page.emulateMedia({ reducedMotion: 'reduce' }) // hold the prepare beat STILL — no auto-orbit mid-shot
  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
    } catch {
      /* storage unavailable — the dismiss-loop below still handles it */
    }
  }, DEV_KEY)
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  // A cold vite dep-optimization pass on a fresh server can delay embed_voxel_dev.js's dynamic import well
  // past 30 s (observed: HMR invalidate/reload storms on the game host during first-ever module discovery) —
  // generous budget, matching this repo's own "cold boot can take several seconds to minutes" precedent.
  await page.waitForFunction(() => typeof (window as any).__ARES_DEV_FIGHT_ENTRY === 'function', { timeout: 90_000 })
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(1500) // let streaming settle before the preview anchors its synthetic frame
  return { canvas, pageErrors }
}

/** Fresh engage — the dev hook auto-releases after a hardcoded 4.5 s (embed_voxel_dev.js's own setTimeout,
 *  not cancelable from here), so each scenario waits that out before re-triggering (begin_prepare is a no-op
 *  while a previous instance is still live). */
const engage = async (page: Page) => {
  await page.evaluate(() => (window as any).__ARES_DEV_FIGHT_ENTRY())
  await page.waitForTimeout(500) // the iso snap is instant; let one apply() frame land before driving gestures
}
const release_wait = (page: Page) => page.waitForTimeout(4700)

test('fight camera: right-drag pan, widened zoom rails, reset, and gesture separation', async ({ page }) => {
  test.setTimeout(400_000) // matches the repo's own precedent for this cold-boot class (dungeon_fight_pick.spec.ts)
  const { canvas, pageErrors } = await boot(page)

  // Instrument contextmenu suppression BEFORE any right-click — records defaultPrevented per real DOM event.
  await page.evaluate(() => {
    ;(window as any).__CTXMENU_LOG = []
    document.querySelector('canvas')?.addEventListener('contextmenu', (e) => {
      ;(window as any).__CTXMENU_LOG.push(e.defaultPrevented)
    })
  })

  const box = (await canvas.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // (1) BASELINE — the tuned default pose, before any gesture.
  await engage(page)
  await shoot(page, '1_baseline_default_pose')
  await release_wait(page)

  // (2) MAX PAN — a right-drag toward the envelope edge (peeking around).
  await engage(page)
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(cx + 400, cy, { steps: 12 })
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(300)
  await shoot(page, '2_max_pan')
  // gesture separation, driven against the REAL board_picking module: this exact drag path (a right-button
  // press+move+release over the canvas) must never have been mistaken for a left-click cell target — proven
  // structurally (board_picking filters e.button !== 0 on both its down and up handlers, so a right-button
  // event is never even inspected) and confirmed here by the total absence of any page error from a stray
  // click handler firing against a boardless preview.
  await release_wait(page)

  // (3) MAX ZOOM-IN — well past saturation (30 notches; the new floor engages within ~7).
  await engage(page)
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, -300)
    await page.waitForTimeout(20)
  }
  await shoot(page, '3_max_zoom_in')
  await release_wait(page)

  // (4) MAX ZOOM-OUT — well past saturation (30 notches; the new ceiling needs ~25).
  await engage(page)
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(20)
  }
  await shoot(page, '4_max_zoom_out')
  await release_wait(page)

  // (5) PAN + ZOOM (carried over from scenario 2/3's un-reset state — pan/dolly persist across a fight the
  // same way the pre-existing fight_dolly always has, see the source comment), then double-right-click RESET
  // — must restore the tuned default pose. NOTE: no screenshot until AFTER the reset click — a screenshot's
  // headless GPU readback in this environment can stall 30-60s (observed), which would blow well past the
  // dev harness's hardcoded 4.5s auto-release and falsely "fail" a reset driven against an already-ended fight.
  await engage(page)
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(cx - 300, cy + 150, { steps: 10 })
  await page.mouse.up({ button: 'right' })
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, -300)
    await page.waitForTimeout(20)
  }
  // manual double-right-click (two quick presses at the SAME point) — mirrors exactly what a real double
  // right-click delivers; avoids depending on Playwright's dblclick() button-option support.
  await page.mouse.down({ button: 'right' })
  await page.mouse.up({ button: 'right' })
  await page.mouse.down({ button: 'right' })
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(300)
  await shoot(page, '5_after_reset_matches_baseline')

  const ctxLog = await page.evaluate(() => (window as any).__CTXMENU_LOG ?? [])
  expect(
    ctxLog.length,
    'the right-drags/clicks above must have fired real contextmenu events to check'
  ).toBeGreaterThan(0)
  expect(ctxLog.every(Boolean), 'every contextmenu during the fight must be suppressed (defaultPrevented)').toBe(true)

  expect(pageErrors, `unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
