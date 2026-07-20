// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEPTH-FEEL PROOF (the parallax fix — ambient particles read as flat screen-space stickers instead of
// occupying 3D space). The ambient field's positionNode was CAMERA-RELATIVE (a fract wrap inside a box re-centred on the
// camera every frame) ⇒ every mote held a CONSTANT offset from the camera = a HUD sticker. render/particles.js
// now WORLD-ANCHORS the field (mod-wrap of a fixed world position into the moving box), so motes parallax with
// depth and depth-test against scene geometry. This gate proves both tells against the REAL GPU draw
// (demo/particles_probe.html depth rig), each with a NON-VACUOUS metric AND a webm for visual review:
//   (1) PARALLAX — a lateral camera strafe MOVES the world field on screen (depth parallax); the pre-fix
//       camera-locked A/B shim does NOT. Metric: mean-abs luma diff of two frames a strafe apart — world ≫ camera
//       (both fields proven present first, so the ratio can't pass on a blank frame).
//   (2) OCCLUSION — with an opaque wall, depth-tested motes BEHIND it vanish; forcing depthTest off (the HUD
//       bug) draws them on top. Metric: bright-mote pixels over the wall — depthTest-on ≪ depthTest-off.
// Artifacts (stills + webms) → /tmp/aresrpg-engine-artifacts. Standalone probe on its own WebGPURenderer (the
// live engine's ambient draw isn't exposed to the bench — particle_gauntlet.spec.js rationale).
// Run: ARES_DEMO_ORIGIN=http://localhost:<port> bunx playwright test particle_depth (headed Metal, 720p).

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN } from './harness.js'
import { open_recorded_page } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/particle_depth'
const luma = (hex) => 0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)

/** Wait for the probe's first frame (or surface its init error). @param {import('@playwright/test').Page} page */
async function wait_ready(page) {
  await page.waitForFunction(
    () => Boolean(/** @type {any} */ (window).__probe_ready) || Boolean(/** @type {any} */ (window).__probe_err),
    null,
    { timeout: 40_000 }
  )
  const err = await page.evaluate(() => /** @type {any} */ (window).__probe_err ?? null)
  expect(err, `probe init error: ${err}`).toBeNull()
}

/** Compositor screenshot as a data URL (WebGPU swapchain readback is black via drawImage; page.screenshot is
 *  the compositor — the sanctioned path, see harness.js). @param {import('@playwright/test').Page} page */
async function shot(page) {
  return `data:image/png;base64,${(await page.screenshot()).toString('base64')}`
}

/** @param {string} data_url @param {string} path */
async function save(data_url, path) {
  await writeFile(path, Buffer.from(data_url.split(',')[1], 'base64'))
}

/** Mean absolute luma difference between two frames over ALL pixels (static bg/geometry ⇒ 0; only what MOVED
 *  on screen contributes). @param {import('@playwright/test').Page} page @param {string} a @param {string} b */
async function mean_abs_diff(page, a, b) {
  return page.evaluate(
    async ({ a, b }) => {
      const load = (/** @type {string} */ u) =>
        new Promise((res, rej) => {
          const im = new Image()
          im.onload = () => res(im)
          im.onerror = rej
          im.src = u
        })
      const [ia, ib] = /** @type {[HTMLImageElement, HTMLImageElement]} */ (await Promise.all([load(a), load(b)]))
      const draw = (/** @type {HTMLImageElement} */ im) => {
        const cv = document.createElement('canvas')
        cv.width = im.width
        cv.height = im.height
        const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))
        g.drawImage(im, 0, 0)
        return g.getImageData(0, 0, im.width, im.height).data
      }
      const da = draw(ia)
      const db = draw(ib)
      let sum = 0
      let n = 0
      for (let i = 0; i < da.length; i += 4) {
        const la = 0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2]
        const lb = 0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2]
        sum += Math.abs(la - lb)
        n += 1
      }
      return sum / Math.max(n, 1)
    },
    { a, b }
  )
}

