// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// UNDERWATER BUBBLE-FOG PROOF (invisible-submerged-bubble fix, 2026-07-12). Proves the one-line root-cause
// fix in src/render/particles.js: the ambient BUBBLE material now writes its OWN depth (depthWrite:true).
//
// ROOT CAUSE (ambience.js / particles.js notes): the underwater immersion fog (render/lighting/underwater.js
// `apply()`, woven at post_stack.js) grades EVERY pixel by frag_dist reconstructed from the OPAQUE
// scene_depth buffer. A depthWrite:false bubble left the depth of the FAR surface BEHIND it in that buffer,
// so the post fogged the bubble by that far distance (open water ⇒ dist ≫ visibility_m 15 ⇒ fog≈1) and
// `mix(col, target, fog)` overwrote it with flat murk — the bubble vanished. FIX: writing the bubble's OWN
// (near) depth makes the SAME post grade each bubble by its true distance — near bubbles read through, far
// bubbles dissolve into the murk (physically honest, no extra pass / mask / fog rework).
//
// ⚠️ GPU-PRESSURE GATE (the 2026-07-12 WindowServer crash): a headed Metal bench while another GPU session is
// actively rendering can freeze macOS. This proof is SKIPPED by default so a `bun run bench` sweep never
// fires a Metal rig. Run it EXPLICITLY, in an OWNER-IDLE window, on your own port:
//     BUBBLE_PROOF=1 bun run bench -- underwater_bubbles_fog.spec.js
// Artifacts → /tmp/aresrpg-engine-artifacts/underwater/bubbles_fog_{fix,bug,off}.png + _report.json.
//
// A/B (same pose, same frame, only ONE knob moves per capture — isolates the fix from scene content):
//   • FIX = depthWrite:true  + underwater active 1  → bubbles VISIBLE, fading by their own depth.
//   • BUG = depthWrite:false + underwater active 1  → bubbles ERASED by the post fog (the old behaviour).
//   • OFF = depthWrite:true  + underwater active 0  → fog bypassed: the bubble ground-truth (parity ref).
// The bright-speck count (pale cyan-white bubbles against the dark murk) is the metric: FIX ≫ BUG proves
// the fog no longer erases them; FIX ≈ OFF proves near bubbles survive the fog (the brief's parity bar).

import { writeFile, mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { open_recorded_page, park_camera, seize_camera, settle_stream } from './_shared.js'
import { goto_demo } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts/underwater'
const SETTLE = { min_ms: 2000, deadline_ms: 20000 }
// Deep lake near spawn (eng13_underwater-verified): water cells y110..127 ⇒ surface plane world-y 128, bed
// sand y109. Eye at y=122 (6 m under) looking LEVEL into open water = the exact erasure condition (the far
// surface behind the near bubbles is well past visibility_m, so the pre-fix post fog wiped them).
const LAKE = { wx: 31, wz: 171 }

const RUN = process.env.BUBBLE_PROOF === '1'
const proof = RUN ? test : test.skip

/** Two rAF beats so a knob flip (depthWrite / active) is on-screen before the screenshot. */
const beat2 = (/** @type {import('@playwright/test').Page} */ page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

/**
 * Count "bubble specks": decode the canvas screenshot, take the median luma (the murk floor), and count
 * pixels whose luma exceeds median + DELTA — the pale cyan-white bubbles read as bright spikes over the
 * uniform murk, so this cleanly separates "bubbles present" (many specks) from "erased" (≈none).
 * @param {import('@playwright/test').Page} page @returns {Promise<{ specks:number, median:number, px:number }>}
 */
async function bubble_specks(page) {
  const src = `data:image/png;base64,${(await page.locator('#canvas').screenshot()).toString('base64')}`
  return page.evaluate(async (data) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = data
    })
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    const px = d.length / 4
    const lumas = new Float32Array(px)
    for (let i = 0, j = 0; i < d.length; i += 4, j += 1)
      lumas[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    const sorted = Float32Array.from(lumas).sort()
    const median = sorted[Math.floor(px / 2)]
    const DELTA = 42 // luma over the murk floor that a bubble speck clears (8-bit; ~1/6 range)
    let specks = 0
    for (let j = 0; j < px; j += 1) if (lumas[j] > median + DELTA) specks += 1
    return { specks, median, px }
  }, src)
}

