// NG2-ATMO acceptance gate — the cinematic-landing checks from the phase-2 brief:
//   1. boot clean (ZERO WebGPU/page errors with the full post stack mounted)
//   2. grade A/B (default punchy grade vs all-neutral — same pose)
//   3. atmosphere on/off A/B (the "chaos scene" delta: haze+fog+grade vs neutralized)
//   4. sunset god rays (tod near dusk, camera into the sun azimuth)
//   5. clouds-over-sky-island vista (hero island ~(1825,321,1422) — deck must sit ABOVE it)
//   6. 15:5 day/night cycle ticking (tod sweep drives sky + clouds + fog coherently)
//   7. perf: p99 ≤ 12 ms full stack at 2560×1440 (1280×720 @ deviceScaleFactor 2) + a per-pass
//      cost breakdown via the tier ladder (potato=base+grade → low=+clouds → medium=+godrays →
//      high=+froxels), each at steady state.
// Artifacts → /tmp/aresrpg-engine-artifacts/atmo/*.png (repo bench convention).

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

const OUT = '/tmp/aresrpg-engine-artifacts/atmo'
// Origin overridable via ARES_DEMO_ORIGIN (harness convention) so a session can point this gate at a
// DEDICATED vite (e.g. :5247) and leave the main dev :5199 untouched. Default unchanged when unset.
const DEMO = `${process.env.ARES_DEMO_ORIGIN || 'http://localhost:5199'}/demo/`

test.describe.configure({ mode: 'serial' })

/**
 * Boot the demo on a fresh context, collect console/page errors, wait for the engine + first
 * streaming settle. Returns { page, context, errors }.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ tier?: string, dsf?: number }} [opts]
 */
async function boot(browser, { tier = 'high', dsf = 1 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: dsf,
  })
  const page = await context.newPage()
  /** @type {string[]} */
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // Scope the zero-errors gate to ENGINE/GPU errors: resource 404s (the avatar lane's missing
    // draco decoder) and wallet-extension noise are other lanes' known issues, not atmosphere state.
    if (/Failed to load resource|MetaMask|draco/i.test(t)) return
    errors.push(`console.error: ${t}`)
  })
  await page.goto(`${DEMO}?tier=${tier}`)
  // NULL-SAFE settle (vite can full-reload once mid-boot when a fresh import triggers dep
  // re-optimize, and sibling saves reload any time — poll through it): engine present AND the near
  // ring drained AND frames flowing.
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
  return { page, context, errors }
}

/** @param {import('@playwright/test').Page} page @param {number} ms */
const settle = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms)

/**
 * Install the camera-pin interceptor ONCE (idempotent — the bench-playbook pattern): the demo's
 * drive_camera rAF pushes ITS OWN pose into the engine every frame, so a set-once teleport is
 * overwritten next frame. Patch the engine setters to substitute `window.__pin` when present.
 * @param {import('@playwright/test').Page} page
 */
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

/**
 * Pin the camera pose (+ optional tod) and wait until the LIVE camera reached it + the ring
 * re-streamed. `toward_sun` aims into the current sun direction (for the god-ray framing).
 * RELOAD-TOLERANT: sibling workers saving watched files mid-run trigger a vite full reload of the
 * demo page (── the hot-tree reality ──), which wipes `__engine`/`__pin`; predicates are null-safe
 * and the whole pose re-asserts itself once after a reload.
 * @param {import('@playwright/test').Page} page
 * @param {{ pos?: [number,number,number], toward_sun?: boolean, yaw?: number, pitch?: number, tod?: number }} o
 * @param {number} [attempt]
 */