/** Count pixels brighter than `thresh` (a mote over darker geometry) inside a normalised screen rect.
 * @param {import('@playwright/test').Page} page @param {string} url @param {number} thresh
 * @param {{x0:number,y0:number,x1:number,y1:number}} rect */
async function bright_in_rect(page, url, thresh, rect) {
  return page.evaluate(
    async ({ url, thresh, rect }) => {
      const im = await new Promise((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = rej
        i.src = url
      })
      const img = /** @type {HTMLImageElement} */ (im)
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, img.width, img.height).data
      const x0 = Math.floor(rect.x0 * img.width)
      const x1 = Math.floor(rect.x1 * img.width)
      const y0 = Math.floor(rect.y0 * img.height)
      const y1 = Math.floor(rect.y1 * img.height)
      let n = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * img.width + x) * 4
          if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > thresh) n += 1
        }
      }
      return n
    },
    { url, thresh, rect }
  )
}

/** @param {Record<string,string>} params */
function probe_url(params) {
  const url = new URL(`${DEMO_ORIGIN}/demo/particles_probe.html`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

/** Set the (frozen-field) camera X and let a few frames reposition + render. Under ?freeze the field is static
 *  in time, so this wait adds NO temporal drift — only the camera moves. @param {import('@playwright/test').Page}
 *  page @param {number} x */
async function settle_camx(page, x) {
  await page.evaluate((x) => {
    const w = /** @type {any} */ (window)
    return new Promise((res) => {
      w.__probe.camx = x
      let n = 0
      const tick = () => (++n >= 4 ? res(undefined) : requestAnimationFrame(tick))
      requestAnimationFrame(tick)
    })
  }, x)
}

// ── (1) PARALLAX — world field sweeps on a strafe; the camera-locked shim does not ──────────────────
test('parallax — a strafe MOVES the world field on screen; the pre-fix camera-locked field does not', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await mkdir(OUT, { recursive: true })
  const bg = luma(0x14140f) // kind=mote background
  const full = { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 }
  /** @type {Record<string, number>} */
  const strafe_diff = {}
  /** @type {Record<string, number>} */
  const frozen_self = {}
  /** @type {Record<string, number>} */
  const present = {}
  for (const anchor of ['camera', 'world']) {
    // ?freeze pins the field's TIME + gust after warm-up, so ONLY the 6 m camera strafe moves it — no temporal
    // sway to relocate the 1 px motes and saturate the frame diff. A world-anchored mote then parallaxes on
    // screen; a camera-locked one stays glued.
    await page.goto(probe_url({ scene: 'bare', kind: 'mote', count: '4000', anchor, camx: '-9', freeze: '1' }))
    await wait_ready(page)
    await page.waitForTimeout(1400) // settle + the freeze latches
    const frozen = await page.evaluate(() => /** @type {any} */ (window).__frozen_time ?? null)
    expect(frozen, `${anchor}: the field's time did not freeze`).not.toBeNull()
    const a = await shot(page)
    await settle_camx(page, -9) // SAME camx ⇒ the frozen self-check (must be identical)
    const a2 = await shot(page)
    await settle_camx(page, -3) // strafe +6 m ⇒ the parallax signal
    const b = await shot(page)
    frozen_self[anchor] = await mean_abs_diff(page, a, a2)
    strafe_diff[anchor] = await mean_abs_diff(page, a, b)
    present[anchor] = await bright_in_rect(page, a, bg + 40, full)
    await save(a, `${OUT}/parallax_${anchor}_A_camx-9.png`)
    await save(b, `${OUT}/parallax_${anchor}_B_camx-3.png`)
    console.log(
      `[depth] parallax ${anchor}: frozenSelf=${frozen_self[anchor].toFixed(3)} strafeDiff=${strafe_diff[
        anchor
      ].toFixed(3)} brightPx=${present[anchor]}`
    )
  }
  // FREEZE VALIDATED (metric honesty): with time pinned, two SAME-camx frames are identical — so any strafe
  // diff below is purely the camera move, not leftover temporal drift.
  expect(frozen_self.world, 'freeze holds the world field static at fixed camx').toBeLessThan(0.03)
  expect(frozen_self.camera, 'freeze holds the camera field static at fixed camx').toBeLessThan(0.03)
  // NON-VACUOUS: both fields actually rendered motes (else a blank frame would trivially pass the ratio).
  expect(present.world, 'world field rendered motes').toBeGreaterThan(300)
  expect(present.camera, 'camera-locked field rendered motes').toBeGreaterThan(300)
  // PARALLAX: the world field moves under the strafe; the camera-locked field stays glued to the screen (~0).
  expect(strafe_diff.camera, 'camera-locked field is glued to the screen (no parallax = the sticker bug)').toBeLessThan(
    0.03
  )
  expect(strafe_diff.world, 'world field parallaxes under the strafe').toBeGreaterThan(0.05)
  expect(strafe_diff.world, 'world parallax ≫ camera-locked sticker').toBeGreaterThan(strafe_diff.camera * 3)
})

// ── (2) OCCLUSION — an opaque wall hides the motes behind it (depth test lives) ─────────────────────
test('occlusion — depth-tested motes vanish behind an opaque wall; forcing depthTest off draws them on top', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await mkdir(OUT, { recursive: true })
  const wall_rect = { x0: 0.4, y0: 0.15, x1: 0.6, y1: 0.85 } // the world-fixed wall's screen area at camx=0
  const MOTE_OVER_WALL = 130 // luma above the lit wall (~99) — a mote drawn over the wall, not the bare wall
  /** @type {Record<string, number>} */
  const over_wall = {}
  for (const depthtest of ['1', '0']) {
    await page.goto(probe_url({ scene: 'occluder', kind: 'mote', count: '4000', camx: '0', depthtest }))
    await wait_ready(page)
    await page.waitForTimeout(1400)
    const s = await shot(page)
    over_wall[depthtest] = await bright_in_rect(page, s, MOTE_OVER_WALL, wall_rect)
    await save(s, `${OUT}/occluder_depthtest${depthtest}_camx0.png`)
    console.log(`[depth] occluder depthTest=${depthtest}: brightMotesOverWall=${over_wall[depthtest]}`)
  }
  // NON-VACUOUS: with depthTest OFF the field visibly draws over the wall region.
  expect(over_wall['0'], 'field present over the wall with depthTest off').toBeGreaterThan(50)
  // OCCLUSION: with depthTest ON, the motes behind the wall are gone — far fewer bright motes over the wall.
  expect(over_wall['1'], 'depth-tested motes behind the wall are occluded').toBeLessThan(over_wall['0'] * 0.7)
})

