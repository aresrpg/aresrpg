// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// B5 BIOME MOOD acceptance capture (real-GPU headed). Proves the ?mood=1 crossfader end-to-end on the
// running engine: crossing a biome border smoothly crossfades the atmosphere mood over ~4 s with NO POP.
//
// The ASSERTED proof is the driver's own interpolated state — window.__mood.current() exposes the live
// {biome, blend, dials} every frame. It is READ-BACK INDEPENDENT of rendering, so it proves the crossfade
// even when a cold-teleport loses the block-atlas streaming race (the documented 256-layer overflow that
// can black a frame — see godrays_gain.spec.js). The 3 archived stills are best-effort VISUAL evidence.
//
// Protocol: boot ?mood=1&nocam=1 (we own the camera; the demo's rAF loop must not overwrite our pose) →
// scan spread columns for two DISTINCT biomes → settle at A → step to B → poll the driver for ~6.5 s,
// recording the dial with the largest A→B delta → assert that series is monotone, pop-free, and lands on
// B; blend settles to 1. Screenshots + the numeric trace JSON land under /tmp/aresrpg-engine-artifacts/.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '@playwright/test'

import {
  DEMO_ORIGIN,
  RESULTS_DIR,
  probe_gpu_adapter,
  attach_gpu_error_watcher,
  capture_canvas_screenshot,
} from './harness.js'

const DIAL_KEYS = [
  'near_haze',
  'cloud_coverage',
  'contrast',
  'fog_sea',
  'cloud_density',
  'particle_opacity',
  'vibrance',
]
// spread columns (within any world border) — biome climate noise turns over within a few hundred blocks.
const SCAN = [
  [0, 0],
  [800, 0],
  [-800, 0],
  [0, 800],
  [0, -800],
  [1200, 1200],
  [-1200, -1200],
  [1200, -1200],
  [-1500, 600],
  [600, -1500],
]