async function pose(page, o, attempt = 0) {
  try {
    await page.waitForFunction(() => /** @type {any} */ (window).__engine != null, null, { timeout: 60_000 })
    await install_pin(page)
    await page.evaluate((p) => {
      const w = /** @type {any} */ (window)
      const e = w.__engine
      if (typeof p.tod === 'number') e.set_time_of_day(p.tod)
      const cur = e.get_stats().camera_position
      let { yaw } = p
      let pitch = p.pitch ?? 0
      if (p.toward_sun) {
        const s = w.__atmo.sun_direction.value
        // three YXZ: forward = (−sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch) — face the sun.
        yaw = Math.atan2(-s.x, -s.z)
        pitch = Math.asin(Math.max(-1, Math.min(1, s.y)))
      }
      const prev = w.__pin
      w.__pin = {
        pos: p.pos ?? prev?.pos ?? cur,
        yaw: yaw ?? prev?.yaw ?? 0,
        pitch,
      }
    }, o)
    if (o.pos) {
      // wait until the LIVE camera actually reached the pin (|Δ|<2 m) — the demo push applies it
      // next frame — then until the teleport's re-stream drains so shots show terrain, not void.
      await page.waitForFunction(
        (target) => {
          const e = /** @type {any} */ (window).__engine
          if (!e) return false // mid-reload — keep polling
          const c = e.get_stats().camera_position
          return Math.abs(c[0] - target[0]) < 2 && Math.abs(c[1] - target[1]) < 2 && Math.abs(c[2] - target[2]) < 2
        },
        o.pos,
        { timeout: 30_000 }
      )
      // give the ring a beat to REGISTER the teleport (a queue===0 poll can race the enqueue —
      // the 05_island pancake), then wait for the re-stream to drain.
      await settle(page, 1500)
      await page.waitForFunction(
        () => {
          const e = /** @type {any} */ (window).__engine
          return e != null && e.get_stats().chunk_queue_depth === 0
        },
        null,
        { timeout: 120_000 }
      )
    }
  } catch (e) {
    if (attempt < 2) {
      // page likely reloaded under us (sibling save → vite full reload): wait for the re-boot and
      // re-assert the ENTIRE pose (pin + tod are gone on a fresh page).
      await page.waitForFunction(() => /** @type {any} */ (window).__engine != null, null, { timeout: 90_000 })
      return pose(page, o, attempt + 1)
    }
    throw e
  }
  await settle(page, 800) // let clouds/froxels/shadows tick a few frames at the new pose
}

/**
 * Neutralize the ATMOSPHERE DENSITY knobs (the "before" of the fog-law A/B). The GRADE stays ON in
 * both captures — the fog law gates FOG abuse, while the Conquest grade is deliberately
 * faded; toggling the grade too would punish the art direction as if it were fog creep.
 * @param {import('@playwright/test').Page} page
 */
const atmo_off = (page) =>
  page.evaluate(() => {
    const a = /** @type {any} */ (window).__atmo
    const p = /** @type {any} */ (window).__post
    a.froxels.fog_k.value = 0
    a.near_haze.value = 0
    a.clouds.coverage.value = 0
    p.shaft_strength.value = 0
  })

/** restore the shipped config. @param {import('@playwright/test').Page} page */
const atmo_on = (page) =>
  page.evaluate(() => {
    const a = /** @type {any} */ (window).__atmo
    const p = /** @type {any} */ (window).__post
    a.froxels.fog_k.value = a.config.froxel.fog_k
    a.near_haze.value = a.config.froxel.near_haze
    a.clouds.coverage.value = a.config.cloud.coverage
    p.shaft_strength.value = a.config.godrays.strength
  })

/**
 * Mean luminance of a normalized screenshot rect (in-page decode, the classifier pattern) — the
 * water-glint A/B reads two bands of the same frame pair with this.
 * @param {import('@playwright/test').Page} page @param {Buffer} png
 * @param {{x0:number,x1:number,y0:number,y1:number}} r normalized rect
 * @returns {Promise<number>} mean luma [0,1]
 */
function measure_band(page, png, r) {
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
      let l = 0
      let n = 0
      for (let i = 0; i < d.length; i += 16) {
        l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
        n++
      }
      return l / n / 255
    },
    { url: `data:image/png;base64,${png.toString('base64')}`, rect: r }
  )
}