// ── (3) WEBMS — visual review: strafe parallax + walk-behind-occluder on the SHIPPED ambient field ─
test('strafe parallax webm — the shipped ambient field sweeps against the depth posts', async ({ browser }) => {
  test.setTimeout(60_000)
  const { page, finish } = await open_recorded_page(browser, 'particle_depth')
  try {
    await page.goto(probe_url({ scene: 'parallax', kind: 'ambient', count: '2500', anchor: 'world', strafe: '1' }))
    await wait_ready(page)
    await page.waitForTimeout(9_000) // ~9 s lateral strafe recorded (posts + motes parallax by depth)
  } finally {
    const webm = await finish('strafe_parallax')
    console.log(`[depth] strafe webm → ${webm || 'NOT SAVED'}`)
  }
})

test('walk-behind-occluder webm — motes vanish behind the wall as the camera strafes', async ({ browser }) => {
  test.setTimeout(60_000)
  const { page, finish } = await open_recorded_page(browser, 'particle_depth')
  try {
    await page.goto(probe_url({ scene: 'occluder', kind: 'ambient', count: '2500', anchor: 'world', strafe: '1' }))
    await wait_ready(page)
    await page.waitForTimeout(9_000) // ~9 s strafe: the field passes behind the opaque wall and is occluded
  } finally {
    const webm = await finish('occluder_walk')
    console.log(`[depth] occluder webm → ${webm || 'NOT SAVED'}`)
  }
})
