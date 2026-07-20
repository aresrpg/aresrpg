// TASTE-PASS capture (visual review gate): before/after PAIRS for the godrays-more-present +
// cinematic-blue-haze tuning. Drives the frozen engine facade under ?nocam=1 (the demo's rAF camera
// loop would overwrite our pose each frame). godrays are DEFAULT-OFF (#71/#73/#74 pitch-wash revert),
// so this opts in explicitly with ?godrays=1 (set below) to capture them.
// Output dir is CAP_DIR (before|after) so two runs pair up; screenshots are the authoritative proof.
//
// The four owner framings:
//   noon_vista   — the "too white" haze case (noon, elevated vista across terrain into the far shell).
//   golden_vista — golden hour toward the low sun: rays must be CLEARLY visible, haze may warm.
//   artifact_pose— the whiteout guard (pitch -0.5 rad, tod 0.25): MUST stay clean (center luma ≤130).
//   canopy_rays  — forest toward the low sun (tall conifers), shafts raking through the gaps.
import { test, expect } from '@playwright/test'

import { sample_canvas_colors, attach_gpu_error_watcher } from './harness.js'

const OUT = `/tmp/aresrpg-engine-artifacts/haze_godrays/${process.env.CAP_DIR || 'before'}`
const luma = (/** @type {{r:number,g:number,b:number}} */ c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

test('taste-pass before/after capture (high tier)', async ({ page }) => {
  test.setTimeout(180_000)
  const watcher = attach_gpu_error_watcher(page)
  const base = process.env.ARES_DEMO_ORIGIN || 'http://localhost:5247'
  // TIER is env-driven now (was hardcoded 'high'): the 2026-07-11 deep-blue-haze pass must prove the
  // blue lands on MEDIUM too (the tier ternary that byte-froze MEDIUM was deleted). godrays stay
  // high-only, so canopy shafts read at high; medium proves the haze HUE.
  const TIER = process.env.ARES_TIER || 'high'
  const url = new URL(`${base}/demo/index.html`)
  url.searchParams.set('seed', 'aresrpg')
  url.searchParams.set('tier', TIER)
  url.searchParams.set('godrays', '1') // godrays are DEFAULT-OFF (#71/#73/#74 pitch-wash revert) — opt in explicitly to capture them
  url.searchParams.set('nocam', '1') // WE own the camera
  // A/B: ARES_FARWASH=1 reproduces the PRE-FIX far-band wash (legacy 10–15 km sky mask) for the "before"
  // capture; unset ⇒ the shipped fog-range far-falloff. Must be injected before any page script runs.
  if (process.env.ARES_FARWASH) await page.addInitScript(() => /** @type {any} */ (window.__ARES_GODRAYS_FARWASH = 1))
  await page.goto(url.toString())
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 30_000 })
  // Let the INITIAL spawn-area load fully drain BEFORE posing — otherwise the first (noon) teleport
  // races the boot stream budget and captures a half-meshed shell (the first-pose starvation). This is
  // the demo's own natural boot load (no forced wide-vista over-stream), so it won't hit the atlas race.
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
        const p = pitch
        if (toward_sun) {
          const s = window.__atmo.sun_direction.value
          y = Math.atan2(-s.x, -s.z) // face the sun azimuth (keep the given pitch — controls the godray gate)
        }
        window.__engine.set_camera_orientation(y, p)
      },
      { pos, yaw, pitch, toward_sun }
    )
  // FAST fixed settle — enough for the near ring to mesh + godrays to lazily mount, but captured
  // BEFORE the HIGH-tier block-atlas over-streams past the device's 256-layer limit (the godrays-bench
  // lesson: "capture FAST to win the race"; waiting for queue==0 at a wide vista streams enough biomes
  // to crash the GPU). Poses are kept at y≤185 for the same reason. retries in the config cover the
  // rare crash that still slips through.
  const settle_streamed = async (/** @type {number} */ grace = 2500) => page.waitForTimeout(grace)
  // mean RGB of a normalized screenshot rect (in-page decode) — quantifies the far-haze hue (B vs R).
  /** @param {Buffer} png @param {{x0:number,x1:number,y0:number,y1:number}} r */
  const measure_rgb = (png, r) =>
    page.evaluate(
      async ({ dataurl, rect }) => {
        const img = new Image()
        await new Promise((res, rej) => ((img.onload = res), (img.onerror = rej), (img.src = dataurl)))
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
        g.drawImage(img, 0, 0)
        const d = g.getImageData(
          Math.round(img.width * rect.x0),
          Math.round(img.height * rect.y0),
          Math.round(img.width * (rect.x1 - rect.x0)),
          Math.round(img.height * (rect.y1 - rect.y0))
        ).data
        let r = 0
        let gg = 0
        let b = 0
        const n = d.length / 4
        for (let i = 0; i < d.length; i += 4) ((r += d[i]), (gg += d[i + 1]), (b += d[i + 2]))
        return { r: +(r / n).toFixed(1), g: +(gg / n).toFixed(1), b: +(b / n).toFixed(1) }
      },
      { dataurl: `data:image/png;base64,${png.toString('base64')}`, rect: r }
    )
  /** @param {string} name @param {{x0:number,x1:number,y0:number,y1:number}} [haze_rect] */
  const shot = async (name, haze_rect) => {
    const png = await page.locator('#canvas').screenshot({ path: `${OUT}/${name}.png` })
    const c = await sample_canvas_colors(page)
    const haze = haze_rect ? await measure_rgb(png, haze_rect) : null
    // three thin sub-bands (y0.50/0.56/0.62) with luma + B−R — the taste-gate proof numbers.
    const strips = haze_rect
      ? await Promise.all(
          HAZE_STRIPS.map(async (s) => {
            const m = await measure_rgb(png, s.rect)
            return { y: s.y, luma: +luma(m).toFixed(1), br: +(m.b - m.r).toFixed(1) }
          })
        )
      : null
    return { name, center: +luma(c.center).toFixed(1), sky: +luma(c.sky).toFixed(1), haze, strips }
  }

  /** @type {{name:string,center:number,sky:number,haze:{r:number,g:number,b:number}|null}[]} */
  const rows = []
  // far-haze band at the noon vista (the distant peaks sinking into haze, away from the sun) — the
  // cinematic-blue read. Avoids the HUD on the left; sits on the horizon haze, below the clear sky.
  const HAZE_BAND = { x0: 0.35, x1: 0.96, y0: 0.5, y1: 0.62 }
  // [GODRAY TASTE 2026-07-11] three thin horizontal strips across the far-haze band (y0.50 / 0.56 / 0.62)
  // — the A/B/A band numbers (luma + B−R) the godray far-falloff proof reads: HIGH-after must land within
  // ±8 luma / ±5 B−R of the MEDIUM reference (godrays off) at each strip while the shafts stay visible.
  const HAZE_STRIPS = [0.5, 0.56, 0.62].map((y) => ({ y, rect: { x0: 0.35, x1: 0.96, y0: y - 0.01, y1: y + 0.01 } }))

  // ── noon_vista — the "too white" haze case. y185 (not the y215 wide vista) so the far-shell stream
  // stays under the block-atlas limit; still frames mid+far terrain sinking into the noon haze. ─────
  await set_tod(0.375)
  await frame([70, 185, 70], 2.4, -0.12, false)
  await settle_streamed(3500) // noon vista re-streams the far shell; drain it so the far-haze band sits on fogged terrain, not sky
  rows.push(await shot('noon_vista', HAZE_BAND))

  // ── golden_vista — golden hour toward the low sun (rays must read) ─────────────────────────────
  await set_tod(0.71)
  // y185 (not y215): the harness's own y≤185 over-stream ceiling — a y215 wide vista over-streams the
  // HIGH block-atlas past the device budget and crashes the renderer (V8/ArrayBuffer OOM), worse under
  // concurrent GPU load. Still an elevated golden-hour vista toward the low sun, so the rays read.
  await frame([70, 185, 70], null, -0.1, true)
  await settle_streamed()
  rows.push(await shot('golden_vista', HAZE_BAND))

  // ── artifact_pose — the whiteout guard: MUST stay clean ───────────────────────────────────────
  await set_tod(0.25)
  await frame([70, 175, 70], Math.PI / 4, -0.5, false)
  await settle_streamed()
  rows.push(await shot('artifact_pose'))

  // ── canopy_rays — forest toward the low sun (tall conifers), shafts raking through the gaps.
  // Uses the proven [70,175,70] canyon spot (artifact_pose renders clean from here), looking UP toward
  // the golden sun so the tree gaps cast godray shafts toward the camera (froxels off ⇒ godrays are the
  // ray home). tod 0.66 keeps the sun above the +7° elevation gate; pitch +0.10 keeps the pitch gate open.
  await set_tod(0.66)
  await frame([70, 175, 70], null, 0.1, true)
  await settle_streamed()
  rows.push(await shot('canopy_rays'))

  // ── night — the deep-blue steer MUST gate to ~0 here (day_f≈0 at a near-black horizon): the haze
  // stays UNTOUCHED vs the prior pass (near-black band, B−R≈0). Same vista pose as noon for a clean pair.
  await set_tod(0.85)
  await frame([70, 185, 70], 2.4, -0.12, false)
  await settle_streamed()
  rows.push(await shot('night', HAZE_BAND))

  console.log(
    `\n[capture ${process.env.CAP_DIR || 'before'}] —\n  ` +
      rows
        .map(
          (r) =>
            `${r.name}: center=${r.center} sky=${r.sky}` +
            (r.haze ? ` haze_rgb=(${r.haze.r},${r.haze.g},${r.haze.b}) B−R=${(r.haze.b - r.haze.r).toFixed(1)}` : '') +
            (r.strips ? '\n    bands ' + r.strips.map((s) => `y${s.y}:L=${s.luma},B−R=${s.br}`).join('  ') : '')
        )
        .join('\n  ') +
      `\n  dir: ${OUT}`
  )

  const art = rows.find((r) => r.name === 'artifact_pose')
  const noon = rows.find((r) => r.name === 'noon_vista')
  expect(noon.sky, 'black frame = block-atlas overflow race; re-run').toBeGreaterThan(30)
  // THE ARTIFACT MATRIX INVARIANT: the downward+low-sun pose stays clean regardless of GODRAYS_GAIN
  // (the pitch gate hard-zeros u_godray_gain at -28.6°, so the shaft term is 0 there).
  expect(art.center, 'artifact pose must stay clean (≤130) at any godray strength').toBeLessThanOrEqual(130)

  const gpu_errors = watcher.errors.filter(
    (e) => !/depthorarraylayers|maxtexturearraylayers|exceeded maximum texture size|invalid texture/i.test(e)
  )
  expect(gpu_errors, gpu_errors.join('\n')).toHaveLength(0)
})
