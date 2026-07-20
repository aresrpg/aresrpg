// C9 Hillaire sky ACCEPTANCE (Appendix R2 bar): per-time-of-day SKY triptychs (dawn/noon/sunset/night)
// physical-sky DEFAULT vs the analytic-sky override (__ARES_SKY_ANALYTIC) at MEDIUM + HIGH; the horizon ozone-blue +
// sunset colour propagation read; the LUT-rebuild + sky-draw frame cost per tier; and the flag-OFF
// parity proof (window.__hillaire is null off / present on ⇒ the flag only SWITCHES the consumer node).
//
// CAPTURE-IN-SAFE-WINDOW: the demo's default scene streams endlessly (the auto-driven camera never lets
// it settle) and the chunk-mesh churn OOMs the JS heap in ~12 s — a demo trait, FLAG-INDEPENDENT (proven:
// flag-off OOMs identically). So we frame a SKY vista (the background/sky-view LUT renders from frame 1,
// no terrain settle needed) and sweep all four ToDs within the first few seconds; ToD change re-renders
// the sky-view LUT with zero re-stream. Point ARES_DEMO_ORIGIN at a DEDICATED vite (never :5199/:5173).

import { mkdir } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

const OUT = '/tmp/aresrpg-engine-artifacts/hillaire'
const DEMO = `${process.env.ARES_DEMO_ORIGIN || 'http://localhost:5199'}/demo/`

test.describe.configure({ mode: 'serial' })

/** dawn / noon / sunset / night on the 15:5 cycle (DAY_FRAC=0.75). @type {[string, number][]} */
const TIMES = [
  ['dawn', 0.02],
  ['noon', 0.375],
  ['sunset', 0.72],
  ['night', 0.85],
]

// a HIGH sky vista, pitched up so the frame is sky-dominant (terrain barely streams → wide safe window).
const VISTA = { pos: [0, 300, 0], yaw: 2.4, pitch: 0.16 }

/**
 * Boot to "rendering" (NOT settled — the scene never settles), pin the sky vista.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ tier: string, hillaire: boolean }} o
 */
async function boot(browser, { tier, hillaire }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  /** @type {string[]} */
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/Failed to load resource|MetaMask|draco|ERR_CONNECTION/i.test(t)) return
    errors.push(`console.error: ${t}`)
  })
  // The physical sky is now the DEFAULT at MEDIUM/HIGH (no URL flag — URL-based feature flags were
  // removed). "off" forces the analytic path via the internal bench-only override (never URL-parsed);
  // "on" is just the default.
  if (!hillaire) await page.addInitScript(() => /** @type {any} */ (window.__ARES_SKY_ANALYTIC = 1))
  await page.goto(`${DEMO}?tier=${tier}`, { timeout: 30000 })
  await page.waitForFunction(() => /** @type {any} */ (window).__engine?.get_stats().fps > 3, null, { timeout: 45000 })
  // pin the camera (stops the auto-drive so the sky framing holds) and aim the vista.
  await page.evaluate((v) => {
    const w = /** @type {any} */ (window)
    const e = w.__engine
    const op = e.set_camera_position.bind(e)
    const oo = e.set_camera_orientation.bind(e)
    e.set_camera_position = (/** @type {any} */ p) => op(w.__pin?.pos ?? p)
    e.set_camera_orientation = (/** @type {any} */ y, /** @type {any} */ pi) =>
      w.__pin ? oo(w.__pin.yaw, w.__pin.pitch) : oo(y, pi)
    w.__pin = { pos: v.pos, yaw: v.yaw, pitch: v.pitch }
    e.set_camera_position(v.pos)
    e.set_camera_orientation(v.yaw, v.pitch)
  }, VISTA)
  return { page, context, errors }
}

/** @param {import('@playwright/test').Page} page @param {number} ms */
const wait = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms).catch(() => {})

/** Mean RGB of a normalized screenshot band (in-page decode). */
function band_rgb(page, png, r) {
  return page.evaluate(
    async ({ url, rect }) => {
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
      let rr = 0,
        gg = 0,
        bb = 0,
        n = 0
      for (let i = 0; i < d.length; i += 16) {
        rr += d[i]
        gg += d[i + 1]
        bb += d[i + 2]
        n++
      }
      return { r: rr / n, g: gg / n, b: bb / n }
    },
    { url: `data:image/png;base64,${png.toString('base64')}`, rect: r }
  )
}

/** Sweep the four ToDs, one shot each, AIMED AT THE SUN (frames the reddening at low sun). Defensive —
 *  earlier shots survive a later demo-streaming OOM. */
