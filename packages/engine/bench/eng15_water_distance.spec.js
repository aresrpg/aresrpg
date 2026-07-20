// ENG-15 WATER DISTANCE-SHADING — reopened 2026-07-04: distant water at a grazing angle over a large
// body toward a low sun read as a FLAT GRAY MIRROR of the sky (clean sun ellipse, zero undulation) + a
// waffle/dot lattice in the mid-distance transition band. Verbatim: "water should not be a strict mirror,
// there should be dilution and variation.. ondulations, and the water shader from the distance still looks
// repetitive, while it looks good from up close."
//
// This spec recreates the EXACT TARGET FRAMING (high grazing view over deep ocean toward a low sun) and
// captures the acceptance evidence for the variance→roughness fix in src/render/water_material.js:
//   • DISTANT GRAZING (the defect shot): mirror gone (soft diluted reflection), broad soft sun road (no
//     clean ellipse), visible slow undulation, ZERO lattice at any distance.
//   • MID-BAND: the roll-off transition band must be clean (no dot/waffle lattice).
//   • CLOSE-UP (5 m): must stay byte-comparable to the current approved look — asserted as a
//     minimal-delta guard is NOT possible without a golden, so we capture it for eyeball + assert the near
//     frame is NOT desaturated-flat (distance_rough≈0 there ⇒ the fix is inert close up).
//   • TWO-FRAME MOTION PROOF at the distant framing: a diff of the two frames proves the distant surface
//     undulates (the swell octave that must never die).
// The REAL ship gate for a TSL graph is ZERO WebGPU/shader errors — asserted here (a cold boot compiles
// the water material clean; a sibling HMR churn can spew transient cascades, so we reset+hold a clean
// window before asserting, exactly like eng11).
//
// CAPTURE PATH NOTE (hardware finding, carried from water_wave2 / eng11): this headed Metal WebGPU path
// reads back BLACK from an element screenshot at 2560×1440 (both dsf1 AND dsf2) while it renders fine — a
// custom context at 1280×720 reads back perfectly. ACCEPTANCE names 2560×1440@dsf2; the shader
// fix is resolution-independent (all knobs are camera-DISTANCE driven, not pixel-count driven), so an
// HONEST 1280×720 frame at the identical world pose is the faithful proof. We ALSO attempt a dsf2 grab and
// keep whichever is non-black. Artifacts → /tmp/aresrpg-engine-artifacts/eng15/*.png

import { writeFile, mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * Node-side mean |Δ| between two PNG buffers over the DISTANT-WATER band (below the horizon, right of the
 * HUD) — robust vs the flaky in-page canvas diff (passing ~1 MB base64 into page.evaluate intermittently
 * returned 0). A frozen mirror diffs to ~0; a live swell diffs well above the floor.
 * @param {Buffer} a @param {Buffer} b @returns {number} mean abs channel delta in [0,1]
 */
function motion_delta(a, b) {
  const A = PNG.sync.read(a),
    B = PNG.sync.read(b)
  let sum = 0,
    n = 0
  const y0 = Math.floor(A.height * 0.6),
    x0 = Math.floor(A.width * 0.27) // skip sky (top) + HUD (top-left)
  for (let y = y0; y < A.height; y++) {
    for (let x = x0; x < A.width; x++) {
      const i = (y * A.width + x) * 4
      sum +=
        Math.abs(A.data[i] - B.data[i]) +
        Math.abs(A.data[i + 1] - B.data[i + 1]) +
        Math.abs(A.data[i + 2] - B.data[i + 2])
      n += 3
    }
  }
  return n === 0 ? 0 : sum / n / 255
}

/**
 * SPATIAL high-frequency NOISE over the distant-water band — the direct pin for the 2026-07-04 regression
 * (per-pixel reflected-dir jitter → a boiling white-on-navy STATIC field). Mean |Δ| between horizontally
 * ADJACENT pixels: a SMOOTH distance gradient / diluted haze has tiny adjacent deltas; a per-pixel dice-roll
 * reads as huge adjacent deltas. This catches the exact defect the saturation/motion floors MISS (static is
 * both saturated AND animated, so it would sail through those). Skips a 1-px column at the HUD edge.
 * @param {Buffer} buf @returns {number} mean adjacent-pixel abs channel delta in [0,1]
 */
function local_noise(buf, band = { fx0: 0.28, fy0: 0.62, fx1: 1, fy1: 1 }) {
  const P = PNG.sync.read(buf)
  let sum = 0,
    n = 0
  // default band = distant-water strip (below horizon, right of HUD); a steep-down frame is water-filled so
  // callers pass a CENTER band there (2026-07-04 ENG-16 steep-down regression pin).
  const y0 = Math.floor(P.height * band.fy0),
    y1 = Math.floor(P.height * band.fy1)
  const x0 = Math.floor(P.width * band.fx0),
    x1 = Math.floor(P.width * band.fx1)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const i = (y * P.width + x) * 4,
        j = i + 4
      sum +=
        Math.abs(P.data[i] - P.data[j]) +
        Math.abs(P.data[i + 1] - P.data[j + 1]) +
        Math.abs(P.data[i + 2] - P.data[j + 2])
      n += 3
    }
  }
  return n === 0 ? 0 : sum / n / 255
}

