// AMBIENT-TINT acceptance (reference: sky-lit shade reads COOL, sunlit ground stays WARM). Verifies
// the atmosphere.js `ambient_tint` node applied on terrain_material.js's ambient-floor term:
//   1. OPEN sunlit terrain is UNCHANGED (de-cyan regression guard — tint is neutral white at v_sun=1).
//   2. UNDER-CANOPY interior floor gains a COOL blue cast (v_sun→0), and it stays SUBTLE (not smurf).
// Method: a per-CONTEXT A/B on the SAME running vite server — the "before" page intercepts
// /render/atmosphere.js and rewrites AMBIENT_SHADE_TINT → [1,1,1] (neutral = exactly the pre-tint
// pixels, since the tint multiplies the ambient floor by white ⇒ identity). This cancels albedo (the
// delta isolates the TINT) and does NOT touch shared source, so sibling bench workers are undisturbed.
// Artifacts → /tmp/aresrpg-engine-artifacts/shade/*.png.

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

const OUT = '/tmp/aresrpg-engine-artifacts/shade'
const DEMO = 'http://localhost:5199/demo/'

test.describe.configure({ mode: 'serial' })

/**
 * Boot the demo on a fresh context. `neutralize_tint` intercepts the atmosphere module and forces the
 * ambient shade tint to neutral (the "before" leg). Waits for engine + first streaming settle.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ neutralize_tint?: boolean }} [opts]
 */
async function boot(browser, { neutralize_tint = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  let intercepts = 0
  if (neutralize_tint) {
    // rewrite AMBIENT_SHADE_TINT → [1,1,1] in the transformed module, this page only (VALUE-AGNOSTIC:
    // matches the whole freeze-array so it survives tuning-wave re-crank of the tint values).
    // REGEX route (not a glob): Vite serves the import as `atmosphere.js?t=<ts>` — a `**/…atmosphere.js`
    // glob does NOT match the trailing `?t=` query, so the intercept would silently no-op.
    await context.route(/\/render\/atmosphere\.js/, async (route) => {
      const res = await route.fetch()
      const original = await res.text()
      const body = original.replace(
        /AMBIENT_SHADE_TINT = Object\.freeze\(\[[^\]]*\]\)/,
        'AMBIENT_SHADE_TINT = Object.freeze([1, 1, 1])'
      )
      if (body !== original) intercepts++
      await route.fulfill({ response: res, body })
    })
  }
  const page = await context.newPage()
  await page.goto(`${DEMO}?tier=high`)
  await page.waitForFunction(
    () => {
      const e = /** @type {any} */ (window).__engine
      if (!e) return false
      const s = e.get_stats()
      return s.chunk_queue_depth === 0 && s.fps > 5
    },
    null,
    { timeout: 120_000 }
  )
  return { page, context, intercepts: () => intercepts }
}

/** @param {import('@playwright/test').Page} page @param {number} ms */
const settle = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms)

/** Camera-pin interceptor (bench-playbook pattern — the demo rAF re-pushes its own pose each frame).
 * @param {import('@playwright/test').Page} page */
const install_pin = (page) =>
  page.evaluate(() => {
    const w = /** @type {any} */ (window)
    if (w.__pin_installed) return
    w.__pin_installed = true
    const e = w.__engine
    const orig_pos = e.set_camera_position.bind(e)
    const orig_ori = e.set_camera_orientation.bind(e)
    e.set_camera_position = (/** @type {any} */ p) => orig_pos(w.__pin?.pos ?? p)
    e.set_camera_orientation = (/** @type {any} */ y, /** @type {any} */ pi) =>
      w.__pin ? orig_ori(w.__pin.yaw, w.__pin.pitch) : orig_ori(y, pi)
  })

/** Pin a pose (+tod) and wait for the live camera to reach it + the re-stream to drain.
 * @param {import('@playwright/test').Page} page
 * @param {{ pos:[number,number,number], yaw:number, pitch:number, tod:number }} o */
