// TERRAIN-DISCOVERY LAG-SPIKE capture (reported: "huge lag spike when discovering terrain").
// Instruments a long multi-leg traverse and, PER FRAME, records the rAF delta alongside the ring's
// crossing-path telemetry (_stream_debug: cross_ms_last / crossed_last / evicted_last / mesh_ms_last /
// pending_depth) so a frame-time spike can be ATTRIBUTED from data (crossing rebuild vs mesh vs compile
// vs GC) rather than guessed. The `?hitch=1` probe's per-hitch console lines (pipeline-compile + integ +
// upload attribution) are collected in parallel. Writes a JSON trace to /tmp for A/B before/after a fix.
//
// Not a pass/fail gate — a measurement harness. Run: bunx playwright test terrain_spike_capture --project=studio-metal-headed

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN, probe_gpu_adapter } from './harness.js'
import { seize_camera, settle_stream } from './_shared.js'

const ORIGIN = DEMO_ORIGIN
const SEED = 'aresrpg'
const TAG = process.env.SPIKE_TAG || 'baseline'
const ART = '/tmp/aresrpg-engine-artifacts/terrain_spikes'
// GPU-CHEAP isolation regime: 720p @ dsf1, tier=medium (=load_radius 7, the default play tier). A
// light GPU frame (~10 ms) means a crossing-rebuild spike surfaces in the frame dt instead of drowning
// under 5K render time — and the QoS-background demotion (bounded-run) hits baseline and fixed runs
// EQUALLY, so the A/B delta stays honest. cross_ms is directly instrumented (GPU-independent) either way.
const VIEWPORT = { width: 1280, height: 720 }
const DSF = 1
const ALT = 180
// A ~2.4 km multi-leg box loop + return leg, direction changes — maximal chunk-boundary crossings.
const START = /** @type {[number,number,number]} */ ([70, ALT, 70])
const LEGS = /** @type {{ to:[number,number,number], yaw:number }[]} */ ([
  { to: [70, ALT, -560], yaw: Math.PI },
  { to: [630, ALT, -560], yaw: -Math.PI / 2 },
  { to: [630, ALT, 70], yaw: 0 },
  { to: [70, ALT, 70], yaw: Math.PI / 2 },
  { to: [400, ALT, -300], yaw: -Math.PI / 4 },
])
const PITCH = -0.18
const FLY_MS = 2600 // per leg — fast enough to cross many boundaries, slow enough to keep streaming live

test.describe.configure({ timeout: 300_000 })

