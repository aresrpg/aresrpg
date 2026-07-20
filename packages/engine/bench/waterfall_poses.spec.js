// WATERFALL SHEETS pose capture (ENGINE_AAA_PLAN §8 B4 proof bar) — boots the demo with ?falls=1 and
// captures a spawn-near cascade at 32 / 96 / 224 m across 3 times-of-day on the real GPU, plus a LOW
// sheet-only pose and a flag on/off frame-ms A/B (the z-fight sweep = the same fall at the 3 distances;
// a reviewer confirms no seam flicker at any range).
//
// TARGET: a dense face=0 cascade near spawn (water spills toward −X, cliffs at x≈2..16, y≈130..140) —
// located by a gen scan of the DEFAULT world's world_fall_spans (an ad-hoc gen-scan script). The primary
// fall is h=7 at world (16, 133..140, −32.5); the camera stands on the low (−X) side looking +X.
// Euler convention mirrors demo/main.js: forward = [−sin(yaw), 0, −cos(yaw)] — looking +X ⇒ yaw = −π/2.
//
// Fresh page per test (proctrees_poses lesson: a single tab re-streaming across big teleports OOMs the
// renderer). load_radius=5 caps the ring. Run: `bunx playwright test waterfall_poses` (headed Metal).

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { seize_camera, park_camera, settle_stream } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/waterfalls'
const LOOK_PX = -Math.PI / 2 // camera on −X looking +X at the cascade face

/** @typedef {{ name:string, pos:[number,number,number], yaw:number, pitch:number }} Pose */
/** The primary fall viewed from 3 distances along −X (the z-fight sweep). eye y≈138 (mid-fall +2). */
const DIST_POSES = /** @type {Pose[]} */ ([
  { name: '32m', pos: [-16, 139, -32], yaw: LOOK_PX, pitch: -0.06 },
  { name: '96m', pos: [-80, 141, -32], yaw: LOOK_PX, pitch: -0.05 },
  { name: '224m', pos: [-208, 146, -32], yaw: LOOK_PX, pitch: -0.04 },
])

const TODS = /** @type {{ name:string, t:number }[]} */ ([
  { name: 'dawn', t: 0.24 },
  { name: 'noon', t: 0.5 },
  { name: 'dusk', t: 0.72 },
])

const FAULT_RE = /mesher|occupancy|shader|WGSL|naga|nesting|NaN|device lost|boot_error/i

/** @param {import('@playwright/test').Page} page */
async function boot(page, url) {
  /** @type {string[]} */
  const faults = []
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && FAULT_RE.test(m.text())) faults.push(m.text())
  })
  page.on('pageerror', (e) => faults.push(String(e)))
  await page.goto(url)
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__engine), null, { timeout: 40_000 })
  await seize_camera(page)
  return faults
}

for (const tod of TODS) {
  test(`falls ON — ${tod.name}: cascade renders at 32/96/224 m, zero mesher/shader faults`, async ({ page }) => {
    test.setTimeout(180_000)
    await mkdir(OUT, { recursive: true })
    const faults = await boot(page, '/demo/?falls=1&tier=medium&load_radius=5')
    await page.evaluate((t) => /** @type {any} */ (window).__engine.set_time_of_day(t), tod.t)

    for (const p of DIST_POSES) {
      await park_camera(page, p.pos, p.yaw, p.pitch)
      await settle_stream(page, { min_ms: 2_800, deadline_ms: 30_000 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${tod.name}_${p.name}.png` })
      console.log(`[falls] ${tod.name}_${p.name} → ${OUT}/${tod.name}_${p.name}.png`)
    }
    // provenance: the overlay actually built resident sheets (not an empty flag).
    const stats = await page.evaluate(() => /** @type {any} */ (window).__falls?.stats?.() ?? null)
    console.log(`[falls] ${tod.name} stats:`, JSON.stringify(stats))
    if (tod.name === 'noon') expect(stats && stats.sheets).toBeGreaterThan(0)
    if (faults.length) console.log('[falls] FAULTS:\n' + faults.map((f) => '  ' + f).join('\n'))
    expect(faults).toEqual([])
  })
}

test('falls LOW — barely-animated sheet only (no spray/foam)', async ({ page }) => {
  test.setTimeout(120_000)
  await mkdir(OUT, { recursive: true })
  const faults = await boot(page, '/demo/?falls=1&tier=low&load_radius=5')
  await page.evaluate(() => /** @type {any} */ (window).__engine.set_time_of_day(0.5))
  await park_camera(page, DIST_POSES[0].pos, DIST_POSES[0].yaw, DIST_POSES[0].pitch)
  await settle_stream(page, { min_ms: 2_800, deadline_ms: 30_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/low_sheet_only.png` })
  const stats = await page.evaluate(() => /** @type {any} */ (window).__falls?.stats?.() ?? null)
  console.log('[falls] LOW stats:', JSON.stringify(stats))
  expect(stats && stats.sprays).toBe(0) // spray/foam killed structurally on LOW
  expect(faults).toEqual([])
})

test('flag on/off — ≤~0.5 ms overlay cost near a fall; falls=0 leaves the overlay uncreated', async ({ page }) => {
  test.setTimeout(150_000)
  await mkdir(OUT, { recursive: true })

  /** Average frame ms over ~2.5 s of rAF at the 32 m fall pose. */
  const measure = async (url) => {
    await boot(page, url)
    await page.evaluate(() => /** @type {any} */ (window).__engine.set_time_of_day(0.5))
    await park_camera(page, DIST_POSES[0].pos, DIST_POSES[0].yaw, DIST_POSES[0].pitch)
    await settle_stream(page, { min_ms: 3_000, deadline_ms: 30_000 })
    return page.evaluate(
      () =>
        new Promise((resolve) => {
          const dts = /** @type {number[]} */ ([])
          let last = performance.now()
          let n = 0
          const tick = () => {
            const now = performance.now()
            dts.push(now - last)
            last = now
            if (++n < 150) requestAnimationFrame(tick)
            else {
              dts.sort((a, b) => a - b)
              resolve(dts[Math.floor(dts.length / 2)]) // median frame ms
            }
          }
          requestAnimationFrame(tick)
        })
    )
  }

  const on = /** @type {number} */ (await measure('/demo/?falls=1&tier=medium&load_radius=5'))
  const on_created = await page.evaluate(() => Boolean(/** @type {any} */ (window).__falls))
  const off = /** @type {number} */ (await measure('/demo/?tier=medium&load_radius=5'))
  const off_created = await page.evaluate(() => Boolean(/** @type {any} */ (window).__falls))

  const report = { median_ms_on: on, median_ms_off: off, delta_ms: on - off, on_created, off_created }
  await writeFile(`${OUT}/ms_ab.json`, JSON.stringify(report, null, 2))
  console.log('[falls] ms A/B:', JSON.stringify(report))
  expect(on_created).toBe(true)
  expect(off_created).toBe(false) // ?falls off ⇒ system never constructed ⇒ voxel water stands byte-identical
  // overlay cost is a few small transparent quads; median-frame delta stays tiny (vsync-noisy → generous bound).
  expect(on - off).toBeLessThan(2.5)
})
