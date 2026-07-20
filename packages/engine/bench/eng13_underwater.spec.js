// ENG-13 UNDERWATER acceptance — drives the LIVE engine (WebGPU/Metal) at the deep lake near spawn
// (gen-verified: water cells y110..127 at (31,171), so the SURFACE PLANE = top of cell 127 = world-y
// 128; bed sand at y109). Proves the underwater feature — blue and distorted on the camera:
// (1) a clean waterline crossing with NO flicker (the submerged flag flips exactly once each
// way as the camera flies down through and back up), (2) blue immersion underwater (frame blue-
// dominant), (3) brighter looking UP vs darker looking DOWN, (4) depth-darkening (10 m still darker
// than 1 m), (5) a clean exit, (6) zero WebGPU errors, (7) fly p99 ≤ 12 ms at 2560×1440. Records a
// submerge VIDEO (walk down through the surface and back). Artifacts → /tmp/aresrpg-engine-artifacts/.
//
// 2026-07-03. The immersion/warp are TSL nodes (their MATH is unit-tested pure in
// src/render/lighting/underwater.test.js); this gate proves they COMPILE + read plausibly on the real
// backend and that the CPU detection flips cleanly — the live half of the two-tree contract.

import { writeFile, mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import {
  seize_camera,
  park_camera,
  fly_camera,
  settle_stream,
  percentile,
  capture_frames_during,
  open_recorded_page,
} from './_shared.js'
import { goto_demo, probe_gpu_adapter, attach_gpu_error_watcher } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts'
const SETTLE = { min_ms: 1800, deadline_ms: 20000 }

// Deep lake near spawn (gen-scan verified). Water cells y110..127 ⇒ surface plane world-y 128.
const LAKE = { wx: 31, wz: 171 }
const SURFACE_Y = 128

/**
 * Init hook (pre-device): attach an `uncapturederror` listener the moment three requests the GPU
 * device — the canonical WebGPU shader/validation channel three doesn't always console.error.
 * @param {import('@playwright/test').Page} page
 */
async function install_gpu_error_hook(page) {
  await page.addInitScript(() => {
    ;/** @type {any} */ (window).__gpu_errors = []
    const proto = /** @type {any} */ (window).GPUAdapter?.prototype
    if (proto && !proto.__patched) {
      proto.__patched = true
      const orig = proto.requestDevice
      proto.requestDevice = async function (/** @type {any[]} */ ...args) {
        const dev = await orig.apply(this, args)
        try {
          dev.addEventListener('uncapturederror', (/** @type {any} */ ev) => {
            ;/** @type {any} */ (window).__gpu_errors.push(String(ev.error?.message ?? ev.error ?? ev))
          })
        } catch {
          /* older device shape */
        }
        return dev
      }
    }
  })
}

/**
 * Decode the canvas screenshot and return mean RGB of three horizontal strips: TOP (looking-up sky/
 * surface band), CENTER, BOTTOM (looking-down bed band). PNG readback (the swapchain-readback ban is
 * live-surface only). Mirrors harness.sample_canvas_colors' technique.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ top:{r:number,g:number,b:number}, center:{r:number,g:number,b:number}, bottom:{r:number,g:number,b:number} }>}
 */
async function strip_means(page) {
  const url = `data:image/png;base64,${(await page.locator('#canvas').screenshot()).toString('base64')}`
  return page.evaluate(async (src) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = src
    })
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
    g.drawImage(img, 0, 0)
    /** @param {number} y0 @param {number} h */
    const mean = (y0, h) => {
      const d = g.getImageData(0, y0, img.width, h).data
      let r = 0,
        gg = 0,
        b = 0
      const px = d.length / 4
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]
        gg += d[i + 1]
        b += d[i + 2]
      }
      return { r: r / px, g: gg / px, b: b / px }
    }
    const band = Math.floor(img.height * 0.22)
    return {
      top: mean(0, band),
      center: mean(Math.floor((img.height - band) / 2), band),
      bottom: mean(img.height - band, band),
    }
  }, url)
}

/** perceptual-ish luma of a mean-rgb sample. @param {{r:number,g:number,b:number}} c */
const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