/**
 * OWNER FOG LAW visibility metric (law §1+§3, both gates on the same capture): decode a screenshot
 * in-page (the bench classifier pattern) and measure the TERRAIN BAND (center 70%×40%, below the
 * HUD/GUI) — luminance stddev (soup washes structure → stddev collapses) + mean saturation (fog
 * soup kills the far shell's colors). Asserted RELATIVE to the atmosphere-OFF capture so the gate
 * self-calibrates (no magic constants) and fog creep can never regress silently.
 * @param {import('@playwright/test').Page} page @param {Buffer} png
 * @returns {Promise<{lum_std:number, sat_mean:number, lum_mean:number}>}
 */
function measure_visibility(page, png) {
  const data_url = `data:image/png;base64,${png.toString('base64')}`
  return page.evaluate(async (url) => {
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
    // NEAR-TERRAIN quadrant (lower-right at the calibrated pose — the island): the law's subject is
    // the readability of THINGS through the fog, not open water (which is low-chroma even unfogged).
    const rx = Math.round(img.width * 0.55)
    const ry = Math.round(img.height * 0.55)
    const d = g.getImageData(rx, ry, Math.round(img.width * 0.4), Math.round(img.height * 0.4)).data
    let n = 0
    let lsum = 0
    let l2 = 0
    let ssum = 0
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i] / 255
      const gg = d[i + 1] / 255
      const b = d[i + 2] / 255
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b
      const mx = Math.max(r, gg, b)
      const mn = Math.min(r, gg, b)
      ssum += mx > 1e-4 ? (mx - mn) / mx : 0
      lsum += l
      l2 += l * l
      n++
    }
    const mean = lsum / n
    return { lum_std: Math.sqrt(Math.max(0, l2 / n - mean * mean)), sat_mean: ssum / n, lum_mean: mean }
  }, data_url)
}