async function pose(page, o) {
  await install_pin(page)
  await page.evaluate((p) => {
    const w = /** @type {any} */ (window)
    w.__engine.set_time_of_day(p.tod)
    w.__pin = { pos: p.pos, yaw: p.yaw, pitch: p.pitch }
  }, o)
  await page.waitForFunction(
    (target) => {
      const e = /** @type {any} */ (window).__engine
      if (!e) return false
      const c = e.get_stats().camera_position
      return Math.abs(c[0] - target[0]) < 2 && Math.abs(c[1] - target[1]) < 2 && Math.abs(c[2] - target[2]) < 2
    },
    o.pos,
    { timeout: 30_000 }
  )
  await settle(page, 1500)
  await page.waitForFunction(
    () => {
      const e = /** @type {any} */ (window).__engine
      return e != null && e.get_stats().chunk_queue_depth === 0
    },
    null,
    { timeout: 120_000 }
  )
  await settle(page, 800)
}

/**
 * In-page decode: mean linear-ish R/G/B (0..1, sRGB bytes/255) over pixels of a normalized rect whose
 * luma falls in [min_luma, max_luma] — isolates SUNLIT (bright) vs SHADED (dark) pixels in one frame.
 * @param {import('@playwright/test').Page} page @param {Buffer} png
 * @param {{x0:number,y0:number,x1:number,y1:number}} rect @param {{min:number,max:number}} luma
 * @returns {Promise<{r:number,g:number,b:number,n:number}>}
 */
function measure_rgb(page, png, rect, luma) {
  return page.evaluate(
    async ({ url, rect, luma }) => {
      const img = new Image()
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = url
      })
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
      g.drawImage(img, 0, 0)
      const d = g.getImageData(
        Math.round(img.width * rect.x0),
        Math.round(img.height * rect.y0),
        Math.max(1, Math.round(img.width * (rect.x1 - rect.x0))),
        Math.max(1, Math.round(img.height * (rect.y1 - rect.y0)))
      ).data
      let r = 0
      let gg = 0
      let b = 0
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        const rr = d[i] / 255
        const g_ = d[i + 1] / 255
        const bb = d[i + 2] / 255
        const l = 0.2126 * rr + 0.7152 * g_ + 0.0722 * bb
        if (l < luma.min || l > luma.max) continue
        r += rr
        gg += g_
        b += bb
        n++
      }
      return n ? { r: r / n, g: gg / n, b: b / n, n } : { r: 0, g: 0, b: 0, n: 0 }
    },
    { url: `data:image/png;base64,${png.toString('base64')}`, rect, luma }
  )
}

// ── POSES ────────────────────────────────────────────────────────────────────────────────────────
/** Noon vista over the spawn hills — OPEN, sunlit terrain fills the lower frame (de-cyan guard). */
const OPEN = { pos: /** @type {[number,number,number]} */ ([70, 215, 70]), yaw: 2.4, pitch: -0.28, tod: 0.375 }
/** Under-canopy forest floor (veg_ocean's FOREST) — pitched DOWN at the floor for the deepest BFS
 *  shade (low v_sun) directly beneath the canopy ⇒ the cool-cast payoff. */
const CANOPY = { pos: /** @type {[number,number,number]} */ ([44, 150, -74]), yaw: 0.5, pitch: -0.5, tod: 0.3 }

