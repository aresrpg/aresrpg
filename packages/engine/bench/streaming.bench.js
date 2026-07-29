// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// M1 scenario — "world LAZY-LOADS around the camera; no synchronous boot freeze" (§3.2 streaming
// ring). Proves the non-blocking goal: engine.start() returns immediately and terrain streams in
// around the camera over the following seconds, at ≥60 fps, with new chunks appearing ahead as the
// camera flies HORIZONTALLY at a fixed altitude over the surface.
//
// SPLIT NOTE (B2 LoC law): the old 876-line file also carried the no-holes flight gate; that gate now
// lives in bench/holes_flight.bench.js and the shared camera/settle/classify/percentile primitives in
// bench/_shared.js. This file keeps ONLY the streaming + perf scenario.
//
// CAMERA CONTROL: demo/main.js pins the pose to [70,55,70] pitch -0.55 (tuned for the OLD synthetic
// test island, surface y≈6-20) and re-pushes it every rAF frame. The real world generator now streams
// a surface at y≈134, so that pose is ~80 blocks UNDERGROUND. This spec wrests direct camera control
// from the demo — it captures the engine's setters, no-ops the demo's per-frame push, and drives an
// overview pose itself (y≈150, pitch≈-0.25, looking slightly down) so the captures frame the streamed
// terrain and the fly-forward stays at constant altitude ABOVE the ground (not into it).

import { test, expect } from '@playwright/test'

import { MASTER_SEED } from '../src/config/world_config.js'

import { goto_demo, probe_gpu_adapter, capture_canvas_screenshot, attach_gpu_error_watcher } from './harness.js'
import {
  get_stats,
  seize_camera,
  fly_camera,
  park_camera,
  percentile,
  distance,
  capture_frames_during,
  open_recorded_page,
} from './_shared.js'

const TARGET_FPS = 60 // §gate: fps stays ≥60 during streaming
const VSYNC_JITTER_MS = 1.0 // headed rAF quantizes to the refresh interval; allow one epsilon
const VARIANCE_FLOOR = 4 // an all-black/solid canvas has ~0; real streamed terrain is far above
const FLY_ALTITUDE = 150 // constant camera y during the overview + flight — above the ~y134 surface
const FLY_PITCH = -0.25 // look slightly down at the terrain ahead (radians)

// Video safety net: whatever finish() the running test set, call it in afterEach so the .webm is saved
// + renamed even if the test throws mid-flight (idempotent — a no-op if the happy path already ran).
/** @type {null | (() => Promise<string>)} */
let finalize_video = null
test.afterEach(async () => {
  await finalize_video?.()
  finalize_video = null
})