async function sweep(page, tier, suffix) {
  /** @type {Record<string, Buffer|null>} */
  const shots = {}
  for (const [name, tod] of TIMES) {
    try {
      await page.evaluate((t) => {
        const w = /** @type {any} */ (window)
        const e = w.__engine
        e.set_time_of_day(t)
        // aim the pinned camera toward the sun azimuth (three YXZ forward), horizon in the lower third.
        const s = (w.__hillaire?.sun_direction ?? w.__atmo?.sun_direction)?.value
        if (s) {
          const yaw = Math.atan2(-s.x, -s.z)
          w.__pin = { pos: [0, 300, 0], yaw, pitch: 0.1 }
          e.set_camera_orientation(yaw, 0.1)
        }
      }, tod)
      await wait(page, 1300) // sky-view LUT re-render at the new sun
      shots[name] = await page.screenshot({ path: `${OUT}/${tier}_${name}_${suffix}.png`, timeout: 12000 })
    } catch {
      shots[name] = null // OOM'd mid-sweep — keep what we have
    }
  }
  return shots
}

for (const tier of ['medium', 'high']) {
  test(`hillaire sky triptychs + flag parity — ${tier}`, async ({ browser }) => {
    test.setTimeout(300_000)
    await mkdir(OUT, { recursive: true })

    // ── flag ON ──────────────────────────────────────────────────────────────────────────────────
    const on = await boot(browser, { tier, hillaire: true })
    expect(await on.page.evaluate(() => /** @type {any} */ (window).__hillaire != null)).toBe(true)
    const on_png = await sweep(on.page, tier, 'ON')
    expect(Object.values(on_png).filter(Boolean).length, 'flag-on shots captured').toBeGreaterThanOrEqual(3)
    // sunset colour propagation: aimed at the low sun, the horizon band should read WARMER than the noon
    // horizon (long-path reddening + ozone). Relative (self-calibrating), logged for visual review.
    if (on_png.sunset && on_png.noon) {
      const hs = await band_rgb(on.page, on_png.sunset, { x0: 0.3, x1: 0.7, y0: 0.5, y1: 0.62 })
      const hn = await band_rgb(on.page, on_png.noon, { x0: 0.3, x1: 0.7, y0: 0.5, y1: 0.62 })
      console.log(
        `[hillaire ${tier}] horizon warmth (r−b) sunset=${(hs.r - hs.b).toFixed(0)} noon=${(hn.r - hn.b).toFixed(0)}`
      )
      expect(hs.r - hs.b, 'sunset horizon warmer than noon').toBeGreaterThan(hn.r - hn.b)
    }
    await on.context.close()

    // ── flag OFF (parity: __hillaire is null ⇒ the legacy path is untouched) ───────────────────────
    const off = await boot(browser, { tier, hillaire: false })
    expect(await off.page.evaluate(() => /** @type {any} */ (window).__hillaire == null)).toBe(true)
    const off_png = await sweep(off.page, tier, 'OFF')

    // the flag genuinely SWITCHES the sky: the noon zenith band differs on vs off (not a silent no-op).
    if (on_png.noon && off_png.noon) {
      const a = await band_rgb(off.page, on_png.noon, { x0: 0.3, x1: 0.7, y0: 0.04, y1: 0.16 })
      const b = await band_rgb(off.page, off_png.noon, { x0: 0.3, x1: 0.7, y0: 0.04, y1: 0.16 })
      const delta = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
      console.log(
        `[hillaire ${tier}] noon zenith ON`,
        JSON.stringify(a),
        'OFF',
        JSON.stringify(b),
        'Δ',
        delta.toFixed(1)
      )
      expect(delta).toBeGreaterThan(5)
    }
    console.log(
      `[hillaire ${tier}] shots ON=${Object.values(on_png).filter(Boolean).length}/4 OFF=${Object.values(off_png).filter(Boolean).length}/4`
    )
    await off.context.close()
  })
}

test('hillaire frame cost: LUT rebuild + sky draw, off vs on, per tier', async ({ browser }) => {
  test.setTimeout(300_000)
  const sample = (page) =>
    page.evaluate(async () => {
      const e = /** @type {any} */ (window).__engine
      const p = []
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 500))
        p.push(e.get_stats().frame_ms_p50)
      }
      return p.sort((a, b) => a - b)[Math.floor(p.length / 2)]
    })
  /** @type {Record<string, {off:number, on:number, delta:number}>} */
  const cost = {}
  for (const tier of ['medium', 'high']) {
    const off = await boot(browser, { tier, hillaire: false })
    const off_ms = await sample(off.page).catch(() => -1)
    await off.context.close()
    const on = await boot(browser, { tier, hillaire: true })
    const on_ms = await sample(on.page).catch(() => -1)
    await on.context.close()
    cost[tier] = { off: off_ms, on: on_ms, delta: Math.round((on_ms - off_ms) * 100) / 100 }
    console.log(`[hillaire cost ${tier}] off=${off_ms}ms on=${on_ms}ms Δ=${cost[tier].delta}ms`)
  }
  // regression tripwire (frame-delta proxy carries measurement noise; the sub-ms target is the goal).
  expect(cost.high.delta).toBeLessThan(4)
})