test('terrain-discovery spike capture (per-frame crossing attribution)', async ({ browser }) => {
  await mkdir(ART, { recursive: true })
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF })
  const page = await context.newPage()

  /** @type {string[]} */
  const hitch_lines = []
  /** @type {string[]} */
  const boot_errors = []
  page.on('console', (msg) => {
    const t = msg.text()
    if (t.startsWith('[hitch]')) hitch_lines.push(t)
  })
  page.on('pageerror', (e) => boot_errors.push(`pageerror: ${e.message}`))

  // WARM-UP LOAD (streaming.spec pattern): a fresh vite pre-bundles the module graph on the first demo
  // load and then triggers a FULL PAGE RELOAD when esbuild optimization finishes — that mid-load reload
  // destroys the execution context and times out the wait. A throwaway load absorbs it.
  await page.goto(`${ORIGIN}/demo/`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  await page.goto(`${ORIGIN}/demo/?seed=${SEED}&tier=medium&hitch=1&cpu=1`, { waitUntil: 'domcontentloaded' })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await page
    .waitForFunction(() => Boolean(/** @type {any} */ (window).__engine?.get_stats), null, { timeout: 30_000 })
    .catch(() => {
      throw new Error(`engine never booted. pageerrors: ${JSON.stringify(boot_errors.slice(0, 5))}`)
    })
  await seize_camera(page)

  await page.evaluate(
    ({ pos, yaw, pitch }) => {
      const cam = /** @type {any} */ (window).__cam
      cam.real_pos(pos)
      cam.real_orient(yaw, pitch)
    },
    { pos: START, yaw: LEGS[0].yaw, pitch: PITCH }
  )
  await settle_stream(page, { min_ms: 2500, deadline_ms: 30_000 })

  // ONE in-page loop drives the whole traverse AND samples every rAF frame. get_stats() is a cheap
  // synchronous in-page read, so per-frame sampling adds no async round-trip.
  const samples = await page.evaluate(
    async ({ start, legs, fly_ms, pitch }) => {
      const cam = /** @type {any} */ (window).__cam
      const engine = /** @type {any} */ (window).__engine
      /** @type {any[]} */
      const out = []
      let prev = performance.now()
      let from = start
      const raf = () => new Promise((r) => requestAnimationFrame(r))
      for (const leg of legs) {
        cam.real_orient(leg.yaw, pitch)
        const t0 = performance.now()
        for (;;) {
          const now = /** @type {number} */ (await raf())
          const t = Math.min(1, (now - t0) / fly_ms)
          cam.real_pos([
            from[0] + (leg.to[0] - from[0]) * t,
            from[1] + (leg.to[1] - from[1]) * t,
            from[2] + (leg.to[2] - from[2]) * t,
          ])
          const st = engine.get_stats()
          const sd = st.stream_debug || {}
          out.push({
            dt: now - prev,
            q: st.chunk_queue_depth ?? 0,
            cross_ms: sd.cross_ms_last ?? 0,
            crossed: sd.crossed_last ? 1 : 0,
            evicted: sd.evicted_last ?? 0,
            mesh_ms: sd.mesh_ms_last ?? 0,
            meshed: sd.meshed_last ?? 0,
            pend: sd.pending_depth ?? 0,
            thr: sd.throttled ? 1 : 0,
          })
          prev = now
          if (t >= 1) break
        }
        from = leg.to
      }
      return out
    },
    { start: START, legs: LEGS, fly_ms: FLY_MS, pitch: PITCH }
  )

  await page.evaluate(() => /** @type {any} */ (window).__engine?.dispose?.()).catch(() => {})
  await context.close()

  // ---- analysis ----
  const dts = samples.map((s) => s.dt)
  const sorted = [...dts].sort((a, b) => a - b)
  const pct = (/** @type {number} */ p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
  const worst = [...samples].sort((a, b) => b.dt - a.dt).slice(0, 15)
  // Correlate: of the frames over 24 ms (a real hitch), how many were crossing frames?
  const hitches = samples.filter((s) => s.dt > 24)
  const hitch_crossed = hitches.filter((s) => s.crossed).length
  const crossFrames = samples.filter((s) => s.crossed)
  const cross_ms_vals = crossFrames.map((s) => s.cross_ms).sort((a, b) => a - b)
  const cross_p99 = cross_ms_vals.length ? cross_ms_vals[Math.ceil(0.99 * cross_ms_vals.length) - 1] : 0

  const report = {
    tag: TAG,
    frames: samples.length,
    frame_ms: { p50: pct(50), p75: pct(75), p90: pct(90), p99: pct(99), max: sorted[sorted.length - 1] },
    hitches_over_24ms: hitches.length,
    hitches_on_crossing: hitch_crossed,
    hitch_crossing_rate: hitches.length ? +(hitch_crossed / hitches.length).toFixed(2) : 0,
    crossing_frames: crossFrames.length,
    cross_ms: { p50: cross_ms_vals[Math.floor(cross_ms_vals.length / 2)] || 0, p99: +cross_p99.toFixed(3), max: +Math.max(0, ...crossFrames.map((s) => s.cross_ms)).toFixed(3) },
    worst_frames: worst.map((s) => ({ dt: +s.dt.toFixed(1), crossed: s.crossed, cross_ms: +s.cross_ms.toFixed(2), evicted: s.evicted, mesh_ms: +s.mesh_ms.toFixed(2), q: s.q, pend: s.pend })),
    hitch_probe_lines: hitch_lines.slice(0, 30),
  }
  await writeFile(`${ART}/trace_${TAG}.json`, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n===== TERRAIN SPIKE TRACE [${TAG}] =====`)
  console.log(`frames=${report.frames}  frame_ms p50=${report.frame_ms.p50.toFixed(1)} p99=${report.frame_ms.p99.toFixed(1)} max=${report.frame_ms.max.toFixed(1)}`)
  console.log(`hitches>24ms=${report.hitches_over_24ms}  on_crossing=${report.hitches_on_crossing} (${report.hitch_crossing_rate})  cross_ms p99=${report.cross_ms.p99} max=${report.cross_ms.max}`)
  console.log(`worst frames:`)
  for (const w of report.worst_frames) console.log(`  dt=${w.dt}ms crossed=${w.crossed} cross_ms=${w.cross_ms} evicted=${w.evicted} mesh_ms=${w.mesh_ms} q=${w.q} pend=${w.pend}`)
  console.log(`hitch lines: ${hitch_lines.length}`)
  for (const l of hitch_lines.slice(0, 12)) console.log('  ' + l)
  console.log(`trace → ${ART}/trace_${TAG}.json`)
})