test.describe('B5 biome mood crossfader', () => {
  test('crossing a biome border crossfades the mood over ~4 s with no pop', async ({ page }) => {
    const watcher = attach_gpu_error_watcher(page)
    const url = new URL(`${DEMO_ORIGIN}/demo/index.html`)
    url.searchParams.set('seed', 'aresrpg')
    url.searchParams.set('tier', 'high') // full atmosphere stack
    url.searchParams.set('mood', '1') // arm the crossfader
    url.searchParams.set('nocam', '1') // WE own the camera pose
    await page.goto(url.toString())
    await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 })
    expect((await probe_gpu_adapter(page)).ok, 'hardware GPU required (§7)').toBeTruthy()
    expect(
      await page.evaluate(() => !!(/** @type {any} */ (window).__mood)),
      '?mood=1 must create the driver'
    ).toBeTruthy()

    const teleport = (x, y, z, yaw = Math.PI / 4, pitch = -0.15) =>
      page.evaluate(
        ({ x, y, z, yaw, pitch }) => {
          // single cast local — two consecutive `(window).x` statements ASI-glue into a call (engine.js:524).
          const e = /** @type {any} */ (window).__engine
          e.set_camera_position([x, y, z])
          e.set_camera_orientation(yaw, pitch)
        },
        { x, y, z, yaw, pitch }
      )
    const mood_state = () => page.evaluate(() => /** @type {any} */ (window).__mood.current())

    await page.evaluate((t) => /** @type {any} */ (window).__engine.set_time_of_day(t), 0.32) // late-morning key light

    // ── SCAN: record each column's biome (settles within the 1 s probe interval) until 2 differ ──────
    /** @type {Array<{x:number,z:number,biome:number}>} */ const found = []
    for (const [x, z] of SCAN) {
      await teleport(x, 180, z)
      await page.waitForTimeout(1400) // > the 1 s biome-probe interval → .biome reflects this column
      found.push({ x, z, biome: (await mood_state()).biome })
      if (new Set(found.map((f) => f.biome)).size >= 2) break // a distinct pair is enough
    }
    const [A] = found
    const B = found.find((f) => f.biome !== A.biome)
    if (!B) throw new Error(`scan found no two distinct biomes in ${JSON.stringify(found.map((f) => f.biome))}`)

    // ── SETTLE AT A ──────────────────────────────────────────────────────────────────────────────
    await teleport(A.x, 180, A.z)
    await page.waitForTimeout(5200)
    const dialsA = (await mood_state()).dials
    const shot_a = await capture_canvas_screenshot(page, `biome_mood_A_biome${A.biome}`)

    // ── STEP ACROSS THE BORDER → poll the live crossfade ─────────────────────────────────────────
    await teleport(B.x, 180, B.z)
    const t0 = Date.now()
    /** @type {Array<any>} */ const trace = []
    let shot_mid = null
    while (Date.now() - t0 < 6500) {
      const el = Date.now() - t0
      const st = await mood_state()
      trace.push({ ms: el, blend: +st.blend.toFixed(4), biome: st.biome, ...st.dials })
      if (!shot_mid && el > 2200) shot_mid = await capture_canvas_screenshot(page, 'biome_mood_mid_crossfade')
      await page.waitForTimeout(80)
    }
    const dialsB = (await mood_state()).dials
    const shot_b = await capture_canvas_screenshot(page, `biome_mood_B_biome${B.biome}`)

    // signal dial = the one that moved most from A→B; its series is the crossfade fingerprint.
    const key = DIAL_KEYS.reduce(
      (best_k, k) => (Math.abs(dialsB[k] - dialsA[k]) > Math.abs(dialsB[best_k] - dialsA[best_k]) ? k : best_k),
      DIAL_KEYS[0]
    )
    const series = trace.map((p) => p[key])
    const range = Math.abs(dialsB[key] - dialsA[key]) || 1
    const dir = Math.sign(dialsB[key] - dialsA[key])
    let worst_reversal = 0
    let max_step = 0
    for (let i = 1; i < series.length; i++) {
      worst_reversal = Math.min(worst_reversal, dir * (series[i] - series[i - 1]))
      max_step = Math.max(max_step, Math.abs(series[i] - series[i - 1]))
    }
    const max_blend = Math.max(...trace.map((p) => p.blend))
    const saw_fade_start = trace.some((p) => p.blend < 0.1) // the retarget reset blend → the fade actually ran

    // CURVE-FIT no-pop metric (frame-hitch invariant): the driver computes dial = A + (B−A)·smoothstep(blend)
    // exactly, so every post-retarget poll must lie ON that curve — ANY visual pop (a discontinuity) breaks
    // the fit, while a cold-streaming long frame (big Δt ⇒ big Δblend ⇒ big Δdial) stays perfectly on it.
    const smooth = (b) => {
      const u = b < 0 ? 0 : b > 1 ? 1 : b
      return u * u * (3 - 2 * u)
    }
    let max_curve_err = 0
    for (const p of trace) {
      if (p.biome !== B.biome) continue // only the crossfade toward B (post-retarget)
      const expected = dialsA[key] + (dialsB[key] - dialsA[key]) * smooth(p.blend)
      max_curve_err = Math.max(max_curve_err, Math.abs(p[key] - expected))
    }

    await mkdir(RESULTS_DIR, { recursive: true })
    const trace_path = path.join(RESULTS_DIR, 'biome_mood_trace.json')
    await writeFile(
      trace_path,
      JSON.stringify(
        {
          A: { biome: A.biome, dials: dialsA },
          B: { biome: B.biome, dials: dialsB },
          signal_dial: key,
          range,
          max_step_ratio: max_step / range,
          curve_err_ratio: max_curve_err / range,
          worst_reversal,
          max_blend,
          trace,
        },
        null,
        2
      ),
      'utf8'
    )

    console.log(
      `\n[biome mood] ${A.biome} → ${B.biome} · signal=${key} · ` +
        `start=${series[0].toFixed(4)} end=${series.at(-1).toFixed(4)} (target ${dialsB[key].toFixed(4)}) · ` +
        `curve_err/range=${(max_curve_err / range).toFixed(4)} · worst_reversal=${worst_reversal.toExponential(1)} · max_blend=${max_blend}` +
        `\n[biome mood] artifacts —\n  ${[shot_a, shot_mid, shot_b]
          .filter(Boolean)
          .map((s) => s.path)
          .join('\n  ')}\n  ${trace_path}`
    )

    // ── ASSERTS (on the live driver trace — render-independent) ───────────────────────────────────
    expect(saw_fade_start, 'the border crossing must trigger a fresh crossfade (blend reset toward 0)').toBeTruthy()
    // ENDPOINTS: starts at A's settled value, lands on B's.
    expect(Math.abs(series[0] - dialsA[key]) / range, 'crossfade must START at biome A').toBeLessThan(0.1)
    expect(Math.abs(series.at(-1) - dialsB[key]) / range, 'crossfade must REACH biome B').toBeLessThan(0.05)
    expect(max_blend, 'the crossfade must settle (blend → 1)').toBeGreaterThan(0.98)
    // MONOTONE + ON-CURVE: never reverses direction, and every sample lies on the exact smoothstep curve
    // (no pop). A frame-time hitch moves far along the curve in one step but never OFF it.
    expect(worst_reversal, 'the mood must not reverse mid-crossfade (pop)').toBeGreaterThan(-0.02 * range)
    expect(max_curve_err / range, 'every sample must lie on the smoothstep crossfade curve (no pop)').toBeLessThan(0.03)

    // no MOOD-induced GPU errors (the pre-existing block-atlas 256-layer overflow is filtered — see header).
    const mood_errors = watcher.errors.filter(
      (e) => !/depthorarraylayers|maxtexturearraylayers|exceeded maximum texture size|invalid texture/i.test(e)
    )
    expect(mood_errors, mood_errors.join('\n')).toHaveLength(0)
  })
})