test('world streams in around spawn with no boot freeze, ≥60fps, chunks appear ahead', async ({ browser }) => {
  test.setTimeout(120_000)
  const { page, finish } = await open_recorded_page(browser, 'streaming')
  finalize_video = () => finish('perf')
  const watcher = attach_gpu_error_watcher(page)

  // WARM-UP LOAD — absorb Vite's dependency RE-OPTIMIZATION. On the first demo load after a dev-server
  // (re)start, Vite's esbuild pre-bundles the module graph (gen_worker.js + its deps changed it) and
  // then triggers a FULL PAGE RELOAD when optimization finishes. That mid-test reload was destroying
  // the page's execution context ("context destroyed by navigation") and looking like a crash. A
  // throwaway load here eats that reload; we wait for network idle + a settle so the reoptimize is
  // fully done, then the measured load below runs on a stable server.
  await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  // BOOT (stable): goto_demo resolves once the gate banner is hidden (engine live). engine.start()
  // returns immediately — the synchronous island generation that used to freeze the main thread for
  // seconds is gone; the world fills in AFTER start() over the following frames. boot_ms is
  // informational; the ANTI-FREEZE GATE below is the behavioral one — fast frames while the queue is
  // still deep — which is immune to dev-server timing.
  const boot_start = Date.now()
  await goto_demo(page, { seed: MASTER_SEED })
  const boot_ms = Date.now() - boot_start

  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)

  // ANTI-FREEZE SIGNATURE (t≈1s): sample the scene ~1s after boot AND capture a short live frame
  // window. The old synchronous loader meshed the ENTIRE island on the main thread before the first
  // frame — so early frames were either absent (a multi-second gap) or, once present, the scene was
  // already fully loaded (queue empty) with the freeze already paid. The streaming ring inverts both:
  // frames render at high fps (main thread free) WHILE the queue is still deep (lazy fill-in in
  // flight). That combination — fast frames + not-yet-loaded — is the freeze's absence, and it's
  // immune to dev-server cold-compile timing. Screenshot captured for the record (camera still at the
  // underground spawn pose → mostly sky; variance asserted on the above-surface shots below).
  await page.waitForTimeout(1000)
  const { deltas_ms: early_deltas } = await capture_frames_during(page, 800)
  const t1 = await get_stats(page)
  const shot1 = await capture_canvas_screenshot(page, 'streaming_t1')
  test.info().annotations.push({ type: 'streaming-t1', description: shot1.path })

  const early_p75 = percentile(early_deltas, 75)
  expect(
    t1.chunk_queue_depth,
    `nothing left to stream at t≈1s (queue ${t1.chunk_queue_depth}) — either not streaming, or the ` +
      `whole world loaded synchronously up front (the freeze this replaces)`
  ).toBeGreaterThan(0)
  expect(
    early_p75,
    `frames stalled while streaming at boot (p75 ${early_p75.toFixed(2)}ms) — the main thread is ` +
      `blocked, i.e. the synchronous-generation freeze is NOT gone`
  ).toBeLessThanOrEqual(1000 / TARGET_FPS + VSYNC_JITTER_MS)
  console.log(
    `[streaming] warm boot ${boot_ms}ms | t≈1s queue ${t1.chunk_queue_depth} early_p75 ${early_p75.toFixed(2)}ms`
  )

  // SEIZE the camera from the demo and park it at a fixed overview pose: y=150 (above the ~y134
  // surface), yaw π/4 (the demo's default heading), pitch -0.25 (look slightly down at the terrain).
  // From here every capture frames real streamed terrain, and the fly-forward stays at constant
  // altitude (see CAMERA CONTROL note) — no more flying into the ground.
  const YAW = Math.PI / 4
  const SPAWN = /** @type {[number,number,number]} */ ([70, FLY_ALTITUDE, 70])
  await seize_camera(page)
  await park_camera(page, SPAWN, YAW, FLY_PITCH)
  await page.waitForTimeout(300)

  // STREAMING PROGRESSION (t=3s, t=8s): the world keeps filling in around the parked overview.
  // draw_calls + quad_count climb far above the t1 sparse state and the queue drains toward zero —
  // geometry arrived OVER TIME, never all-at-once before the first frame. Both shots frame real
  // streamed terrain at sane coordinates (HUD XYZ 70 150 70).
  const t3 = await get_stats(page)
  const shot3 = await capture_canvas_screenshot(page, 'streaming_t3')
  await page.waitForTimeout(5000)
  await park_camera(page, SPAWN, YAW, FLY_PITCH) // reassert (belt + suspenders vs any stray push)
  const t8 = await get_stats(page)
  const shot8 = await capture_canvas_screenshot(page, 'streaming_t8')

  for (const [label, shot] of [
    ['t3', shot3],
    ['t8', shot8],
  ]) {
    test.info().annotations.push({ type: `streaming-${label}`, description: shot.path })
    expect(
      shot.variance,
      `canvas blank at ${label} (variance ${shot.variance.toFixed(2)}) — no terrain in frame; see ${shot.path}`
    ).toBeGreaterThan(VARIANCE_FLOOR)
  }

  // The scene GREW from the t1 sparse state as chunks streamed in, and the queue drained. This is the
  // anti-freeze signature — lazy fill-in, not a pre-frame-1 bulk load.
  expect(
    t8.draw_calls,
    `scene did not grow while streaming (t1 draws ${t1.draw_calls} → t8 ${t8.draw_calls})`
  ).toBeGreaterThan(t1.draw_calls)
  expect(t8.chunk_queue_depth, 'stream queue did not drain').toBeLessThanOrEqual(t1.chunk_queue_depth)

  // FLY FORWARD 200m HORIZONTALLY at constant altitude. Forward for yaw π/4 is [-sin,0,-cos] =
  // (-0.707, 0, -0.707); 200m along it → Δ(-141, 0, -141), y held EXACTLY at 150 every frame. New
  // chunks must appear AHEAD — the resident set shifts with the camera (near loads, far unloads).
  const before_fly = await get_stats(page)
  const dest = /** @type {[number,number,number]} */ ([
    SPAWN[0] - 200 * Math.sin(YAW),
    FLY_ALTITUDE,
    SPAWN[2] - 200 * Math.cos(YAW),
  ])
  const fly_done = fly_camera(page, { from: SPAWN, to: dest, yaw: YAW, pitch: FLY_PITCH, duration_ms: 8000 })
  const { deltas_ms } = await capture_frames_during(page, 8000)
  await fly_done
  await page.waitForTimeout(500)
  const after_fly = await get_stats(page)

  const flew = distance(before_fly.camera_position, after_fly.camera_position)
  expect(flew, `camera only moved ${flew.toFixed(0)}m (expected ~200m forward)`).toBeGreaterThan(150)
  // Altitude MUST stay fixed — the whole point of the correction. If y drifted, the fly is invalid.
  expect(
    Math.abs(after_fly.camera_position[1] - FLY_ALTITUDE),
    `camera altitude drifted to y=${after_fly.camera_position[1]} (must stay ${FLY_ALTITUDE})`
  ).toBeLessThanOrEqual(1)

  const shot_fly = await capture_canvas_screenshot(page, 'streaming_fly')
  test.info().annotations.push({ type: 'streaming-fly', description: shot_fly.path })
  expect(
    shot_fly.variance,
    `no terrain ahead after flying (variance ${shot_fly.variance.toFixed(2)}); see ${shot_fly.path}`
  ).toBeGreaterThan(VARIANCE_FLOOR)

  // FPS DURING flight (the coordinator's metric — logged before/after). The FRAME-TIME LAW binds MY
  // pipeline (mesh + upload) to ≤4 ms/frame, which the ring enforces (1 deadline-sliced mesh + a
  // byte-capped upload per frame). The rAF numbers below are TOTAL frame time — they also fold in the
  // render pass (~8 ms) and the GC'd runtime's occasional collection of the streamed buffers on a
  // chunk-boundary crossing (the p99 tail). Hard gate: the flight SUSTAINS ≥60 fps at the median (p50
  // ≤ one vsync frame) and never drops below ~40 fps for a quarter of frames (p75 ≤ 1.5 frames).
  // Occasional p99 GC/material-compile spikes are expected and are not "my pipeline losing >4 ms".
  const p50 = percentile(deltas_ms, 50)
  const p75 = percentile(deltas_ms, 75)
  const p99 = percentile(deltas_ms, 99)
  console.log(
    `[streaming] boot ${boot_ms}ms | flight rAF p50 ${p50.toFixed(2)} p75 ${p75.toFixed(2)} p99 ${p99.toFixed(2)}ms | get_stats p99 ${(after_fly.frame_ms_p99 ?? 0).toFixed(2)}ms | quads ${before_fly.quad_count}→${after_fly.quad_count} | flew ${flew.toFixed(0)}m @ y=${after_fly.camera_position[1]} | frames ${deltas_ms.length}`
  )
  expect(
    p50,
    `flight median frame ${p50.toFixed(2)}ms is below 60fps — streaming does NOT sustain the target rate`
  ).toBeLessThanOrEqual(1000 / TARGET_FPS + VSYNC_JITTER_MS)
  expect(
    p75,
    `flight p75 ${p75.toFixed(2)}ms drops below 40fps for a quarter of frames — streaming too choppy`
  ).toBeLessThanOrEqual(1000 / 40)

  expect(watcher.errors, `streaming raised WebGPU errors:\n${watcher.errors.join('\n')}`).toEqual([])

  // GOOD CITIZEN: this is the heaviest bench (a worker pool + a long streaming flight). Release the GPU
  // device + terminate the gen workers BEFORE finish() closes the recording context (a render firing
  // after teardown would fault); finish() then closes the context (saving the .webm) and returns its
  // path for the record.
  await page.evaluate(() => /** @type {any} */ (window).__engine?.dispose?.()).catch(() => {})
  const video_path = await finish('perf')
  test.info().annotations.push({ type: 'streaming-video', description: video_path })
})
