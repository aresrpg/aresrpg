// M0 scenario (a) — "7×7-chunk island at 120 fps on the Studio" (§8 M0 checkpoint).
// Loads the demo at the default seed, waits for the world to settle, captures 60 frames,
// writes the §7 JSON result + a committed screenshot, and asserts the canvas is NOT all-black.
// Requires a hardware WebGPU adapter (probe_gpu_adapter fails fast on SwiftShader/software
// adapters and CI headless runs per §7 — see harness.js).
//
// ORDERING NOTE: the GPU adapter probe runs AFTER goto_demo(), never before. Chromium does not
// expose navigator.gpu on the initial about:blank page under automation — it only appears once a
// real http document is loaded, so probing first falsely fails the gate on capable hardware.

import { test, expect } from '@playwright/test'

import { MASTER_SEED } from '../src/config/world_config.js'

import {
  goto_demo,
  probe_gpu_adapter,
  capture_frames,
  capture_canvas_screenshot,
  sample_canvas_colors,
  attach_gpu_error_watcher,
  build_result,
  write_result,
} from './harness.js'

const SCENARIO = 'island_7x7'
const SETTLE_MS = 3000 // let streaming/mesh queues drain before sampling (§7 "load, settle")
const FRAME_SAMPLE_COUNT = 60
const TARGET_FPS = 120
// Headed Chromium's rAF is vsync-locked, so raw deltas quantize to the display refresh interval
// (~8.333ms at 120Hz) with sub-ms jitter — a p75 of 8.6ms with avg_fps 119.998 IS the 120fps
// ceiling, not a regression. Allow one refresh-jitter epsilon over the ideal budget; the honest
// signal is avg_fps pinned to the refresh rate (asserted below), not a hard sub-8.333 equality.
const VSYNC_JITTER_MS = 1.0
const VARIANCE_FLOOR = 4 // an all-black (or solid-color) canvas has ~0; a real render is far above

test('7x7-chunk island settles and sustains target fps on hardware GPU', async ({ page }) => {
  await goto_demo(page, { seed: MASTER_SEED })

  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)

  // M1 STREAMING: the default path now lazy-streams the REAL world (world_gen, surface ~y134) around
  // the camera via the ring manager — it no longer bulk-loads a synchronous test island (surface
  // y6-20) at boot. demo/main.js still pins the initial pose to [70,55,70], which is ~80 blocks
  // UNDERGROUND for the streamed surface, so a fresh frame is sky. Rise above the surface (Space =
  // the demo's own up-move) so the render-regression assertions below sample lit TERRAIN, then wait
  // for the stream queue to drain (the honest "settled" condition for a lazily-loaded world).
  await page.mouse.click(640, 400).catch(() => {})
  await page.keyboard.down('Space')
  await page
    .waitForFunction(() => /** @type {any} */ (window.__engine?.get_stats?.().camera_position?.[1] ?? 0) > 175, {
      timeout: 15000,
    })
    .catch(() => {})
  await page.keyboard.up('Space')
  await page
    .waitForFunction(() => /** @type {any} */ (window.__engine?.get_stats?.().chunk_queue_depth ?? 1) === 0, {
      timeout: 15000,
    })
    .catch(() => {})
  await page.waitForTimeout(SETTLE_MS)

  const { deltas_ms, last_stats } = await capture_frames(page, FRAME_SAMPLE_COUNT)
  const result = build_result({
    tier: String(last_stats.tier ?? 'unknown'),
    scenario: SCENARIO,
    deltas_ms,
    last_stats,
    hardware_adapter: adapter.ok,
  })

  const out_path = await write_result(result)
  const shot = await capture_canvas_screenshot(page, SCENARIO)
  test.info().annotations.push({ type: 'bench-result', description: out_path })
  test.info().annotations.push({ type: 'bench-screenshot', description: shot.path })

  // NON-BLACK-SCREEN gate: the committed screenshot must show pixel variation. An all-black or
  // solid-color canvas (dead render / swapchain desync) has variance ~0 and fails here.
  expect(
    shot.variance,
    `canvas looks blank (variance ${shot.variance.toFixed(2)} ≤ ${VARIANCE_FLOOR}) — see ${shot.path}`
  ).toBeGreaterThan(VARIANCE_FLOOR)

  // WINDING/NORMAL-REGRESSION gate: the frame centre must be lit GROUND (brown/green: r ≥ b), not
  // sky (blue-dominant). Catches two classes invisible to draw-count/variance:
  //   • winding regresses → tops cull → "frame grid" → centre collapses to sky (b > r);
  //   • normals fed in the WRONG SPACE (object- not view-space) → faces light hemisphere-sky-BLUE
  //     (b dominates) and/or crush dark as the camera pitches (defect A).
  const colors = await sample_canvas_colors(page)
  expect(
    colors.center.r,
    `frame centre looks like sky, not lit terrain (center rgb ${colors.center.r.toFixed(0)}/${colors.center.g.toFixed(0)}/${colors.center.b.toFixed(0)}) — tops culled or normals in wrong space; see ${shot.path}`
  ).toBeGreaterThanOrEqual(colors.center.b)
  // …and the ground must be genuinely LIT (not black seams / crushed faces): warm channels well
  // above a dark floor. A wrong-space-normal or dead-lighting regression drops these toward 0.
  const ground_warm = (colors.center.r + colors.center.g) / 2
  expect(
    ground_warm,
    `terrain centre too dark (warm ${ground_warm.toFixed(0)}) — lighting/normal-space regression; see ${shot.path}`
  ).toBeGreaterThan(40)

  // §8 gate: 120 fps sustained. p75 frame time within one vsync-jitter epsilon of the ideal
  // 120fps budget (§5.2 p75-primary methodology; headed vsync quantizes deltas, see const note).
  expect(
    result.p75,
    `p75 frame time ${result.p75.toFixed(2)}ms exceeds the 120fps budget + vsync jitter`
  ).toBeLessThanOrEqual(1000 / TARGET_FPS + VSYNC_JITTER_MS)

  // The vsync-honest signal: sustained average FPS must be pinned at (not below) the refresh rate.
  expect(result.avg_fps, `avg_fps ${result.avg_fps.toFixed(1)} below 120fps target`).toBeGreaterThanOrEqual(
    TARGET_FPS - 1
  )
})

test('resize mid-run raises ZERO WebGPU attachment errors (JOB-1 single-owner resize)', async ({ page }) => {
  const watcher = attach_gpu_error_watcher(page)

  await goto_demo(page, { seed: MASTER_SEED })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await page.waitForTimeout(1500)

  // Resize the viewport several times MID-RUN. The old bug mutated canvas.width/height directly on
  // window 'resize', resizing the WebGPU swapchain while three's depth texture stayed stale → a
  // color/depth attachment-size mismatch → GPUValidationError + black screen. The renderer's
  // single-owner ResizeObserver must keep them in lock-step, so this raises no GPU errors.
  for (const [w, h] of [
    [1600, 900],
    [900, 1400],
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(1000)

  const shot = await capture_canvas_screenshot(page, `${SCENARIO}_after_resize`)
  test.info().annotations.push({ type: 'bench-screenshot', description: shot.path })

  expect(watcher.errors, `resize raised WebGPU errors (depth/color desync?):\n${watcher.errors.join('\n')}`).toEqual([])
  // Still non-black after the resize storm — proves the render survived, not just "no errors".
  expect(shot.variance, `canvas blank after resize (variance ${shot.variance.toFixed(2)})`).toBeGreaterThan(
    VARIANCE_FLOOR
  )
})
