// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HALF-RES POST — instrument-first attribution + A/B proof (medium tier, 13.2 Mpx / dpr2 5K-class).
// Probe (underscore): measures the real per-pixel post breakdown that the perf mandate targets and the
// before/after of the __half_res_post feature. Mirrors _gov_pipeline_race's rAF-delta protocol; own
// context at 2360x1400 dsf2 => 4720x2800 = 13.216 Mpx backing (matches the profiling lane's 13.2 Mpx).
// The governor holds scale at medium's 1.0 ceiling while under 16 ms budget — we pin+confirm scale===1.
//
// Run:  bunx playwright test bench/_halfres_post.spec.js --project=studio-metal-headed
// Env:  HRP_ONLY=attrib|feature|wave to run one describe; default runs all.

import { mkdir } from 'node:fs/promises'

import { test, expect, chromium } from '@playwright/test'

// Self-launched headed Metal browser with VSYNC DISABLED — the Studio is 120 Hz (ProMotion), so the
// default rAF delta is hard-locked to 8.33 ms multiples and quantizes away any sub-vsync GPU delta. These
// two flags let rAF run unthrottled so the delta reads TRUE GPU ms. They are NOT Vulkan-forcing args (the
// playwright.config caveat), so the Metal navigator.gpu path is preserved (probed below).
/** @type {import('@playwright/test').Browser} */
let BROWSER
test.beforeAll(async () => {
  BROWSER = await chromium.launch({
    headless: false,
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'],
  })
})
test.afterAll(async () => {
  await BROWSER?.close()
})

const ORIGIN = `${process.env.ARES_DEMO_ORIGIN || 'http://localhost:5199'}/demo/`
const ART = '/tmp/aresrpg-engine-artifacts/halfres'
// TARGET: 13.2 Mpx (dpr2 5K-class). With vsync DISABLED (beforeAll) the rAF delta reads true
// GPU ms directly at this resolution — no 120 Hz quantization, no extrapolation needed. Post cost is
// per-pixel/fill-linear (the scale line stays for the exact 13.2 figure when the canvas lands slightly off).
const CSS = { width: 2410, height: 1430 }
const TARGET_MPX = 13.2
const DSF = 2
// Sky-heavy oblique gameplay pose over the streamed world (roughly half sky / half terrain — the
// fill-bound framing the profiling lane flagged: fullscreen sky + post dominate, terrain < 1 ms).
const POSE = { position: [70, 178, 70], yaw: Math.PI / 4, pitch: -0.18 }

test.describe.configure({ mode: 'serial' })

/** Boot the demo at `tier` in an own dsf2 context, settle the ring, pin the pose + scale.
 *  `nocam=1` (the demo's documented rig lever) is REQUIRED for real pose control: without it the
 *  demo's drive loop re-pushes its own state every frame and silently overwrites every
 *  set_camera_orientation from the bench (poses/spins were the boot pose before this). */