test('ENG-13 underwater — blue immersion + wobble, clean crossing, perf + zero errors', async ({ browser }) => {
  test.setTimeout(240_000)
  await mkdir(OUT, { recursive: true })

  // Recorded page at the perf-gate viewport (2560×1440, dsf per the engine's own cap) — the submerge
  // video AND the perf numbers come from this context (sibling gates' pattern, eng12_regression).
  const { page, finish } = await open_recorded_page(browser, 'eng13_underwater', { width: 2560, height: 1440 })
  await install_gpu_error_hook(page)
  const { errors } = attach_gpu_error_watcher(page)

  await goto_demo(page, { seed: undefined, timeout_ms: 60_000 })
  const adapter = await probe_gpu_adapter(page)
  await seize_camera(page)

  /** live underwater uniform readout (active flag + depth). */
  const uw = () =>
    page.evaluate(() => {
      const u = /** @type {any} */ (window).__underwater
      return {
        present: !!u,
        active: u?.active?.value ?? -1,
        depth: u?.depth?.value ?? -1,
        amp: u?.warp_amp?.value ?? -1,
      }
    })

  /** @type {Record<string, unknown>} */
  const report = { lake: LAKE, surface_y: SURFACE_Y, adapter: adapter.info, adapter_ok: adapter.ok }

  // ── 0. the pass must exist (all atmosphere tiers construct it) ────────────────────────────────────
  await park_camera(page, [LAKE.wx, 150, LAKE.wz], Math.PI / 4, -0.9)
  await settle_stream(page, SETTLE)
  const boot = await uw()
  report.boot = boot
  expect(boot.present, 'underwater pass constructed').toBe(true)

  // ── 1. ABOVE water (eye at y=150, dry) — active must be 0 ─────────────────────────────────────────
  await park_camera(page, [LAKE.wx, 150, LAKE.wz], Math.PI / 4, -0.4)
  await settle_stream(page, SETTLE)
  const dry = await uw()
  report.dry = dry
  expect(dry.active, 'dry above the lake ⇒ not submerged').toBe(0)
  const dry_strip = await strip_means(page)
  await writeFile(`${OUT}/eng13_above_water.png`, await page.locator('#canvas').screenshot())

  // ── 2. SUBMERGED at 1 m depth (eye y=127, surface 128) looking roughly level ──────────────────────
  await park_camera(page, [LAKE.wx, 127, LAKE.wz], Math.PI / 4, 0.0)
  await settle_stream(page, SETTLE)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const s1 = await uw()
  report.depth_1m = s1
  expect(s1.active, '1 m under ⇒ submerged').toBe(1)
  expect(s1.depth, '1 m depth reported').toBeGreaterThan(0.5)
  expect(s1.depth).toBeLessThan(2.5)
  const m1 = await strip_means(page)
  report.means_1m = m1
  await writeFile(`${OUT}/eng13_underwater_1m.png`, await page.locator('#canvas').screenshot())

  // BLUE immersion: the frame reads blue-dominant (blue clearly the strongest channel) — dry lake vista
  // is not (terrain/sky mix). Compare center strips.
  expect(m1.center.b, 'underwater center is blue-dominant (b>r)').toBeGreaterThan(m1.center.r)
  expect(m1.center.b, 'underwater center is blue-dominant (b>g)').toBeGreaterThan(m1.center.g)
  expect(m1.center.b, 'underwater is bluer than the dry frame').toBeGreaterThan(dry_strip.center.b)

  // ── 3. LOOK UP vs LOOK DOWN at the same depth — up is brighter cyan, down darker navy ──────────────
  await park_camera(page, [LAKE.wx, 122, LAKE.wz], Math.PI / 4, 1.15) // pitch UP toward the surface
  await settle_stream(page, SETTLE)
  const up_strip = await strip_means(page)
  await writeFile(`${OUT}/eng13_look_up.png`, await page.locator('#canvas').screenshot())
  await park_camera(page, [LAKE.wx, 122, LAKE.wz], Math.PI / 4, -1.15) // pitch DOWN toward the bed
  await settle_stream(page, SETTLE)
  const down_strip = await strip_means(page)
  await writeFile(`${OUT}/eng13_look_down.png`, await page.locator('#canvas').screenshot())
  report.up_luma = luma(up_strip.center)
  report.down_luma = luma(down_strip.center)
  // Looking up (sun through the surface) is brighter than looking down (toward the unlit bed).
  expect(luma(up_strip.center), 'looking UP is brighter than looking DOWN').toBeGreaterThan(luma(down_strip.center))

  // ── 4. DEEP — 10 m depth (eye y=118) level — still blue; plus an ISOLATED depth-darken A/B ─────────
  await park_camera(page, [LAKE.wx, 118, LAKE.wz], Math.PI / 4, 0.0)
  await settle_stream(page, SETTLE)
  const s10 = await uw()
  report.depth_10m = s10
  expect(s10.active).toBe(1)
  expect(s10.depth, '10 m depth reported').toBeGreaterThan(8)
  const m10 = await strip_means(page)
  report.means_10m = m10
  await writeFile(`${OUT}/eng13_underwater_10m.png`, await page.locator('#canvas').screenshot())
  expect(m10.center.b, '10 m still blue-dominant').toBeGreaterThan(m10.center.r)

  // DEPTH-DARKEN, isolated from scene content: hold THIS exact pose and A/B the darken by forcing the
  // depth uniform shallow (0) vs deep (40) — same geometry, only the darkening term moves, so a strict
  // "deep is dimmer than shallow" is a clean proof of the term (comparing two eye heights conflates it
  // with what's visible). The engine's rAF overwrites depth each frame from the hysteresis, so we
  // temporarily neutralize the pass's update() (which is what update_underwater forwards to) to make
  // the forced value stick, screenshot each state, then restore update().
  const force_depth = (d) =>
    page.evaluate((depth) => {
      const u = /** @type {any} */ (window).__underwater
      u.__real_update ??= u.update
      u.update = () => {} // freeze the CPU push so our forced depth holds
      u.active.value = 1
      u.depth.value = depth
    }, d)
  const restore_update = () =>
    page.evaluate(() => {
      const u = /** @type {any} */ (window).__underwater
      if (u.__real_update) {
        u.update = u.__real_update
        delete u.__real_update
      }
    })
  const beat2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const strip_luma = async () => luma((await strip_means(page)).center)
  await force_depth(0)
  await beat2()
  const darken_shallow = await strip_luma()
  await force_depth(40)
  await beat2()
  const darken_deep = await strip_luma()
  await restore_update()
  report.darken_ab = { shallow: darken_shallow, deep: darken_deep }
  expect(darken_deep, 'depth-darken: deep frame dimmer than shallow (same pose)').toBeLessThan(darken_shallow)

  // ── 5. CLEAN WATERLINE CROSSING (the flicker gate) — fly the eye DOWN through the surface plane and
  //       poll the submerged flag every frame: it must flip EXACTLY ONCE (enter), then EXACTLY ONCE
  //       (exit) on the way back up. Any flicker at the waterline = multiple transitions → fail. ──────
  await park_camera(page, [LAKE.wx, 134, LAKE.wz], Math.PI / 4, -0.25)
  await settle_stream(page, SETTLE)
  await page.evaluate(() => {
    const w = /** @type {any} */ (window)
    w.__lens_dry_output = w.__post?.pipeline?.outputNode
  })
  // Install a per-frame transition counter that samples __underwater.active on the engine's rAF.
  await page.evaluate(() => {
    const w = /** @type {any} */ (window)
    w.__uw_trace = { transitions: 0, samples: 0, last: -1, log: [] }
    const tick = () => {
      const a = w.__underwater?.active?.value ?? -1
      const t = w.__uw_trace
      if (a !== t.last) {
        if (t.last !== -1 && a !== -1) {
          t.transitions += 1
          t.log.push(a)
        }
        t.last = a
      }
      t.samples += 1
      w.__uw_trace._raf = requestAnimationFrame(tick)
    }
    tick()
  })
  // descend slowly THROUGH the surface (134 → 120): a slow crossing is the hardest flicker case.
  await fly_camera(page, {
    from: [LAKE.wx, 134, LAKE.wz],
    to: [LAKE.wx, 120, LAKE.wz],
    yaw: Math.PI / 4,
    pitch: -0.25,
    duration_ms: 4000,
  })
  const after_descent = await page.evaluate(() => /** @type {any} */ (window).__uw_trace)
  // ascend back out (120 → 134) — the clean EXIT.
  await fly_camera(page, {
    from: [LAKE.wx, 120, LAKE.wz],
    to: [LAKE.wx, 134, LAKE.wz],
    yaw: Math.PI / 4,
    pitch: 0.1,
    duration_ms: 4000,
  })
  const trace = await page.evaluate(() => {
    const w = /** @type {any} */ (window)
    if (w.__uw_trace?._raf) cancelAnimationFrame(w.__uw_trace._raf)
    return w.__uw_trace
  })
  report.crossing = {
    after_descent_transitions: after_descent.transitions,
    total_transitions: trace.transitions,
    samples: trace.samples,
    log: trace.log,
  }
  // Down-through-surface = exactly one 0→1. Full down+up round-trip = exactly two (0→1 then 1→0). A
  // flickering waterline would rack up many more.
  expect(after_descent.transitions, 'descent crosses the waterline exactly once (no flicker)').toBe(1)
  expect(trace.transitions, 'down+up round-trip flips exactly twice (clean enter + clean exit)').toBe(2)
  expect(trace.log, 'transition order is enter(1) then exit(0)').toEqual([1, 0])
  const wet_lens_intensity = await page.evaluate(() => /** @type {any} */ (window).__lens_water?.intensity?.value ?? 0)
  report.crossing.wet_lens_intensity = wet_lens_intensity
  expect(wet_lens_intensity, 'surface exit activates the unchanged wet-lens graph').toBeGreaterThan(0)
  expect(
    await page.evaluate(() => {
      const w = /** @type {any} */ (window)
      return w.__post?.pipeline?.outputNode !== w.__lens_dry_output
    }),
    'surface exit selects the wet graph'
  ).toBe(true)
  await page.waitForFunction(() => /** @type {any} */ (window).__lens_water?.intensity?.value === 0, null, {
    timeout: 5000,
  })
  expect(
    await page.evaluate(() => {
      const w = /** @type {any} */ (window)
      return w.__post?.pipeline?.outputNode === w.__lens_dry_output
    }),
    'parked lens restores the exact dry graph'
  ).toBe(true)

  // ── 6. PERF — submerged at the deep vista, fly p99 ≤ 12 ms at 2560×1440 (the pass is a few ALU ops +
  //       one depth sample the volumetrics already pay for, so ~0 added). ─────────────────────────────
  await park_camera(page, [LAKE.wx, 120, LAKE.wz], Math.PI / 4, -0.15)
  await settle_stream(page, SETTLE)
  const frames = await capture_frames_during(page, 4000)
  const p99 = percentile(frames.deltas_ms, 99)
  const p50 = percentile(frames.deltas_ms, 50)
  report.perf = { p50_ms: p50, p99_ms: p99, frames: frames.deltas_ms.length }

  // Collect GPU errors BEFORE finish() — finish() closes the recorded context, so any page.evaluate
  // after it throws "context closed".
  report.errors = errors.concat(await page.evaluate(() => /** @type {any} */ (window).__gpu_errors ?? []))
  const video = await finish('submerge')
  report.video = video

  await writeFile(`${OUT}/eng13_underwater_report.json`, JSON.stringify(report, null, 2))
  console.log('[eng13] perf:', JSON.stringify(report.perf), 'crossing:', JSON.stringify(report.crossing))
  console.log('[eng13] means 1m/10m center:', JSON.stringify({ m1: m1.center, m10: m10.center }))
  console.log('[eng13] video →', video || '(none)')
  if (report.errors.length) console.log('[eng13] ERRORS:\n' + report.errors.join('\n'))

  // ── GATES ──────────────────────────────────────────────────────────────────────────────────────
  expect(report.errors, 'zero WebGPU errors').toEqual([])
  expect(p99, `fly p99 ${p99.toFixed(2)}ms ≤ 12ms @ 2560×1440`).toBeLessThanOrEqual(12)
})