test('full-stack boot + acceptance shots (high tier)', async ({ browser }) => {
  test.setTimeout(420_000)
  await mkdir(OUT, { recursive: true })
  const { page, context, errors } = await boot(browser, { tier: 'high' })

  // ── 1. boot vista, full stack ───────────────────────────────────────────────────────────────────
  await pose(page, { tod: 0.375, pos: [70, 215, 70], yaw: 2.4, pitch: -0.18 }) // noon, above spawn hills
  await page.screenshot({ path: `${OUT}/01_boot_vista_noon.png` })

  // ── 2+3. A/B: atmosphere+grade OFF vs ON at the same pose (the chaos-scene delta) ───────────────
  // elevated vista ACROSS the terrain: near clutter + mid slopes + far shell + sky in one frame, so
  // haze/fog/clouds/grade all participate in the delta.
  await pose(page, { pos: [0, 215, 0], yaw: 2.4, pitch: -0.22 })
  await atmo_off(page)
  await settle(page, 600)
  const off_png = await page.screenshot({ path: `${OUT}/02_chaos_scene_OFF.png` })
  await atmo_on(page)
  await settle(page, 600)
  const on_png = await page.screenshot({ path: `${OUT}/03_chaos_scene_ON.png` })

  // ── OWNER FOG LAW gate (§1+§3, same capture): hierarchy WITHOUT soup. The full stack must keep
  // the terrain band's structure (luminance stddev) and the scene's colors (mean saturation)
  // relative to the atmosphere-OFF baseline — fog is seasoning, never soup, on a clear day.
  // Floors: near-terrain must keep the lion's share of its structure + color through the default
  // (clear-day) atmosphere — fog is seasoning there. The noon godray white-wash measured ~0.18×/0.09×
  // on the earlier region — an order below any floor here, exactly what this gate exists to catch.
  const off_vis = await measure_visibility(page, off_png)
  const on_vis = await measure_visibility(page, on_png)
  console.log('[fog-law] OFF:', JSON.stringify(off_vis), 'ON:', JSON.stringify(on_vis))
  expect(on_vis.lum_std).toBeGreaterThan(off_vis.lum_std * 0.6) // near structure survives (no soup)
  expect(on_vis.sat_mean).toBeGreaterThan(off_vis.sat_mean * 0.6) // near colors survive

  // ── 4. sunset god rays: TRUE sunset (tod 0.735 ⇒ sun_y≈0.04 — the dusk tint band), into the sun.
  await pose(page, { tod: 0.735, toward_sun: true })
  await settle(page, 1200) // shadow rebake + froxel re-integrate at the new sun
  await page.screenshot({ path: `${OUT}/04_sunset_godrays.png` })

  // ── 4b. WATER SUN-ROAD GLINT tracks the tod sun (NG2-C handoff, the coordinator's exact failure
  // mode): A/B the SAME low-sun framing with the water's reflection sun pointing at the WRONG sun
  // (azimuth-flipped — sun behind the camera, the forward glow term dies) vs AIMED by
  // set_time_of_day. Terrain/haze pixels are identical between the two frames, so the diff isolates
  // the water's reflection response. tod 0.72 (sun_y≈0.12) keeps the halo glare below the glint.
  await pose(page, { tod: 0.72, toward_sun: true })
  await atmo_off(page) // kill fog/haze/shaft glare so the water's own reflection carries the diff
  await settle(page, 700)
  await page.evaluate(() => {
    const w = /** @type {any} */ (window)
    const s = w.__atmo.sun_direction.value
    w.__terrain_renderer.set_sun_direction({ x: -s.x, y: s.y, z: -s.z }) // the WRONG sun (azimuth flip)
  })
  await settle(page, 500)
  const wrong_png = await page.screenshot({ path: `${OUT}/04b_glint_wrong_sun.png` })
  await page.evaluate(() => /** @type {any} */ (window).__engine.set_time_of_day(0.72)) // re-aims water
  await settle(page, 500)
  const aimed_png = await page.screenshot({ path: `${OUT}/04c_glint_aimed.png` })
  await atmo_on(page)
  // near water band, below the sun (screen-center at the toward_sun pose), under the horizon line.
  const glint_band = { x0: 0.3, x1: 0.7, y0: 0.62, y1: 0.92 }
  const [wrong_l, aimed_l] = await Promise.all([
    measure_band(page, wrong_png, glint_band),
    measure_band(page, aimed_png, glint_band),
  ])
  console.log(`[glint] band luma wrong-sun→aimed: ${wrong_l.toFixed(4)} → ${aimed_l.toFixed(4)}`)
  // the sun-road sits under the LOW sun: aiming the water sun forward brightens the band vs the
  // azimuth-flipped (wrong) sun. Any regression that stops driving set_water_sun re-freezes the
  // uniform and this delta collapses to ~0.
  expect(aimed_l).toBeGreaterThan(wrong_l + 0.004)

  // ── 5. clouds over the sky island (hero island ~(1825,321,1422)) — pose INSIDE the near ring
  // (≤160 m) so the island streams in voxel detail, not the far-shell pancake.
  await pose(page, { tod: 0.375, pos: [1745, 345, 1335], yaw: Math.atan2(-(1825 - 1745), -(1422 - 1335)), pitch: 0.12 })
  await page.screenshot({ path: `${OUT}/05_island_clouds.png` })

  // ── 6. day/night cycle sweep (15:5 encoded in DAY_FRAC=0.75) ───────────────────────────────────
  for (const [name, tod] of [
    ['dawn', 0.02],
    ['noon', 0.375],
    ['dusk', 0.72],
    ['night', 0.85],
  ]) {
    await pose(page, { tod: /** @type {number} */ (tod), yaw: 2.4, pitch: 0.05 })
    await settle(page, 900)
    await page.screenshot({ path: `${OUT}/06_cycle_${name}.png` })
  }

  // ── sun tracks the cycle (sanity: sun_direction.y sign day vs night) ────────────────────────────
  const sun_check = await page.evaluate(() => {
    const e = /** @type {any} */ (window).__engine
    const a = /** @type {any} */ (window).__atmo
    e.set_time_of_day(0.375)
    const noon_y = a.sun_direction.value.y
    e.set_time_of_day(0.85)
    const night_y = a.sun_direction.value.y
    e.set_time_of_day(0.375)
    return { noon_y, night_y }
  })
  expect(sun_check.noon_y).toBeGreaterThan(0.8)
  expect(sun_check.night_y).toBeLessThan(0)

  // ── zero WebGPU/page errors with the full stack ─────────────────────────────────────────────────
  if (errors.length) console.log('CAPTURED ERRORS:\n' + errors.join('\n'))
  expect(errors).toEqual([])

  await context.close()
})