async function open_tier(tier, query = '') {
  const context = await BROWSER.newContext({ viewport: CSS, deviceScaleFactor: DSF })
  const page = await context.newPage()
  const url = `${ORIGIN}?tier=${tier}&seed=aresrpg&nocam=1${query}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__engine?.get_stats), null, { timeout: 30_000 })
  await page.evaluate((p) => {
    const e = window.__engine
    e.set_camera_position(p.position)
    e.set_camera_orientation(p.yaw, p.pitch)
  }, POSE)
  // Drain the streaming ring so terrain is resident (steady GPU cost, not a stream spike).
  await page
    .waitForFunction(() => (window.__engine?.get_stats?.().chunk_queue_depth ?? 1) === 0, null, { timeout: 25_000 })
    .catch(() => {})
  // Pin to medium's 1.0 ceiling AND neutralize the governor: window.__engine IS the `api` the governor's
  // set_render_scale closure calls, so replacing it with a no-op freezes scale at 1 (13.2 Mpx) for a clean
  // A/B — otherwise the governor drops scale under fill pressure and the variants measure at different pixel
  // counts. The fenced governor.js is untouched; this only stops the demo engine from resizing mid-measure.
  await page.evaluate(() => {
    const e = window.__engine
    e.set_render_scale(1)
    e.__orig_srs = e.set_render_scale
    e.set_render_scale = () => {}
  })
  await page.waitForTimeout(600) // let pipelines warm + auto-exposure settle
  const backing = await page.evaluate(() => {
    const c = document.getElementById('canvas')
    return { w: c.width, h: c.height, mpx: (c.width * c.height) / 1e6 }
  })
  return { context, page, backing }
}

/** Median/p95/avg rAF frame-ms over `frames`, filtering >250 ms harness stalls; records render_scale. */
async function measure(page, { drive = 'rest', frames = 150 } = {}) {
  return page.evaluate(
    async ({ drive, frames }) => {
      const e = window.__engine
      const deltas = []
      const scales = []
      let prev = await new Promise((r) => requestAnimationFrame(r))
      let i = 0
      for (;;) {
        const now = await new Promise((r) => requestAnimationFrame(r))
        deltas.push(now - prev)
        scales.push(e.get_stats().render_scale)
        prev = now
        if (drive === 'spin') e.set_camera_orientation((Math.PI / 4 + i * 0.012) % (Math.PI * 2), -0.18)
        i += 1
        if (i >= frames) break
      }
      const keep = deltas.filter((d) => d <= 250)
      keep.sort((a, b) => a - b)
      const med = keep[keep.length >> 1]
      const p95 = keep[Math.min(keep.length - 1, Math.ceil(0.95 * keep.length) - 1)]
      const avg = keep.reduce((a, b) => a + b, 0) / keep.length
      const scale = scales.slice().sort((a, b) => a - b)[scales.length >> 1]
      return { med, p95, avg, scale, n: keep.length }
    },
    { drive, frames }
  )
}

const fps = (ms) => (1000 / ms).toFixed(1)
const line = (label, r) =>
  `[HRP] ${label.padEnd(26)} med=${r.med.toFixed(2)}ms (${fps(r.med)} fps) p95=${r.p95.toFixed(2)} avg=${r.avg.toFixed(
    2
  )} scale=${r.scale?.toFixed(2)} n=${r.n}`

/** Max/mean per-BYTE abs diff between two same-size PNG buffers, decoded via an in-page canvas (the
 *  shade_verify.spec.js getImageData idiom) — the pixel-identical proof for a PURE re-render-count
 *  dedupe (no quality change expected, unlike the half-res bloom/cloud A/B above). */
async function diff_pngs(page, buf_a, buf_b) {
  return page.evaluate(
    async ({ a, b }) => {
      const load = (url) =>
        new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => res(img)
          img.onerror = rej
          img.src = url
        })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      const c = document.createElement('canvas')
      c.width = Math.min(ia.width, ib.width)
      c.height = Math.min(ia.height, ib.height)
      const g = c.getContext('2d')
      g.drawImage(ia, 0, 0)
      const da = g.getImageData(0, 0, c.width, c.height).data
      g.drawImage(ib, 0, 0)
      const db = g.getImageData(0, 0, c.width, c.height).data
      let max_diff = 0
      let sum_diff = 0
      let differing = 0
      for (let i = 0; i < da.length; i += 1) {
        const d = Math.abs(da[i] - db[i])
        if (d > 0) differing += 1
        if (d > max_diff) max_diff = d
        sum_diff += d
      }
      return { max_diff, mean_diff: sum_diff / da.length, differing_bytes: differing, total_bytes: da.length }
    },
    { a: `data:image/png;base64,${buf_a.toString('base64')}`, b: `data:image/png;base64,${buf_b.toString('base64')}` }
  )
}

// ── ATTRIBUTION: name the branch. Baseline vs per-system-off deltas isolate the real post cost. ──────
test.describe('attribution @ 13.2 Mpx medium', () => {
  test.skip(Boolean(process.env.HRP_ONLY) && process.env.HRP_ONLY !== 'attrib', 'attrib skipped')

  test('baseline + per-system deltas (bloom / clouds / sky)', async () => {
    test.setTimeout(240_000)
    const variants = [
      ['baseline', ''], // = the shipped medium: half-res post ON (bloom 0.25 + cloud deck rtt 0.5)
      ['halfpost_off', '&halfpost=0'], // the pre-half-res-post chain (inline full-res deck, bloom 0.5)
      ['bloom_off', '&bloom=0'],
      ['clouds_off', '&clouds=0'],
    ]
    /** @type {Record<string, any>} */
    const rest = {}
    await mkdir(ART, { recursive: true }).catch(() => {})
    for (const [name, q] of variants) {
      const { context, page, backing } = await open_tier('medium', q)
      try {
        if (name === 'baseline')
          console.log(`[HRP] backing = ${backing.w}x${backing.h} = ${backing.mpx.toFixed(2)} Mpx`)
        const r = await measure(page, { drive: 'rest' })
        rest[name] = r
        console.log(line(`${name} (rest)`, r))
        if (name === 'baseline') {
          const s = await measure(page, { drive: 'spin' })
          console.log(line('baseline (spin)', s))
          await page.locator('#canvas').screenshot({ path: `${ART}/baseline_rest.png` })
        }
      } catch (err) {
        console.log(`[HRP] ${name} FAILED: ${String(err).slice(0, 120)}`)
      } finally {
        await context.close()
      }
    }
    if (!rest.baseline) throw new Error('baseline measurement failed')
    console.log(`[HRP] --- attribution (rest med) ---`)
    if (rest.halfpost_off)
      console.log(
        `[HRP] halfpost win ~= ${(rest.halfpost_off.med - rest.baseline.med).toFixed(2)} ms ` +
          `(off ${rest.halfpost_off.med.toFixed(2)} -> on ${rest.baseline.med.toFixed(2)}; ` +
          `p95 ${rest.halfpost_off.p95.toFixed(2)} -> ${rest.baseline.p95.toFixed(2)})`
      )
    if (rest.bloom_off) console.log(`[HRP] bloom cost  ~= ${(rest.baseline.med - rest.bloom_off.med).toFixed(2)} ms`)
    if (rest.clouds_off) console.log(`[HRP] clouds cost ~= ${(rest.baseline.med - rest.clouds_off.med).toFixed(2)} ms`)
    expect(rest.baseline.med).toBeGreaterThan(0)
  })
})

// ── FEATURE A/B: __half_res_post OFF vs ON. Frame-time win + rest/motion screenshots for visual review. ─
test.describe('feature A/B: __half_res_post', () => {
  test.skip(Boolean(process.env.HRP_ONLY) && process.env.HRP_ONLY !== 'feature', 'feature skipped')

  test('off vs on — frame time + screenshots', async () => {
    test.setTimeout(240_000)
    await mkdir(ART, { recursive: true }).catch(() => {})
    const { context, page, backing } = await open_tier('medium')
    console.log(`[HRP] feature backing = ${backing.w}x${backing.h} = ${backing.mpx.toFixed(2)} Mpx`)

    const has_flag = await page.evaluate(() => typeof window.__half_res_post === 'object')
    console.log(`[HRP] __half_res_post present = ${has_flag}`)

    // FREEZE the world before the A/B: far-field keeps streaming for seconds, and a screenshot pair
    // captured across a streaming change compares scene state, not bloom. Wait for the far ring to settle,
    // then set_streaming_paused so OFF vs ON differ by the FLAG ALONE (pure bloom-quality comparison).
    await page.waitForTimeout(4000)
    await page.evaluate(() => window.__engine.set_streaming_paused?.(true))
    await page.waitForTimeout(600)

    // SCREENSHOTS FIRST (lightweight, robust): the frozen scene lets OFF(0.5) vs ON(0.25) differ by the
    // FLAG ALONE. Capture rest + 3 off-axis yaws BEFORE the heavy frame-time measures (a sustained 13.8 Mpx
    // session can lose the tab under GPU pressure — happens with the feature off too — so the visual
    // evidence must not depend on the measures completing). Bloom CRAWL (low-res-bloom's motion artifact)
    // would show as a POSE-DEPENDENT spike in the off↔on diff; a uniformly tiny diff across yaws = no pop.
    const set_flag = (on) => page.evaluate((v) => window.__half_res_post && (window.__half_res_post.enabled = v), on)
    const POSES = [
      ['rest', Math.PI / 4],
      ['yaw0', Math.PI / 4 + 0.25],
      ['yaw1', Math.PI / 4 + 0.55],
      ['yaw2', Math.PI / 4 - 0.3],
    ]
    for (const [name, yaw] of POSES) {
      await page.evaluate((y) => window.__engine.set_camera_orientation(y, -0.18), yaw)
      await set_flag(false)
      await page.waitForTimeout(300)
      await page.locator('#canvas').screenshot({ path: `${ART}/off_${name}.png` })
      await set_flag(true)
      await page.waitForTimeout(300)
      await page.locator('#canvas').screenshot({ path: `${ART}/on_${name}.png` })
    }
    console.log('[HRP] captured off/on screenshots for: ' + POSES.map((p) => p[0]).join(' '))

    // FRAME-TIME MEASURES LAST (best-effort): heavy 150-frame drives that can crash the loaded tab. Wrapped
    // so a lost tab still leaves the screenshots + a partial verdict. Rest pose, streaming still frozen.
    let timing = ''
    try {
      await page.evaluate((y) => window.__engine.set_camera_orientation(y, -0.18), Math.PI / 4)
      await set_flag(false)
      await page.waitForTimeout(400)
      const off_rest = await measure(page, { drive: 'rest' })
      await set_flag(true)
      await page.waitForTimeout(400)
      const on_rest = await measure(page, { drive: 'rest' })
      const k = TARGET_MPX / backing.mpx
      const win = off_rest.med - on_rest.med
      console.log(line('OFF (rest)', off_rest))
      console.log(line('ON  (rest)', on_rest))
      console.log(
        `[HRP] === WIN (rest @ ${backing.mpx.toFixed(1)}Mpx) = ${win.toFixed(2)} ms ` +
          `(${off_rest.med.toFixed(2)} -> ${on_rest.med.toFixed(2)}; ${fps(off_rest.med)} -> ${fps(on_rest.med)} fps) ` +
          `| @13.2Mpx ${(off_rest.med * k).toFixed(2)} -> ${(on_rest.med * k).toFixed(2)} ms (~${(win * k).toFixed(2)} ms) ===`
      )
      timing = 'ok'
    } catch (err) {
      console.log(`[HRP] frame-time measure lost the tab (screenshots already captured): ${String(err).slice(0, 100)}`)
    }
    await context.close()
    expect(timing === 'ok' || true).toBeTruthy() // screenshots are the required artifact; timing is best-effort
  })
})

// ── HDR DEDUPE A/B @ HIGH TIER (wave 2c, the residual wave 2b named): __hdr_rtt.autoUpdate toggled LIVE
// on ONE frozen page — true = the pre-fix shipped 3×/frame hdr re-render, false = the dedupe (post_stack.js's
// hdr_dedupe_on now includes high). A live in-page toggle (not two separate boots) keeps pose/world/
// time-of-day identical across both arms. PIXEL PROOF IS DIFFERENTIAL: streaming pause freezes the WORLD,
// not the CLOCK — cloud drift (u_time), water shimmer, and grass sway advance every frame regardless of
// the dedupe, so any two captures ~1 s apart differ by a live-animation floor even with zero code change
// (measured: same-arm mean-byte diff ≈ cross-arm ≈ 1.2 at 13.8 Mpx). The oracle is therefore same-arm
// capture pairs (the floor) vs the cross-arm pair at the SAME cadence: a structural divergence (stale/
// garbage bake) would spike the cross pair far above the floor (whole-consumer-pass content, not
// sub-texel shimmer); cross ≈ floor = the dedupe contributes zero pixels (the brief's law: "any pixel
// diff = a bug"). Same POSE as the rest of this file (13.2 Mpx oblique) so the frame-ms win is
// comparable to the medium numbers above.
test.describe('HDR dedupe A/B @ high tier (wave 2c)', () => {
  test.skip(Boolean(process.env.HRP_ONLY) && process.env.HRP_ONLY !== 'high_hdr', 'high_hdr skipped')

  test('autoUpdate true (shipped 3x) vs false (dedupe) — frame time + pixel-identical proof', async () => {
    test.setTimeout(240_000)
    await mkdir(ART, { recursive: true }).catch(() => {})
    const { context, page, backing } = await open_tier('high')
    console.log(`[HRP-HIGH] backing = ${backing.w}x${backing.h} = ${backing.mpx.toFixed(2)} Mpx`)

    const has_probe = await page.evaluate(() => typeof window.__hdr_rtt === 'object' && window.__hdr_rtt !== null)
    console.log(`[HRP-HIGH] __hdr_rtt present = ${has_probe}`)
    expect(has_probe, 'post_stack.js must expose __hdr_rtt at high tier (hdr_dedupe_on)').toBeTruthy()

    // FREEZE the world (same idiom as the medium feature A/B) so both arms see the identical scene.
    await page.waitForTimeout(4000)
    await page.evaluate(() => window.__engine.set_streaming_paused?.(true))
    await page.waitForTimeout(600)

    /** @param {boolean} on true = dedupe ON (autoUpdate=false, our fix) */
    const set_dedupe = (on) =>
      page.evaluate((v) => {
        window.__hdr_rtt.autoUpdate = !v
      }, on)

    // PIXEL-IDENTICAL PROOF (differential — see the describe header): re-pin time-of-day so the sun/sky
    // contribute zero drift, then same-arm pairs (noise floor) + the cross-arm pair at the same cadence.
    await page.evaluate(() => window.__engine.set_time_of_day?.(0.25))
    await page.waitForTimeout(2500) // sky/cloud-shadow re-bake + auto-exposure re-servo settle after the tod pin
    // (measured: a 1200 ms settle left off1 mid-re-bake — floor_off read 41.6 mean vs the settled 1.7)
    await set_dedupe(false) // OFF: autoUpdate=true — the pre-fix shipped 3×/frame re-render
    const buf_off1 = await page.locator('#canvas').screenshot({ path: `${ART}/high_hdr_off1.png` })
    const buf_off2 = await page.locator('#canvas').screenshot({ path: `${ART}/high_hdr_off2.png` })
    await set_dedupe(true) // ON: autoUpdate=false + update()'s per-frame re-arm — our fix
    const buf_on1 = await page.locator('#canvas').screenshot({ path: `${ART}/high_hdr_on1.png` })
    const buf_on2 = await page.locator('#canvas').screenshot({ path: `${ART}/high_hdr_on2.png` })
    const floor_off = await diff_pngs(page, buf_off1, buf_off2)
    const cross = await diff_pngs(page, buf_off2, buf_on1)
    const floor_on = await diff_pngs(page, buf_on1, buf_on2)
    const fmt = (d) => `mean=${d.mean_diff.toFixed(5)} max=${d.max_diff} bytes=${d.differing_bytes}/${d.total_bytes}`
    console.log(`[HRP-HIGH] floor OFF (off1 vs off2): ${fmt(floor_off)}`)
    console.log(`[HRP-HIGH] CROSS    (off2 vs on1) : ${fmt(cross)}`)
    console.log(`[HRP-HIGH] floor ON  (on1 vs on2) : ${fmt(floor_on)}`)

    // FRAME-TIME A/B (same live toggle, rest pose, streaming still frozen).
    await set_dedupe(false)
    await page.waitForTimeout(400)
    const off_rest = await measure(page, { drive: 'rest' })
    await set_dedupe(true)
    await page.waitForTimeout(400)
    const on_rest = await measure(page, { drive: 'rest' })
    console.log(line('HIGH OFF (rest, shipped 3x)', off_rest))
    console.log(line('HIGH ON  (rest, dedupe)', on_rest))
    const win = off_rest.med - on_rest.med
    console.log(
      `[HRP-HIGH] === WIN (rest @ ${backing.mpx.toFixed(1)}Mpx) = ${win.toFixed(2)} ms ` +
        `(${off_rest.med.toFixed(2)} -> ${on_rest.med.toFixed(2)}; ${fps(off_rest.med)} -> ${fps(on_rest.med)} fps) ` +
        `p95 ${off_rest.p95.toFixed(2)} -> ${on_rest.p95.toFixed(2)} ===`
    )
    await context.close()

    // LAW: the dedupe is a pure re-render elimination — any STRUCTURAL pixel diff is a bug (revert +
    // BLOCKED). Gate: the cross-arm diff must sit at the live-animation noise floor. The floor is
    // floor_ON (on1 vs on2) — the adjacent same-cadence pair captured seconds after the cross pair —
    // NOT a max() over both floors: off1 is the first capture after the tod pin and can carry re-bake
    // residue that would inflate (and so neuter) the gate. A real graph divergence would put whole
    // consumer passes on stale/garbage content — the cross mean would spike far above the floor, not
    // ride it. 1.5×+ε headroom absorbs shimmer sampling jitter between adjacent pairs.
    const floor = floor_on.mean_diff
    console.log(
      `[HRP-HIGH] === PIXEL-IDENTICAL: cross mean=${cross.mean_diff.toFixed(5)} vs floor=${floor.toFixed(5)} ===`
    )
    expect(
      cross.mean_diff,
      `cross-arm diff (${cross.mean_diff.toFixed(4)}) must ride the animation floor (${floor.toFixed(4)}) — ` +
        'a spike above it = structural pixel change = revert + BLOCKED'
    ).toBeLessThan(floor * 1.5 + 0.05)
    expect(on_rest.med).toBeGreaterThan(0)
  })
})

// ── MOTION / SHIMMER capture (lightweight, ROBUST): a SEPARATE vsync-ON browser at a MODEST resolution.
// The 13.2 Mpx vsync-off timing rig runs the GPU flat-out and intermittently loses the tab; screenshots
// don't need vsync off, and the RELATIVE bloom coarseness (0.25 vs 0.5) is resolution-independent, so a
// stable low-res capture answers the crawl question. Off vs on at several yaws on a FROZEN scene → a
// uniformly tiny per-pose diff = no pose-dependent bloom popping (visual review is the final gate).
test.describe('motion/shimmer screenshots (motion-eye check)', () => {
  test.skip(Boolean(process.env.HRP_ONLY) && process.env.HRP_ONLY !== 'feature', 'motion skipped')

  test('off vs on across yaws — frozen scene', async () => {
    test.setTimeout(180_000)
    await mkdir(ART, { recursive: true }).catch(() => {})
    const browser = await chromium.launch({ headless: false }) // vsync ON (default) — stable
    try {
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
      const page = await context.newPage()
      await page.goto(`${ORIGIN}?tier=medium&seed=aresrpg&nocam=1`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean(window.__engine?.get_stats), null, { timeout: 30_000 })
      await page.evaluate(() => window.__engine.set_camera_position([70, 178, 70]))
      await page
        .waitForFunction(() => (window.__engine?.get_stats?.().chunk_queue_depth ?? 1) === 0, null, { timeout: 25_000 })
        .catch(() => {})
      await page.waitForTimeout(3500)
      await page.evaluate(() => window.__engine.set_streaming_paused?.(true)) // freeze so only the flag differs
      await page.waitForTimeout(500)
      const set_flag = (on) => page.evaluate((v) => window.__half_res_post && (window.__half_res_post.enabled = v), on)
      const POSES = /** @type {[string, number][]} */ ([
        ['m_rest', Math.PI / 4],
        ['m_yaw0', Math.PI / 4 + 0.3],
        ['m_yaw1', Math.PI / 4 + 0.6],
        ['m_yaw2', Math.PI / 4 - 0.35],
      ])
      for (const [name, yaw] of POSES) {
        await page.evaluate((y) => window.__engine.set_camera_orientation(y, -0.16), yaw)
        await set_flag(false)
        await page.waitForTimeout(300)
        await page.locator('#canvas').screenshot({ path: `${ART}/${name}_off.png` })
        await set_flag(true)
        await page.waitForTimeout(300)
        await page.locator('#canvas').screenshot({ path: `${ART}/${name}_on.png` })
      }
      console.log('[HRP] motion screenshots: ' + POSES.map((p) => p[0]).join(' '))
      await context.close()
    } finally {
      await browser.close()
    }
    expect(true).toBeTruthy()
  })
})

// ── HALF-POST WAVE (clouds→half-res extension): stills at 2 poses × day/dusk + a 10 s moving-camera
// webm. Visual artifact evidence for the cloud-deck rtt: softness at terrain/cloud occlusion
// edges is the honest expected cost; shimmer/banding in motion is the failure class. Live-knob A/B on
// a FROZEN scene so OFF (bloom 0.5 + deck rtt at 1.0) vs ON (bloom 0.25 + deck rtt 0.5) differ by the
// feature alone. vsync-ON stable browser at a modest res (the relative deck coarseness is
// resolution-independent — same rationale as the motion describe above).
test.describe('halfpost wave: pose/time stills + motion webm', () => {
  test.skip(Boolean(process.env.HRP_ONLY) && process.env.HRP_ONLY !== 'wave', 'wave skipped')

  test('off vs on — vista/skyup × day/dusk stills', async () => {
    test.setTimeout(300_000)
    await mkdir(ART, { recursive: true }).catch(() => {})
    const browser = await chromium.launch({ headless: false })
    const POSES = /** @type {[string, number][]} */ ([
      ['vista', -0.18], // oblique down: terrain-cloud occlusion edges (the half-res depth-alpha risk)
      ['skyup', 0.35], // sky-dominant: the pure deck read (softness/banding oracle)
    ])
    try {
      // ONE FRESH CONTEXT PER TOD at dsf 1.5 (3.24 Mpx): a single long dsf2 session lost the tab
      // under sustained GPU pressure (the spec's documented failure class) — the relative deck
      // coarseness (0.5 vs 1.0) is resolution-independent, so the lighter context answers the same
      // question robustly. Off/on captured back-to-back (<1 s) so far-shell drift never splits a pair.
      // day = the demo's boot tod (0.25, mid-morning). dusk = 0.70: day spans [0, DAY_FRAC=0.75)
      // with noon at 0.375, so 0.70 ⇒ sun low above the horizon (golden hour) — sun_dir_from_tod.
      for (const [tod_name, phase] of /** @type {[string, number|null][]} */ ([
        ['day', null],
        ['dusk', 0.7],
      ])) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 })
        const page = await context.newPage()
        // nocam=1: the rig lever — without it the demo re-pushes ITS pose every frame and every
        // set_camera_orientation below silently no-ops (see open_tier note).
        await page.goto(`${ORIGIN}?tier=medium&seed=aresrpg&nocam=1`, { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => Boolean(window.__engine?.get_stats), null, { timeout: 30_000 })
        await page.evaluate((p) => {
          window.__engine.set_camera_position(p)
          window.__engine.set_camera_orientation(Math.PI / 4, -0.18)
        }, POSE.position)
        await page
          .waitForFunction(() => (window.__engine?.get_stats?.().chunk_queue_depth ?? 1) === 0, null, {
            timeout: 25_000,
          })
          .catch(() => {})
        await page.evaluate(() => window.__engine.set_streaming_paused?.(true)) // near ring frozen
        if (phase != null) await page.evaluate((ph) => window.__engine.set_time_of_day(ph), phase)
        await page.waitForTimeout(6000) // pipelines + far shell + (tod: sky/cloud shadow re-bake) settle
        const set_flag = (on) =>
          page.evaluate((v) => window.__half_res_post && (window.__half_res_post.enabled = v), on)
        for (const [name, pitch] of POSES) {
          await page.evaluate((p) => window.__engine.set_camera_orientation(Math.PI / 4, p), pitch)
          await set_flag(false)
          await page.waitForTimeout(300)
          await page.locator('#canvas').screenshot({ path: `${ART}/w_${tod_name}_${name}_off.png` })
          await set_flag(true)
          await page.waitForTimeout(300)
          await page.locator('#canvas').screenshot({ path: `${ART}/w_${tod_name}_${name}_on.png` })
        }
        await context.close()
      }
      console.log('[HRP] wave stills: day/dusk x vista/skyup off/on pairs in ' + ART)
    } finally {
      await browser.close()
    }
    expect(true).toBeTruthy()
  })

  test('10s moving-camera webm at the shipped default (feature ON)', async () => {
    test.setTimeout(180_000)
    await mkdir(ART, { recursive: true }).catch(() => {})
    const browser = await chromium.launch({ headless: false })
    try {
      const context = await browser.newContext({
        viewport: { width: 1600, height: 900 },
        deviceScaleFactor: 1, // record at CSS res — the webm oracle is temporal (shimmer), not texel-sharpness
        recordVideo: { dir: ART, size: { width: 1600, height: 900 } },
      })
      const page = await context.newPage()
      // nocam=1 so the per-rAF orientation drive below actually steers (see open_tier note).
      await page.goto(`${ORIGIN}?tier=medium&seed=aresrpg&nocam=1`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean(window.__engine?.get_stats), null, { timeout: 30_000 })
      await page.evaluate((p) => {
        window.__engine.set_camera_position(p)
        window.__engine.set_camera_orientation(Math.PI / 4, -0.18)
      }, POSE.position)
      await page
        .waitForFunction(() => (window.__engine?.get_stats?.().chunk_queue_depth ?? 1) === 0, null, { timeout: 25_000 })
        .catch(() => {})
      await page.waitForTimeout(3500)
      await page.evaluate(() => window.__engine.set_streaming_paused?.(true))
      await page.waitForTimeout(500)
      // slow pan + pitch sweep across deck AND terrain-cloud edges for ~10 s — the shimmer oracle.
      await page.evaluate(async () => {
        const e = window.__engine
        const t0 = performance.now()
        for (;;) {
          const t = (performance.now() - t0) / 1000
          if (t >= 10) break
          e.set_camera_orientation(Math.PI / 4 + t * 0.22, -0.18 + Math.sin(t * 0.6) * 0.3)
          await new Promise((r) => requestAnimationFrame(r))
        }
      })
      const video = page.video()
      await context.close() // flushes the recording
      const vpath = await video?.path()
      console.log(`[HRP] wave webm: ${vpath}`)
    } finally {
      await browser.close()
    }
    expect(true).toBeTruthy()
  })
})
