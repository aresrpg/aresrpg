// LIGHTING WAVE capture (visual review gate) — before/after PAIRS for the auto-exposure + haze-scope +
// grade pass. Drives the frozen engine facade under ?nocam=1 (the demo's rAF camera loop would
// overwrite our pose each frame). CAP_DIR=before|after pairs two runs; screenshots are the proof.
//
// The exact failure framings (steady-state look must stay right; exposure may breathe):
//   open_noon   — open field at noon (the "too blue washed / not punchy" case; bright).
//   canopy_up   — under tall conifers looking UP toward the sky gaps (dark → exposure adapts UP).
//   dusk_vista  — golden hour vista (warm, dim).
//   pitch_up    — sky-filled framing (bright → exposure adapts DOWN; the "look up = white" guard).
//   pitch_down  — terrain-filled downward framing (the godray-whiteout guard pose).
// Plus a TRANSIENT sequence (after-only, when window.__auto_exposure exists): open→canopy→open, logging
// renderer exposure over time — the PROOF that the white flood is now a decaying eye-adaptation event,
// asymmetric (fast down when brightening, slow up when darkening), never a standing veil.
import { test, expect } from '@playwright/test'

import { sample_canvas_colors, attach_gpu_error_watcher } from './harness.js'

const OUT = `/tmp/aresrpg-engine-artifacts/lighting_wave/${process.env.CAP_DIR || 'before'}`
const luma = (/** @type {{r:number,g:number,b:number}} */ c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

test('lighting-wave before/after capture', async ({ page }) => {
  test.setTimeout(240_000)
  const watcher = attach_gpu_error_watcher(page)
  const base = process.env.ARES_DEMO_ORIGIN || 'http://localhost:5199'
  const TIER = process.env.ARES_TIER || 'high'
  const url = new URL(`${base}/demo/index.html`)
  url.searchParams.set('seed', 'aresrpg')
  url.searchParams.set('tier', TIER)
  url.searchParams.set('nocam', '1') // WE own the camera
  await page.goto(url.toString())
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 30_000 })
  await page
    .waitForFunction(() => window.__engine?.get_stats?.().chunk_queue_depth === 0, null, { timeout: 15_000 })
    .catch(() => {})
  await page.waitForTimeout(1200)

  const set_tod = (/** @type {number} */ t) => page.evaluate((tod) => window.__engine.set_time_of_day(tod), t)
  /** @param {[number,number,number]} pos @param {number|null} yaw @param {number} pitch @param {boolean} toward_sun */
  const frame = async (pos, yaw, pitch, toward_sun) =>
    page.evaluate(
      ({ pos, yaw, pitch, toward_sun }) => {
        window.__engine.set_camera_position(pos)
        let y = yaw ?? 0
        if (toward_sun) {
          const s = window.__atmo.sun_direction.value
          y = Math.atan2(-s.x, -s.z)
        }
        window.__engine.set_camera_orientation(y, pitch)
      },
      { pos, yaw, pitch, toward_sun }
    )
  const read_exposure = () =>
    page.evaluate(() => {
      const ae = /** @type {any} */ (window).__auto_exposure
      return ae ? +Number(ae.exposure).toFixed(3) : null
    })
  // full-frame mean RGB from a screenshot (in-page decode).
  /** @param {Buffer} png */
  const measure_full = (png) =>
    page.evaluate(
      async (dataurl) => {
        const img = new Image()
        await new Promise((res, rej) => ((img.onload = res), (img.onerror = rej), (img.src = dataurl)))
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, img.width, img.height).data
        let r = 0
        let gg = 0
        let b = 0
        const n = d.length / 4
        for (let i = 0; i < d.length; i += 4) ((r += d[i]), (gg += d[i + 1]), (b += d[i + 2]))
        return { r: +(r / n).toFixed(1), g: +(gg / n).toFixed(1), b: +(b / n).toFixed(1) }
      },
      `data:image/png;base64,${png.toString('base64')}`
    )
  const settle = async (/** @type {number} */ grace = 2500) => page.waitForTimeout(grace)
  /** @param {string} name */
  const shot = async (name) => {
    const png = await page.locator('#canvas').screenshot({ path: `${OUT}/${name}.png` })
    const c = await sample_canvas_colors(page)
    const full = await measure_full(png)
    const exposure = await read_exposure()
    return {
      name,
      full_luma: +luma(full).toFixed(1),
      center: +luma(c.center).toFixed(1),
      sky: +luma(c.sky).toFixed(1),
      full,
      exposure,
    }
  }

  /** @type {any[]} */
  const rows = []

  // ── open_noon — bright open vista ────────────────────────────────────────────────────────────
  await set_tod(0.375)
  await frame([70, 185, 70], 2.4, -0.12, false)
  await settle(3500)
  rows.push(await shot('open_noon'))

  // ── canopy_up — under conifers looking UP toward sky gaps (dark scene) ────────────────────────
  await set_tod(0.5)
  await frame([70, 175, 70], null, 0.18, true)
  await settle(3200)
  rows.push(await shot('canopy_up'))

  // ── dusk_vista — golden hour toward the low sun ──────────────────────────────────────────────
  await set_tod(0.71)
  await frame([70, 185, 70], null, -0.1, true)
  await settle()
  rows.push(await shot('dusk_vista'))

  // ── pitch_up — sky-filled framing (the "look up = white" guard) ──────────────────────────────
  await set_tod(0.375)
  await frame([70, 185, 70], 2.4, 0.32, false)
  await settle()
  rows.push(await shot('pitch_up'))

  // ── pitch_down — terrain-filled downward (godray-whiteout guard pose) ─────────────────────────
  await set_tod(0.25)
  await frame([70, 175, 70], Math.PI / 4, -0.5, false)
  await settle()
  rows.push(await shot('pitch_down'))

  // ── TRANSIENT (after-only): open→canopy→open, exposure over time = the eye-adaptation proof ───
  /** @type {any[]} */
  const transient = []
  const has_ae = (await read_exposure()) != null
  if (has_ae) {
    const stamp = async (/** @type {string} */ label) => {
      transient.push({ label, t_ms: Date.now(), exposure: await read_exposure() })
    }
    // settle bright (open noon)
    await set_tod(0.375)
    await frame([70, 185, 70], 2.4, -0.12, false)
    await page.waitForTimeout(4000)
    await stamp('open_settled')
    // step into the dark canopy — exposure should ramp UP slowly (dark adaptation)
    await frame([70, 175, 70], null, 0.18, true)
    await stamp('canopy_t0')
    await page.waitForTimeout(500)
    await stamp('canopy_t0.5')
    await page.waitForTimeout(1000)
    await stamp('canopy_t1.5')
    await page.waitForTimeout(2000)
    await stamp('canopy_t3.5')
    // step back to bright open — exposure should drop FAST (bright adaptation)
    await frame([70, 185, 70], 2.4, -0.12, false)
    await stamp('open_t0')
    await page.waitForTimeout(300)
    await stamp('open_t0.3')
    await page.waitForTimeout(1200)
    await stamp('open_t1.5')
  }

  console.log(
    `\n[lighting_wave ${process.env.CAP_DIR || 'before'}] tier=${TIER} —\n  ` +
      rows
        .map(
          (r) =>
            `${r.name}: full_luma=${r.full_luma} center=${r.center} sky=${r.sky} ` +
            `rgb=(${r.full.r},${r.full.g},${r.full.b}) exposure=${r.exposure ?? 'static'}`
        )
        .join('\n  ') +
      (transient.length
        ? `\n  --- transient (exposure over time) ---\n  ` +
          transient.map((t) => `${t.label}: exposure=${t.exposure}`).join('\n  ')
        : '') +
      `\n  dir: ${OUT}`
  )

  const noon = rows.find((r) => r.name === 'open_noon')
  const pdown = rows.find((r) => r.name === 'pitch_down')
  expect(noon.sky, 'black frame = block-atlas overflow race; re-run').toBeGreaterThan(30)
  // the downward+low-sun guard pose must never whiteout (no godrays default; this is the veil guard)
  expect(pdown.center, 'pitch_down must stay clean (≤150)').toBeLessThanOrEqual(150)

  const gpu_errors = watcher.errors.filter(
    (e) => !/depthorarraylayers|maxtexturearraylayers|exceeded maximum texture size|invalid texture/i.test(e)
  )
  expect(gpu_errors, gpu_errors.join('\n')).toHaveLength(0)
})