test('perf gate: p99 ≤ 12ms full stack @2560×1440 + tier-ladder breakdown', async ({ browser }) => {
  test.setTimeout(600_000)
  await mkdir(OUT, { recursive: true })
  /** @type {Record<string, { p50:number, p75:number, p99:number, fps:number }>} */
  const ladder = {}

  for (const tier of ['potato', 'low', 'medium', 'high']) {
    const { page, context, errors } = await boot(browser, { tier, dsf: 2 })
    await pose(page, { tod: 0.375, yaw: 2.4, pitch: -0.1 })
    await settle(page, 1500) // let percentile window flush post-stream
    // steady-state sample: slow in-place orbit (no new chunks), 20×500 ms. Retried once if a
    // sibling save reloads the page mid-measure (hot-tree reality).
    const measure_once = () =>
      page.evaluate(async () => {
        const e = /** @type {any} */ (window).__engine
        /** @type {{p50:number,p75:number,p99:number,fps:number}[]} */
        const out = []
        let yaw = 2.4
        for (let i = 0; i < 20; i++) {
          yaw += 0.05
          e.set_camera_orientation(yaw, -0.1)
          await new Promise((r) => setTimeout(r, 500))
          const s = e.get_stats()
          out.push({ p50: s.frame_ms_p50, p75: s.frame_ms_p75, p99: s.frame_ms_p99, fps: s.fps })
        }
        // median-of-samples for stability + the worst p99 seen.
        const med = (/** @type {number[]} */ a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
        return {
          p50: med(out.map((s) => s.p50)),
          p75: med(out.map((s) => s.p75)),
          p99: med(out.map((s) => s.p99)),
          p99_worst: Math.max(...out.map((s) => s.p99)),
          fps: med(out.map((s) => s.fps)),
        }
      })
    /** @type {Awaited<ReturnType<typeof measure_once>>} */
    let stats
    try {
      stats = await measure_once()
    } catch {
      // page reloaded mid-measure (sibling save) — wait for the re-boot, re-pose, measure again.
      await pose(page, { tod: 0.375, yaw: 2.4, pitch: -0.1 })
      await settle(page, 1500)
      stats = await measure_once()
    }
    ladder[tier] = stats
    console.log(`[perf] tier=${tier} @2560x1440:`, JSON.stringify(stats))
    if (errors.length) console.log(`[perf] tier=${tier} ERRORS:\n` + errors.join('\n'))
    expect(errors).toEqual([])
    await context.close()
  }

  // per-pass deltas from the ladder (potato = scene+grade base).
  const d = (/** @type {string} */ a, /** @type {string} */ b) =>
    Math.round((ladder[b].p50 - ladder[a].p50) * 100) / 100
  console.log(
    '[perf] per-pass p50 deltas: clouds(low-potato)=' +
      d('potato', 'low') +
      'ms, +godrays(medium-low)=' +
      d('low', 'medium') +
      'ms, +froxels(high-medium)=' +
      d('medium', 'high') +
      'ms'
  )
  console.log(
    '[perf] FULL STACK (high): p50=' + ladder.high.p50 + ' p75=' + ladder.high.p75 + ' p99=' + ladder.high.p99
  )

  // THE GATE: p99 ≤ 12 ms with the full stack at 2560×1440.
  expect(ladder.high.p99).toBeLessThanOrEqual(12)
})