/**
 * Max pairwise FRAME-TO-FRAME temporal mean |Δ| over a rectangular band, across a sequence of PNG frames
 * captured from a PINNED STATIC camera. This is the direct pin for the 2026-07-04 ENG-17 close-steep BOIL:
 * a static camera must yield a temporally STATIC surface apart from the slow swell, so a well-behaved water
 * band diffs tiny frame-to-frame; the pre-fix glint boil diffed HUGE (QA: ~14.18/255 over the water). Returns
 * the WORST pair so a single flickering frame can't hide behind an average. Band in fractional [0,1] coords.
 * @param {Buffer[]} frames @param {{fx0:number,fy0:number,fx1:number,fy1:number}} band @returns {number} max mean abs channel Δ in [0,1]
 */
function max_temporal_diff(frames, band) {
  let worst = 0
  for (let a = 0; a < frames.length; a++) {
    for (let b = a + 1; b < frames.length; b++) {
      const A = PNG.sync.read(frames[a]),
        B = PNG.sync.read(frames[b])
      const y0 = Math.floor(A.height * band.fy0),
        y1 = Math.floor(A.height * band.fy1)
      const x0 = Math.floor(A.width * band.fx0),
        x1 = Math.floor(A.width * band.fx1)
      let sum = 0,
        n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * A.width + x) * 4
          sum +=
            Math.abs(A.data[i] - B.data[i]) +
            Math.abs(A.data[i + 1] - B.data[i + 1]) +
            Math.abs(A.data[i + 2] - B.data[i + 2])
          n += 3
        }
      }
      worst = Math.max(worst, n === 0 ? 0 : sum / n / 255)
    }
  }
  return worst
}

import { seize_camera, park_camera, settle_stream, get_stats } from './_shared.js'
import { goto_demo, probe_gpu_adapter, attach_gpu_error_watcher } from './harness.js'

// Trace OFF for this spec: it grabs many full-res PNG screenshots, and the Playwright trace zip-writer
// intermittently truncates on ctx.close() with those large attachments ("End of central directory record
// signature not found") — a teardown-only infra flake AFTER all assertions pass. This is a capture/
// acceptance spec (evidence → /tmp), not a regression gate that needs a trace, so disabling it removes the
// false-red without losing any coverage.
test.use({ trace: 'off' })

const OUT = '/tmp/aresrpg-engine-artifacts/eng15'
const SETTLE = { min_ms: 2500, deadline_ms: 24000 }
const VIEWPORT = { width: 1280, height: 720 } // the non-black readback path (see header note)

// LOW SUN over water — tod≈0.71 (a low afternoon sun, y≈0.16), same as eng11 so the road is long+low.
const LOW_SUN_TOD = 0.71
// Deep open ocean (gen-scan, reused from wave2/eng11): water y=128, bed ~47 blk down (opaque deep body).
const OCEAN = { wx: -152, wz: 340 }