test('ambient tint: open terrain unchanged, canopy interior gains a subtle cool cast', async ({ browser }) => {
  test.setTimeout(360_000)
  await mkdir(OUT, { recursive: true })

  // AFTER — shipped tint on.
  const after = await boot(browser)
  await pose(after.page, OPEN)
  const open_after = await after.page.screenshot({ path: `${OUT}/open_terrace_after.png` })
  await pose(after.page, CANOPY)
  const canopy_after = await after.page.screenshot({ path: `${OUT}/canopy_interior_after.png` })

  // BEFORE — tint neutralized to [1,1,1] via per-context intercept (exactly the pre-tint pixels).
  const before = await boot(browser, { neutralize_tint: true })
  // GUARD the A/B is real: the intercept MUST have rewritten the module, else before==after (no-op).
  expect(before.intercepts(), 'tint-neutralize intercept never fired — A/B would be a no-op').toBeGreaterThan(0)
  await pose(before.page, OPEN)
  const open_before = await before.page.screenshot({ path: `${OUT}/open_terrace_before.png` })
  await pose(before.page, CANOPY)
  const canopy_before = await before.page.screenshot({ path: `${OUT}/canopy_interior_before.png` })

  // ── 1. DE-CYAN GUARD — sunlit (bright) pixels of the OPEN vista are unchanged by the tint ─────────
  const lower = { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.95 }
  const open_a = await measure_rgb(after.page, open_after, lower, { min: 0.45, max: 1 })
  const open_b = await measure_rgb(after.page, open_before, lower, { min: 0.45, max: 1 })
  const d_open = { r: open_a.r - open_b.r, g: open_a.g - open_b.g, b: open_a.b - open_b.b }
  console.log(
    `[shade] OPEN sunlit ΔRGB = ${d_open.r.toFixed(4)}, ${d_open.g.toFixed(4)}, ${d_open.b.toFixed(4)} (n=${open_a.n})`
  )
  console.log(`[shade] OPEN sunlit after RGB = ${open_a.r.toFixed(3)}, ${open_a.g.toFixed(3)}, ${open_a.b.toFixed(3)}`)
  expect(open_a.n, 'no sunlit pixels sampled — pose/exposure off').toBeGreaterThan(500)
  // sunlit terrain has v_sun≈1 ⇒ ambient_tint=white ⇒ byte-identical. Allow only tiny dither/AA noise.
  for (const c of ['r', 'g', 'b']) expect(Math.abs(d_open[c]), `sunlit ${c} shifted`).toBeLessThan(0.012)
  // and the shipped sunlit render is NOT cyan (warm noon sun): blue must not exceed red.
  expect(open_a.b, 'sunlit terrain went cyan (blue>red)').toBeLessThanOrEqual(open_a.r + 0.02)

  // ── 2. COOL-CAST PAYOFF — the DEEPEST-shade (low v_sun) canopy-floor pixels get BLUER vs red ─────
  // The tint only bites where BFS sun ≈ 0 (the ambient-floor term dominates there); moderately-lit
  // fern carpet keeps v_sun high ⇒ tint≈white ⇒ no change (correct). So measure by luma BAND and find
  // where the cool cast lands — the deepest band is the payoff, brighter bands should be ~unchanged.
  const floor = { x0: 0.1, y0: 0.35, x1: 0.9, y1: 0.98 }
  /** @param {{r:number,g:number,b:number,n:number}} a @param {{r:number,g:number,b:number,n:number}} b */
  const cool_delta = (a, b) => a.b - a.r - (b.b - b.r)
  /** @type {Array<{lo:number,hi:number,d:number,n:number,after:any}>} */
  const bands = []
  for (const [lo, hi] of [
    [0.02, 0.12],
    [0.12, 0.25],
    [0.25, 0.45],
  ]) {
    const a = await measure_rgb(after.page, canopy_after, floor, { min: lo, max: hi })
    const b = await measure_rgb(after.page, canopy_before, floor, { min: lo, max: hi })
    const d = cool_delta(a, b)
    bands.push({ lo, hi, d, n: a.n, after: a })
    console.log(
      `[shade] CANOPY luma[${lo}-${hi}] Δ(b−r)=${d.toFixed(4)} after(r,g,b)=${a.r.toFixed(3)},${a.g.toFixed(3)},${a.b.toFixed(3)} n=${a.n}`
    )
  }
  const [deep, , lit] = bands
  expect(deep.n, 'no deep-shade pixels sampled — canopy not dark enough at this pose').toBeGreaterThan(300)
  // the deepest-shade band gets cooler with the tint (blue lifts relative to red) — the payoff. Margin
  // over the open-terrain noise floor (~0.0003) proves it's the tint, not AA/dither.
  expect(deep.d, 'deepest canopy shade did not get cooler with the tint').toBeGreaterThan(0.002)
  // GRADED BY SHADE DEPTH (the tint's signature — it keys on v_sun): deep shade cools MORE than the
  // well-lit band (which stays ~neutral). A flat delta across luma would mean a global cast, not ours.
  expect(deep.d - lit.d, 'cool cast is not graded by shade depth — not a v_sun-keyed tint').toBeGreaterThan(0.001)
  // SUBTLE — photographic cool shade, not smurf caves: the cool shift stays small.
  expect(deep.d, 'cool cast too strong (smurf caves)').toBeLessThan(0.12)

  await after.context.close()
  await before.context.close()
  console.log(`[shade] artifacts → ${OUT}/{open_terrace,canopy_interior}_{before,after}.png`)
})