proof('underwater bubbles survive the immersion fog + fade by their own depth', async ({ browser }) => {
  test.setTimeout(180_000)
  await mkdir(OUT, { recursive: true })

  // Modest viewport — this is a STILL probe, not the perf gate — to keep the Metal footprint light.
  const { page, finish } = await open_recorded_page(browser, 'bubbles_fog', { width: 1600, height: 900 })
  await goto_demo(page, { tier: 'high', timeout_ms: 60_000 }) // high ⇒ weather budget > 0 ⇒ a real bubble field
  await seize_camera(page)

  await park_camera(page, [LAKE.wx, 122, LAKE.wz], Math.PI / 4, 0.0)
  await settle_stream(page, SETTLE)

  // Wait for the ambience director to swap to the bubble kind, bake the seed compute, and crossfade in.
  const bubble_state = () =>
    page.evaluate(() => {
      const a = /** @type {any} */ (window).__ambience
      const b = (a?.debug_slots?.() ?? []).find((/** @type {any} */ s) => s.kind === 'bubble')
      return b ? { baked: b.baked, cur: b.cur, visible: b.visible, count: b.count } : null
    })
  const deadline = Date.now() + 15000
  let bstate = null
  while (Date.now() < deadline) {
    bstate = await bubble_state()
    if (bstate && bstate.baked && bstate.visible && bstate.cur > 0.2) break
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)))
  }
  expect(bstate, 'bubble slot exists').toBeTruthy()
  expect(bstate?.baked && bstate?.visible, `bubble field baked+visible (got ${JSON.stringify(bstate)})`).toBe(true)

  // Grab the bubble InstancedMesh: post-fix it is the ONLY ambient sprite writing depth (the discriminator).
  const found = await page.evaluate(() => {
    const w = /** @type {any} */ (window)
    let mesh = null
    w.__ares_scene__?.traverse?.((/** @type {any} */ o) => {
      if (o.isInstancedMesh && o.material && o.material.depthWrite === true && o.material.isSpriteNodeMaterial) mesh = o
    })
    if (mesh) w.__bubble_mesh = mesh
    return { ok: !!mesh, count: mesh?.count ?? null }
  })
  expect(found.ok, 'bubble mesh found via depthWrite discriminator (the fix is live)').toBe(true)

  /** Force the two knobs, force a pipeline rebuild for depthWrite, and settle. */
  const set_state = (depth_write, active) =>
    page.evaluate(
      ({ dw, act }) => {
        const w = /** @type {any} */ (window)
        const m = w.__bubble_mesh.material
        if (m.depthWrite !== dw) {
          m.depthWrite = dw
          m.needsUpdate = true // depthWrite is a render-pipeline state ⇒ force the WebGPU pipeline to rebuild
        }
        const u = w.__underwater
        u.__real_update ??= u.update
        u.update = () => {} // freeze the CPU push so our forced `active` holds across frames
        u.active.value = act
      },
      { dw: depth_write, act: active }
    )
  const restore = () =>
    page.evaluate(() => {
      const w = /** @type {any} */ (window)
      const u = w.__underwater
      if (u.__real_update) {
        u.update = u.__real_update
        delete u.__real_update
      }
      w.__bubble_mesh.material.depthWrite = true
      w.__bubble_mesh.material.needsUpdate = true
    })

  // FIX — depthWrite:true + fog on: bubbles visible.
  await set_state(true, 1)
  await beat2(page)
  await beat2(page)
  const fix = await bubble_specks(page)
  await writeFile(`${OUT}/bubbles_fog_fix.png`, await page.locator('#canvas').screenshot())
  // BUG — depthWrite:false + fog on: the old erased behaviour.
  await set_state(false, 1)
  await beat2(page)
  await beat2(page)
  const bug = await bubble_specks(page)
  await writeFile(`${OUT}/bubbles_fog_bug.png`, await page.locator('#canvas').screenshot())
  // OFF — depthWrite:true + fog off: the bubble ground-truth (parity reference).
  await set_state(true, 0)
  await beat2(page)
  await beat2(page)
  const off = await bubble_specks(page)
  await writeFile(`${OUT}/bubbles_fog_off.png`, await page.locator('#canvas').screenshot())

  await restore()

  const report = { lake: LAKE, eye_y: 122, bubble: bstate, mesh_count: found.count, fix, bug, off }
  await writeFile(`${OUT}/bubbles_fog_report.json`, JSON.stringify(report, null, 2))
  console.log('[bubbles-fog] specks  fix/bug/off =', fix.specks, '/', bug.specks, '/', off.specks)
  console.log(
    '[bubbles-fog] median  fix/bug/off =',
    fix.median.toFixed(1),
    '/',
    bug.median.toFixed(1),
    '/',
    off.median.toFixed(1)
  )

  // The fog no longer erases the bubbles: FIX restores the specks the BUG (old behaviour) wiped.
  expect(fix.specks, 'fix restores far more bubble specks than the erased (bug) state').toBeGreaterThan(bug.specks * 3)
  // Near bubbles survive the fog: FIX has at least half the fog-off ground-truth speck count (parity bar).
  expect(fix.specks, 'fog-on near bubbles ≈ fog-off ground truth (parity)').toBeGreaterThan(off.specks * 0.5)
})