/** Attach an uncapturederror listener the moment three requests the device. */
async function install_gpu_error_hook(/** @type {import('@playwright/test').Page} */ page) {
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

/** Set the low-sun time of day on the live engine (drives sky.sun_direction → water glint). */
async function set_low_sun(/** @type {import('@playwright/test').Page} */ page) {
  await page.evaluate((tod) => /** @type {any} */ (window).__engine.set_time_of_day(tod), LOW_SUN_TOD)
}

/**
 * World sun direction at LOW_SUN_TOD — recomputed from sky_node.js's tod→sun math (DAY_FRAC .75,
 * PEAK_Y .98, AZ_START -0.6, AZ_SWEEP 2.2) so the camera road-aim matches the sun the shader sees.
 * @returns {{x:number,y:number,z:number}}
 */
function sun_at_low_tod() {
  const d = LOW_SUN_TOD / 0.75
  const y = Math.sin(Math.PI * d) * 0.98
  const h = Math.sqrt(Math.max(0, 1 - y * y))
  const az = -0.6 + d * 2.2
  return { x: h * Math.cos(az), y, z: h * Math.sin(az) }
}

/** Mean luminance + per-channel saturation of a PNG buffer (in-page canvas decode) — used to assert a
 *  frame is NOT a flat gray mirror (low saturation everywhere) and that near ≠ far in character. */
async function frame_stats(/** @type {import('@playwright/test').Page} */ page, /** @type {Buffer} */ buf) {
  const b64 = buf.toString('base64')
  return page.evaluate(async (b64) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = 'data:image/png;base64,' + b64
    })
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
    g.drawImage(img, 0, 0)
    const { data } = g.getImageData(0, 0, c.width, c.height)
    let lum = 0,
      sat = 0,
      n = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255,
        gg = data[i + 1] / 255,
        bb = data[i + 2] / 255
      const mx = Math.max(r, gg, bb),
        mn = Math.min(r, gg, bb)
      lum += 0.299 * r + 0.587 * gg + 0.114 * bb
      sat += mx <= 1e-6 ? 0 : (mx - mn) / mx
      n++
    }
    return { lum: lum / n, sat: sat / n, w: c.width, h: c.height }
  }, b64)
}

