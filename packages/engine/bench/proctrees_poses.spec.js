// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROCEDURAL TREES pose capture (ENGINE_AAA_PLAN C4 proof bar) — boots the demo at the NEW DEFAULT (no
// proctrees flag ⇒ procedural trees) and captures 6 pinned poses across 3 biomes (taiga incl. a pine_cathedral UNDER-CROWN pose,
// dense_forest, temperate_forest) on the real GPU, asserting the console stays clean of mesher/light
// faults. Anchors located by a gen-side scan of the DEFAULT "aresrpg" world (grove winner + density hit +
// species pick); camera y values computed from anchor_surface at each CAMERA column (not the anchor's).
//
// ONE TEST PER BIOME, fresh page each: a single tab teleporting across ±600 world blocks re-streams the
// whole ring per pose and OOM-crashes the renderer process (first run: Target crashed at pose 5). A fresh
// page per biome bounds tab memory to one region; `load_radius=5` caps the ring (the param wins over the
// tier radius per engine.js) — poses are close-ups, r5 = 160 m of near detail is plenty.
//
// New-default render proof + a ?proctrees=0 legacy A/B (the escape ⇒ a treeless/rock-only world); frozen
// byte-identity + halo-union + determinism live in src/gen/surface_decorator.test.js. Run: `bunx playwright
// test proctrees_poses` (headed Metal).

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { seize_camera, park_camera, settle_stream } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/proctrees'
// The NEW DEFAULT: no proctrees flag ⇒ create_engine's DEFAULT world (trees.procedural true, C4).
const URL = '/demo/?tier=high&load_radius=5'
// The ?proctrees=0 escape: procedural OFF ⇒ a rock-only, treeless world (schematic tree stamps retired).
const URL_LEGACY = '/demo/?proctrees=0&tier=high&load_radius=5'

// Euler convention mirrors demo/main.js: forward = [-sin(yaw), 0, -cos(yaw)]; pitch>0 looks UP.
/** @typedef {{ name: string, pos: [number,number,number], yaw: number, pitch: number }} Pose */

/** @type {Record<string, Pose[]>} */
const BIOME_POSES = {
  // TAIGA — a 56-block mature pine_cathedral anchored at (493,-600), base y=150, crown top ~206.
  taiga: [
    // UNDER-CROWN: eye height on the forest floor (surf 148 at the camera column), 17 blocks out from the
    // bole, looking steeply UP into the needled canopy — the "feel small" cathedral read.
    { name: '1_taiga_pine_undercrown', pos: [505, 150, -588], yaw: Math.PI / 4, pitch: 0.6 },
    // Vista through the pine grove at mid-canopy height (proven pose from the first capture).
    { name: '2_taiga_vista', pos: [458, 172, -635], yaw: Math.PI * 1.25, pitch: -0.16 },
  ],
  // DENSE_FOREST — oak_broadleaf grove near origin, anchor (-107,0) surf 167.
  dense_forest: [
    // Aerial crown view (proven pose from the first capture).
    { name: '3_dense_forest_a', pos: [-137, 183, -30], yaw: Math.PI * 1.25, pitch: -0.22 },
    // High look-down over the grove from the south-east (the near-origin hills rise above a low camera —
    // the first two pins at y 181/147 both ended inside a hillside; the grove reads from ABOVE the ridges).
    { name: '4_dense_forest_b', pos: [-60, 200, 55], yaw: 0.7, pitch: -0.55 },
  ],
  // TEMPERATE_FOREST — oak grove at (-236,-400), surf 160, crown top ~184.
  temperate_forest: [
    // Inside the crown at mid-canopy: the recursive limb skeleton + leaf shell (the "not a lollipop" read).
    { name: '5_temperate_forest_a', pos: [-266, 189, -430], yaw: Math.PI * 1.25, pitch: -0.22 },
    // Level sightline at crown height from 42 blocks out — full-silhouette view over the rising meadow.
    { name: '6_temperate_forest_b', pos: [-206, 170, -370], yaw: Math.PI / 4, pitch: 0.02 },
  ],
}

// Console faults that must NOT appear when the procedural canopy meshes (occupancy misses, TSL/naga
// compile faults, light/shadow relight errors — the §9 risk classes for the tree waves).
const FAULT_RE =
  /mesher|occupancy|invisible|bald|shader|WGSL|naga|nesting|light|shadow|relight|NaN|device lost|boot_error/i

for (const [biome, poses] of Object.entries(BIOME_POSES)) {
  test(`proctrees ON — ${biome}: pinned poses render with zero mesher/light faults`, async ({ page }) => {
    test.setTimeout(180_000)
    await mkdir(OUT, { recursive: true })

    /** @type {string[]} */
    const faults = []
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && FAULT_RE.test(m.text())) faults.push(m.text())
    })
    page.on('pageerror', (e) => faults.push(String(e)))

    await page.goto(URL)
    await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__engine), null, { timeout: 40_000 })
    await seize_camera(page)

    for (const p of poses) {
      await park_camera(page, p.pos, p.yaw, p.pitch)
      await settle_stream(page, { min_ms: 2_800, deadline_ms: 30_000 })
      await page.waitForTimeout(500) // one more beat for the final upload + a clean frame
      const path = `${OUT}/${p.name}.png`
      await page.screenshot({ path })
      console.log(`[proctrees] ${p.name} → ${path}`)
    }

    if (faults.length) console.log('[proctrees] FAULTS:\n' + faults.map((f) => '  ' + f).join('\n'))
    expect(faults).toEqual([]) // zero mesher/light/shader faults across this biome's poses
  })
}

// LEGACY A/B — the ?proctrees=0 escape: procedural OFF ⇒ a rock-only, treeless world (schematic tree stamps
// are retired, so OFF grows NO trees). Captures the same taiga vista as the default for a side-by-side proof
// that the escape works and renders clean — no proc canopy where the new default has a pine cathedral.
test('proctrees=0 escape — taiga vista renders clean with NO procedural trees', async ({ page }) => {
  test.setTimeout(120_000)
  await mkdir(OUT, { recursive: true })

  /** @type {string[]} */
  const faults = []
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && FAULT_RE.test(m.text())) faults.push(m.text())
  })
  page.on('pageerror', (e) => faults.push(String(e)))

  await page.goto(URL_LEGACY)
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__engine), null, { timeout: 40_000 })
  await seize_camera(page)

  const [, p] = BIOME_POSES.taiga // the same taiga vista pose the default captures — an honest A/B frame
  await park_camera(page, p.pos, p.yaw, p.pitch)
  await settle_stream(page, { min_ms: 2_800, deadline_ms: 30_000 })
  await page.waitForTimeout(500)
  const path = `${OUT}/7_legacy_proctrees_off_taiga.png`
  await page.screenshot({ path })
  console.log(`[proctrees] legacy OFF → ${path}`)

  if (faults.length) console.log('[proctrees] FAULTS:\n' + faults.map((f) => '  ' + f).join('\n'))
  expect(faults).toEqual([]) // the escape renders clean (no faults), just no trees
})