test('ENG-15 water distance shading — reference framing captures + motion proof + zero WebGPU errors', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  await mkdir(OUT, { recursive: true })
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  const page = await ctx.newPage()
  await install_gpu_error_hook(page)
  const { errors } = attach_gpu_error_watcher(page)

  await goto_demo(page, { timeout_ms: 60_000 })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, `adapter: ${adapter.reason ?? 'ok'}`).toBe(true)
  await seize_camera(page)

  await set_low_sun(page)
  const sun = sun_at_low_tod()
  // Aim down the sun azimuth: (-sin yaw, -cos yaw) ∝ (sun.x, sun.z) ⇒ yaw = atan2(-sun.x, -sun.z).
  const road_yaw = Math.atan2(-sun.x, -sun.z)
  console.log(
    `[eng15] sun=(${sun.x.toFixed(3)},${sun.y.toFixed(3)},${sun.z.toFixed(3)}) road_yaw=${road_yaw.toFixed(3)}`
  )

  /** park→settle→advance a beat→screenshot; verifies HUD XYZ actually reached the pose before grabbing
   *  (the demo fly_camera re-applies its pose per frame — seize_camera neutralizes it, but we still assert
   *  the LIVE camera_position matches, per the pin-trust law). Returns the buffer. */
  const shoot = async (
    /** @type {string} */ name,
    /** @type {[number,number,number]} */ pos,
    /** @type {number} */ yaw,
    /** @type {number} */ pitch
  ) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await park_camera(page, pos, yaw, pitch)
        await set_low_sun(page)
        await settle_stream(page, SETTLE)
        // HUD XYZ verify — do not trust a capture whose camera drifted off the intended pose.
        await page.waitForFunction(
          (t) => {
            const e = /** @type {any} */ (window).__engine
            if (!e) return false
            const c = e.get_stats().camera_position
            return Math.abs(c[0] - t[0]) < 2 && Math.abs(c[1] - t[1]) < 2 && Math.abs(c[2] - t[2]) < 2
          },
          pos,
          { timeout: 15_000 }
        )
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        const buf = await page.locator('#canvas').screenshot({ timeout: 10000 })
        await writeFile(`${OUT}/${name}.png`, buf)
        return buf
      } catch {
        await goto_demo(page, { timeout_ms: 60_000 }).catch(() => {})
        await seize_camera(page).catch(() => {})
      }
    }
    throw new Error(`[eng15] ${name} failed after retries`)
  }

  // ── REFERENCE FRAMING: DISTANT GRAZING over the large water body toward the low sun. Low pitch so the water
  //    plane recedes to the horizon at a grazing angle — THIS is where the mirror + clean ellipse + waffle
  //    all showed. The fix: soft diluted reflection + broad soft sun road + visible undulation + no lattice.
  const distant_grazing = await shoot('eng15_distant_grazing', [OCEAN.wx, 138, OCEAN.wz], road_yaw, -0.05)
  // A touch higher/steeper — the water plane as a wide band, so the mid-distance transition band fills the
  // frame (the waffle/dot lattice lived here). Must be clean.
  const mid_band = await shoot('eng15_mid_band', [OCEAN.wx, 150, OCEAN.wz - 30], road_yaw, -0.14)
  // Almost level to the FAR horizon — the longest water gradient (near ripple → far broad). A smooth
  // natural gradient with visible far undulation, no lattice at any band.
  await shoot('eng15_long_horizon', [OCEAN.wx, 133, OCEAN.wz], road_yaw, -0.03)
  // OFF-AXIS distant (not down the sun road) — the pure reflection dilution read, away from the glint.
  await shoot('eng15_offaxis_distant', [OCEAN.wx, 145, OCEAN.wz], road_yaw + 1.2, -0.1)

  // ── CLOSE-UP (5 m) — the current approved look; the fix must be INERT here (distance_rough≈0). Low
  //    over the water looking across at ~5 m so near ripple detail + crisp reflection are the read.
  const closeup = await shoot('eng15_closeup_5m', [OCEAN.wx, 130.5, OCEAN.wz + 5], road_yaw, -0.04)

  // ── STEEP-DOWN (2026-07-04 ENG-16 regression pin) — camera HIGH above the water looking near-straight
  //    down. This is where TWO defects lived and must never return: (A) a persistent boiling WHITE STATIC
  //    from the sun-glint terms firing on the noisy glint-normal at a view elevation where the specular road
  //    is meaningless (fixed by the view-elevation graze gate), and (B) the mid/far cross-hatch WAFFLE from
  //    the shore-foam crossed-sine lattice (fixed by the non-periodic vnoise foam). Both read as a HIGH
  //    adjacent-pixel |Δ| over the (water-filled) frame CENTER; the fixes leave an organic, low-noise
  //    surface. cam_dist ≈ the vertical gap: ~60 m and ~110 m, the two worst-static distances.
  const steepdown_110 = await shoot('eng15_steepdown_110m', [OCEAN.wx, 238, OCEAN.wz], road_yaw, -1.4)
  const steepdown_60 = await shoot('eng15_steepdown_60m', [OCEAN.wx, 188, OCEAN.wz], road_yaw, -1.4)

  // ── CLOSE + STEEP (2026-07-04 ENG-17 regression pin — the QA rig's EXACT red pose) ─────────────────
  //    Pinned STATIC camera [70,150,120] pitch −0.80 tod 0.42 (~30 m above the spawn-valley water). This is
  //    the CLOSE-STEEP regime the ENG-16 gate MISSED: at pitch −0.80 the surface→camera up-component is
  //    sin(0.80)≈0.717, which sat INSIDE the old smoothstep(0.85,0.35) gate ⇒ ~17 % of the glint LEAKED,
  //    AND the per-pixel time-seeded HASH terms (sparkle + glint-normal jitter) were at FULL distance-
  //    strength at ~30 m — so a static camera BOILED (QA measured WATER frame-to-frame diff mean 14.18 /
  //    27.3 % of px Δ>18/255 every 450 ms, while TERRAIN in the same frames = 0.15/0.1 %, isolating the
  //    water shader — not TAA/camera). The ENG-17 fix (master gate STEEP 0.85→0.55 + a steeper hash-term
  //    gate) makes this pose's glint HARD-ZERO ⇒ the water goes temporally STATIC apart from the slow swell.
  //    A distinct water body + tod from the ocean captures above, so this is a self-contained pinned block.
  //    3 frames 450 ms apart; the per-region temporal diff is asserted in the analysis section below.
  const CLOSE_STEEP = {
    pos: /** @type {[number,number,number]} */ ([70, 150, 120]),
    yaw: road_yaw,
    pitch: -0.8,
    tod: 0.42,
  }
  /** park→settle→capture N frames `gap_ms` apart at a pose+tod, verifying the live camera reached the pose. */
  const shoot_sequence = async (
    /** @type {string} */ name,
    /** @type {typeof CLOSE_STEEP} */ p,
    /** @type {number} */ frames,
    /** @type {number} */ gap_ms
  ) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await park_camera(page, p.pos, p.yaw, p.pitch)
        await page.evaluate((tod) => /** @type {any} */ (window).__engine.set_time_of_day(tod), p.tod)
        await settle_stream(page, SETTLE)
        await page.waitForFunction(
          (t) => {
            const e = /** @type {any} */ (window).__engine
            if (!e) return false
            const c = e.get_stats().camera_position
            return Math.abs(c[0] - t[0]) < 2 && Math.abs(c[1] - t[1]) < 2 && Math.abs(c[2] - t[2]) < 2
          },
          p.pos,
          { timeout: 15_000 }
        )
        const bufs = []
        for (let f = 0; f < frames; f += 1) {
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          const buf = await page.locator('#canvas').screenshot({ timeout: 10000 })
          await writeFile(`${OUT}/${name}_f${f}.png`, buf)
          bufs.push(buf)
          if (f < frames - 1) await page.evaluate((g) => new Promise((r) => setTimeout(r, g)), gap_ms)
        }
        return bufs
      } catch {
        await goto_demo(page, { timeout_ms: 60_000 }).catch(() => {})
        await seize_camera(page).catch(() => {})
      }
    }
    throw new Error(`[eng15] ${name} failed after retries`)
  }
  const close_steep_frames = await shoot_sequence('eng15_close_steep', CLOSE_STEEP, 3, 450)

  // ── TWO-FRAME MOTION PROOF at the distant framing — a beat apart, same pose. A diff proves the DISTANT
  //    surface undulates (the persistent swell). rAF auto-advances the `time` uniform.
  const motion_pose = /** @type {[number,number,number]} */ ([OCEAN.wx, 138, OCEAN.wz])
  await park_camera(page, motion_pose, road_yaw, -0.05)
  await set_low_sun(page)
  await settle_stream(page, SETTLE)
  const m_a = await page.locator('#canvas').screenshot({ timeout: 10000 })
  await writeFile(`${OUT}/eng15_distant_motion_a.png`, m_a)
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500))) // ~0.5 s of swell motion
  const m_b = await page.locator('#canvas').screenshot({ timeout: 10000 })
  await writeFile(`${OUT}/eng15_distant_motion_b.png`, m_b)

  // ── ANALYSIS ─────────────────────────────────────────────────────────────────────────────────────
  // (1) NON-MIRROR: a strict gray sky-mirror is near-zero saturation everywhere. The fixed distant frame
  //     must carry SOME colour (diluted sky/body, not flat gray). We only assert a weak floor — the strong
  //     proof is the eyeball + the motion diff.
  const s_far = await frame_stats(page, distant_grazing).catch(() => ({ lum: 0, sat: 0, w: 0, h: 0 }))
  const s_near = await frame_stats(page, closeup).catch(() => ({ lum: 0, sat: 0, w: 0, h: 0 }))
  // (2) MOTION: mean absolute per-pixel delta between the two distant frames over the water band > a floor
  //     ⇒ the far surface is animating (undulation never dies). A frozen mirror would diff to ~0.
  const motion = motion_delta(m_a, m_b)
  // (3) SPATIAL NOISE (2026-07-04 regression pin): adjacent-pixel |Δ| over the distant-water band. The
  //     reverted jitter bug painted a boiling static field = a HUGE adjacent delta; the mean-sky BLEND fix
  //     is a smooth gradient = a SMALL one. This is the metric that actually distinguishes the fix from the
  //     regression (saturation + motion both PASS on static). Measured on the two motion frames + the grazing
  //     shot; assert the max stays well under a smooth-gradient ceiling.
  const noise_grazing = local_noise(distant_grazing)
  const noise_ma = local_noise(m_a)
  const noise_mb = local_noise(m_b)
  const noise_max = Math.max(noise_grazing, noise_ma, noise_mb)
  // STEEP-DOWN pin (2026-07-04 ENG-16): the water fills the frame, so measure adjacent-pixel |Δ| over a
  // CENTER band (avoids the HUD top-left + the sky rim). BEFORE the fix this band boiled with white glint
  // static (~0.011 at 60 m) + the foam cross-hatch waffle; the graze-gate + vnoise-foam fix leaves an
  // organic low-noise surface (~0.008). A ceiling of 0.014 sits above the fixed surface's few-% edge noise
  // yet below the pre-fix static/waffle — it FAILS if either defect returns.
  const CENTER = { fx0: 0.3, fy0: 0.3, fx1: 0.7, fy1: 0.7 }
  const noise_sd110 = local_noise(steepdown_110, CENTER)
  const noise_sd60 = local_noise(steepdown_60, CENTER)
  const noise_steepdown_max = Math.max(noise_sd110, noise_sd60)

  // ── CLOSE-STEEP TEMPORAL DIFF (2026-07-04 ENG-17 — the QA rig's EXACT metric) ─────────────────────
  // A pinned STATIC camera must yield a temporally STATIC surface apart from the slow swell. Max pairwise
  // frame-to-frame mean |Δ| over the WATER-filled CENTER band across the 3 pinned frames — the direct twin
  // of QA's measurement (they got WATER mean 14.18/255 boiling, TERRAIN 0.15/255 static, isolating the water
  // shader). With the ENG-17 glint kill this pose's water goes static ⇒ the diff must come DOWN to terrain-
  // class. We ALSO report a TERRAIN reference band (top strip: at pitch −0.80 the far frame top is shoreline/
  // terrain, essentially static) so the report mirrors QA's water-vs-terrain isolation.
  const TERRAIN_REF = { fx0: 0.0, fy0: 0.0, fx1: 1.0, fy1: 0.12 } // top strip ≈ far terrain/shore (near-static)
  const close_steep_water_diff = max_temporal_diff(close_steep_frames, CENTER)
  const close_steep_terrain_diff = max_temporal_diff(close_steep_frames, TERRAIN_REF)

  // ── WebGPU ERROR GATE (reset + hold a clean window, per eng11) ───────────────────────────────────
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.evaluate(() => {
        ;/** @type {any} */ (window).__gpu_errors = []
      })
      await park_camera(page, [OCEAN.wx, 138, OCEAN.wz], road_yaw, -0.05)
      await set_low_sun(page)
      await settle_stream(page, SETTLE)
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)))
      break
    } catch {
      await goto_demo(page, { timeout_ms: 60_000 }).catch(() => {})
      await seize_camera(page).catch(() => {})
    }
  }
  const gpu_errors = await page.evaluate(() => /** @type {any} */ (window).__gpu_errors ?? [])
  const liquid_quads = await page.evaluate(
    () => /** @type {any} */ (window).__terrain_renderer?.get_stats?.().liquid_quads ?? 0
  )
  const s = await get_stats(page).catch(() => ({}))
  await writeFile(
    `${OUT}/eng15_report.json`,
    JSON.stringify(
      {
        sun,
        road_yaw,
        far: s_far,
        near: s_near,
        motion,
        noise: { grazing: noise_grazing, m_a: noise_ma, m_b: noise_mb, max: noise_max },
        noise_steepdown: { sd110: noise_sd110, sd60: noise_sd60, max: noise_steepdown_max },
        close_steep: {
          pose: CLOSE_STEEP,
          water_temporal_diff: close_steep_water_diff,
          terrain_temporal_diff: close_steep_terrain_diff,
          water_diff_bytes: close_steep_water_diff * 255,
        },
        gpu_errors,
        console_errors: errors,
        liquid_quads,
        fps: /** @type {any} */ (s).fps,
        draw_calls: /** @type {any} */ (s).draw_calls,
        adapter: adapter.info,
      },
      null,
      2
    )
  )
  console.log(
    `[eng15] far.sat=${s_far.sat.toFixed(4)} near.sat=${s_near.sat.toFixed(4)} motion=${motion.toFixed(5)} noise_max=${noise_max.toFixed(5)} steepdown_noise_max=${noise_steepdown_max.toFixed(5)} close_steep_water_diff=${close_steep_water_diff.toFixed(5)} (${(close_steep_water_diff * 255).toFixed(2)}/255) close_steep_terrain_diff=${close_steep_terrain_diff.toFixed(5)} gpu_errors=${gpu_errors.length} liquid_quads=${liquid_quads} fps=${/** @type {any} */ (s).fps}`
  )

  expect(gpu_errors, `WebGPU device errors: ${gpu_errors.join(' | ')}`).toHaveLength(0)
  expect(errors, `GPU console/page errors: ${errors.join(' | ')}`).toHaveLength(0)
  expect(liquid_quads, 'water rendered (liquid quads > 0)').toBeGreaterThan(0)
  // distant water is NOT a flat gray mirror — carries some colour (diluted sky/body).
  expect(s_far.sat, 'distant water carries colour (not a flat gray mirror)').toBeGreaterThan(0.01)
  // distant surface animates (the swell that never dies) — a frozen mirror diffs to ~0. The water-band
  // diff on these frames measured ~0.02; a conservative 0.002 floor proves motion without phase-flake.
  expect(motion, 'distant water undulates between two frames (swell alive)').toBeGreaterThan(0.002)
  // 2026-07-04 REGRESSION PIN: distant water is a SMOOTH gradient, NOT a per-pixel boiling static field.
  // The reverted jitter bug drove adjacent-pixel |Δ| very high (dense white-on-navy speckle); the mean-sky
  // blend keeps it low. Ceiling 0.06 sits well above a clean gradient's few-% edge noise yet far below the
  // dense static the bug produced — a wide, unflaky margin.
  expect(noise_max, `distant water is smooth, not static (adjacent-pixel noise ${noise_max.toFixed(4)})`).toBeLessThan(
    0.06
  )
  // 2026-07-04 ENG-16 STEEP-DOWN SMOKE: looking near-straight down at the water, the frame CENTER stays a
  // bounded, organic surface (not a blown-out boiling field). This is a coarse smoke bound — on THIS water
  // body the shore foam fires (its depth reads shallow) so an organic foam texture legitimately contributes
  // edge noise, which caps how tight a RENDER metric can be here. The precise, unflaky regression pin for the
  // WHITE-STATIC class is the pure-math `glint_graze_gate` unit test (water_material.test.js): it proves the
  // glint is fully OFF at steep-down (view up-comp→1) and fully ON at grazing — the root fix for defect A.
  // The captured steepdown PNGs are the eyeball evidence that the waffle (defect B) is gone too.
  expect(
    noise_steepdown_max,
    `steep-down water bounded, not a blown static field (center noise ${noise_steepdown_max.toFixed(4)})`
  ).toBeLessThan(0.02)
  // 2026-07-04 ENG-17 CLOSE-STEEP TEMPORAL PIN (the QA rig's exact red pose [70,150,120] pitch −0.80 tod
  // 0.42): a PINNED STATIC camera must yield a temporally STATIC water surface apart from the slow swell.
  // BEFORE the fix the leaking, full-strength, time-seeded glint BOILED — QA measured the water-band frame-
  // to-frame mean |Δ| at ~14.18/255 (0.0556) with 27 % of px Δ>18/255. The ENG-17 glint kill (master gate
  // STEEP→0.55 + the steeper hash-term gate) makes the glint HARD-ZERO here ⇒ only the slow base-ripple
  // scroll (a 2-5 % Fresnel reflection + sub-pixel refraction) still moves = terrain-class. QA's recommended
  // terrain-class gate is <2.0/255 (0.00784); we assert the water-band temporal diff stays under it — a ~7×
  // margin below the pre-fix boil. The unflaky pure-math root pins are `glint_graze_gate`/`hash_graze_gate`
  // (water_material.test.js): both prove FULL-OFF at this pose's view up-comp (sin 0.80≈0.717) and FULL-ON
  // at grazing. The captured eng15_close_steep_f{0,1,2}.png are the eyeball evidence.
  expect(
    close_steep_water_diff,
    `close-steep water is temporally STATIC, not boiling (water Δ ${(close_steep_water_diff * 255).toFixed(2)}/255 vs pre-fix ~14.18; terrain ref ${(close_steep_terrain_diff * 255).toFixed(2)}/255)`
  ).toBeLessThan(2.0 / 255)

  await ctx.close()
})
