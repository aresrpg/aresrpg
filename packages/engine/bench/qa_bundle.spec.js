// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// QA EVIDENCE BUNDLE producer (T2). Regenerates the artifacts an independent reviewer needs as
// 1280×720 STILLS (the known-good canvas readback) + numeric gate JSON, on the live :5199 world with
// the pin+settle protocol. Sections mirror the ticket:
//   (a) ZERO-HOLES — elevated 360° orbit of spawn (5 vantages) + steep leg (-128,-896) + a full-height mountain w/ trees
//   (b) FAR-SHELL  — boot series (0.5/1/2/5s), a 500m movement series (5 stills), horizon vista, sky-island archipelago from ground
//   (c) PERF       — standard rotation+fly rAF measurement → p50/p75/p99 JSON
//   (d) VIDEO      — 60s free-fly over varied terrain via the in-page captureStream hook (frame-by-frame review)
// LAWS: bench/ + /tmp writes only. No codified "5 canonical vantages" exists in-repo — (a) uses a
// documented elevated orbit that views the spawn basin from ~220m out, the framing that makes a real
// sky-hole (void/blue through solid ground) unmistakable; grazing-angle coverage = the steep-leg shot.
import { mkdir, writeFile, copyFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { park_camera, fly_camera, get_stats, percentile, capture_frames_during, open_recorded_page } from './_shared.js'

const BUNDLE = '/tmp/aresrpg-engine-artifacts/qa_bundle'
const VIEWPORT = { width: 1280, height: 720 }
const SEED = 'aresrpg'
const DEMO = `http://localhost:5199/demo/?seed=${SEED}&tier=high`

// Two sibling workers edit src/ live, and vite full-reloads the demo when they do — which strands our
// seized camera (window.__cam) on the destroyed context. Retry churned tests, and (below) auto-re-seize
// on EVERY load so control self-recovers after a mid-run reload instead of erroring out.
test.describe.configure({ retries: 3 })

// Runs IN-PAGE on every (re)navigation: once the demo's engine exists, grab the real camera setters onto
// window.__cam and neuter the demo's per-frame push (same effect as _shared.seize_camera, but re-armed
// automatically after a sibling-HMR full reload). Also exposes the surface oracle for the scans.
function auto_seize() {
  const w = /** @type {any} */ (window)
  w.__boot_id ??= Date.now() + ':' + Math.random() // unique per document load → detects mid-run reloads
  const arm = () => {
    const engine = w.__engine
    if (engine && !w.__cam) {
      w.__cam = {
        real_pos: engine.set_camera_position.bind(engine),
        real_orient: engine.set_camera_orientation.bind(engine),
      }
      engine.set_camera_position = () => {}
      engine.set_camera_orientation = () => {}
      import('/src/gen/world_gen.js')
        .then((m) => {
          w.__wsy = m.world_surface_y
        })
        .catch(() => {})
    }
    if (!w.__cam) setTimeout(arm, 60)
  }
  arm()
}

/** yaw/pitch that aims the camera from `pos` at `target` (engine Euler-YXZ convention). */
function look_at(/** @type {number[]} */ pos, /** @type {number[]} */ target) {
  const f = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]
  const l = Math.hypot(f[0], f[1], f[2]) || 1
  return { yaw: Math.atan2(-f[0] / l, -f[2] / l), pitch: Math.asin(Math.max(-1, Math.min(1, f[1] / l))) }
}

/** Boots the demo behind the auto-re-seize init script, then waits for live camera control + oracle. */
async function boot(/** @type {import('@playwright/test').Page} */ page, url = DEMO) {
  await page.setViewportSize(VIEWPORT)
  await page.addInitScript(auto_seize) // re-arms window.__cam + __wsy on the initial load AND every reload
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 25_000 })
  await page.waitForFunction(
    () => Boolean(/** @type {any} */ (window).__cam && /** @type {any} */ (window).__wsy),
    null,
    { timeout: 20_000 }
  )
}

/** Waits for auto-seize to (re)arm camera control after any load/reload. */
function ready(/** @type {import('@playwright/test').Page} */ page) {
  return page.waitForFunction(() => Boolean(/** @type {any} */ (window).__cam), null, { timeout: 10_000 })
}

/**
 * Retries `fn` when a sibling vite full-reload destroys the page's execution context mid-operation
 * (the dominant flake here: any long evaluate dies with "Execution context was destroyed", and a
 * park right after a reload can catch __cam still unarmed). Re-waits for camera control, retries.
 * Genuine failures (assertion errors, closed browser) don't match the pattern and propagate.
 * @template T
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function safe(page, fn) {
  for (let i = 0; ; i += 1) {
    try {
      return await fn()
    } catch (err) {
      if (i >= 4 || !/destroyed|navigation|real_pos|real_orient/i.test(String(err))) throw err
      await ready(page)
    }
  }
}

/**
 * Navigation-proof stream settle: same quiet criteria as _shared.settle_stream (queue ≤1 for 3
 * consecutive polls AND ≥min_ms elapsed) but polled from NODE in short evaluates — a sibling reload
 * can only kill a ~ms poll (retried), never a 12s in-page loop (unretriable mid-flight).
 * @param {import('@playwright/test').Page} page
 * @param {{ min_ms: number, deadline_ms: number }} bounds
 */
async function settle(page, { min_ms, deadline_ms }) {
  const t0 = Date.now()
  let quiet = 0
  while (Date.now() - t0 < deadline_ms) {
    const q = await page
      .evaluate(() => /** @type {any} */ (window).__engine?.get_stats?.().chunk_queue_depth ?? 0)
      .catch(() => null)
    if (q === null) {
      quiet = 0
      await ready(page).catch(() => {})
      await page.waitForTimeout(250)
      continue
    }
    quiet = q <= 1 ? quiet + 1 : 0
    if (quiet >= 3 && Date.now() - t0 >= min_ms) return
    await page.waitForTimeout(120)
  }
}

/** Parks, settles the stream, and writes a 1280×720 canvas still into the bundle. Reload-tolerant. */
function still(
  /** @type {import('@playwright/test').Page} */ page,
  name,
  pos,
  yaw,
  pitch,
  bounds = { min_ms: 1500, deadline_ms: 12_000 }
) {
  return safe(page, async () => {
    await ready(page)
    await park_camera(page, pos, yaw, pitch)
    await settle(page, bounds)
    await park_camera(page, pos, yaw, pitch) // reassert after the settle's frames
    await page.waitForTimeout(400)
    const path = `${BUNDLE}/${name}.png`
    await page.locator('#canvas').screenshot({ path })
    const s = await get_stats(page)
    return {
      name,
      path,
      pos,
      yaw: Number(yaw.toFixed(3)),
      pitch: Number(pitch.toFixed(3)),
      quads: s.quad_count ?? s.quads ?? null,
      xyz: s.camera_position,
    }
  })
}

test.beforeAll(async () => {
  await mkdir(BUNDLE, { recursive: true })
})

// ── (a) ZERO-HOLES ────────────────────────────────────────────────────────────────────────────────
test('qa-a zero-holes stills (spawn sweep + steep leg + mountain w/ trees)', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)
  await page.waitForTimeout(2500) // let the near ring fill before the first park

  /** @type {any[]} */
  const manifest = []

  // 5 canonical vantages: an elevated 360° ORBIT of the spawn basin, each camera ~220m out and above,
  // looking back at spawn center. Viewing terrain from distance (not from inside the near bumps) makes it
  // read as a coherent surface + horizon silhouette — a real sky-hole (void/blue through solid ground)
  // would be unmistakable, while deep-voxel AO crevices stay small. Grazing coverage = the steep leg below.
  const center = /** @type {[number,number,number]} */ ([70, 150, 70])
  const R = 220
  const CAM_Y = 225
  const dirs = ['n', 'ne', 'e', 's', 'w']
  const angles = [Math.PI / 2, Math.PI / 4, 0, -Math.PI / 2, Math.PI]
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]
    const pos = /** @type {[number,number,number]} */ ([
      center[0] + R * Math.cos(a),
      CAM_Y,
      center[2] + R * Math.sin(a),
    ])
    const aim = look_at(pos, center)
    manifest.push(await still(page, `a${i + 1}_orbit_${dirs[i]}`, pos, aim.yaw, aim.pitch))
  }

  // Steep leg (-128,-896): recompute the max ridge height along the local gradient (like _dbg8) and park
  // above it, looking along the steepest descent — the terrace contour that historically leaked sky.
  const steep = await safe(page, () =>
    page.evaluate(
      ({ cx, cz }) => {
        const wsy = /** @type {any} */ (window).__wsy
        const gx = wsy(cx + 8, cz) - wsy(cx - 8, cz)
        const gz = wsy(cx, cz + 8) - wsy(cx, cz - 8)
        const gl = Math.hypot(gx, gz) || 1
        const dx = gx / gl
        const dz = gz / gl
        let max_h = -1
        for (let t = -75; t <= 75; t += 8) {
          const h = wsy(Math.floor(cx + dx * t), Math.floor(cz + dz * t))
          if (h > max_h) max_h = h
        }
        return { max_h, dx, dz }
      },
      { cx: -128, cz: -896 }
    )
  ).catch(() => null)
  if (steep) {
    const pos = [-128, steep.max_h + 12, -896]
    const yaw = Math.atan2(-steep.dx, -steep.dz)
    manifest.push(await still(page, 'a6_steep_leg', pos, yaw, -0.15))
  }

  // Full-height mountain w/ trees: scan a wide lattice for the highest waterless (grassed) surface, then
  // frame it side-on against sky so its whole height + slope trees are in shot.
  const peak = await safe(page, () =>
    page.evaluate(() => {
      const wsy = /** @type {any} */ (window).__wsy
      let best = { x: 0, z: 0, y: -1 }
      for (let x = -1200; x <= 1200; x += 24)
        for (let z = -1200; z <= 1200; z += 24) {
          const y = wsy(x, z)
          if (y > best.y) best = { x, z, y }
        }
      return best
    })
  )
  const cam = [peak.x + 170, peak.y - 10, peak.z + 170]
  const aim = look_at(cam, [peak.x, peak.y - 35, peak.z])
  manifest.push(await still(page, 'a7_mountain_trees', cam, aim.yaw, aim.pitch))
  manifest.push({ note: 'peak', peak })

  await writeFile(`${BUNDLE}/a_zeroholes_manifest.json`, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`[qa-a] ${manifest.length - 1} stills | peak y=${peak.y} @ (${peak.x},${peak.z})`)
})

// ── (b) FAR-SHELL ───────────────────────────────────────────────────────────────────────────────────
test('qa-b far-shell stills (boot series + 500m move + horizon + archipelago)', async ({ page }) => {
  test.setTimeout(240_000)
  const OVERLOOK = /** @type {[number,number,number]} */ ([70, 175, 70])
  const OVERLOOK_YAW = Math.PI / 4
  const OVERLOOK_PITCH = -0.5

  // Boot series: cold boot, park the overlook the instant the engine is live, shoot at 0.5/1/2/5s to
  // prove the far shell paints a gapless (even if coarse) world from the first frames.
  await boot(page)
  const boot_id = await page.evaluate(() => /** @type {any} */ (window).__boot_id)
  const t0 = Date.now()
  await park_camera(page, OVERLOOK, OVERLOOK_YAW, OVERLOOK_PITCH)
  /** @type {any[]} */
  const boot_series = []
  for (const t of [500, 1000, 2000, 5000]) {
    const wait = t - (Date.now() - t0)
    if (wait > 0) await page.waitForTimeout(wait)
    await park_camera(page, OVERLOOK, OVERLOOK_YAW, OVERLOOK_PITCH)
    const path = `${BUNDLE}/b_boot_${t}ms.png`
    await page.locator('#canvas').screenshot({ path })
    const s = await get_stats(page)
    boot_series.push({
      t_ms: t,
      path,
      far_sections: s.far_section_count ?? s.far_sections ?? null,
      quads: s.quad_count ?? null,
    })
  }
  // Integrity: a sibling full-reload during the timed boot series resets t0 → the stills are no longer a
  // clean cold boot. Detect it via the per-load id and fail so the retry re-runs from a fresh boot.
  const boot_id2 = await page.evaluate(() => /** @type {any} */ (window).__boot_id)
  expect(boot_id2, 'sibling reload during boot series — retrying for a clean cold-boot sequence').toBe(boot_id)

  // 500m movement series: fly forward at constant altitude, 5 stills evenly along the traverse.
  await settle(page, { min_ms: 1500, deadline_ms: 12_000 })
  const from = /** @type {[number,number,number]} */ ([70, 180, 70])
  const to = /** @type {[number,number,number]} */ ([
    from[0] - 500 * Math.sin(OVERLOOK_YAW),
    180,
    from[2] - 500 * Math.cos(OVERLOOK_YAW),
  ])
  /** @type {any[]} */
  const move_series = []
  for (let i = 0; i < 5; i++) {
    const f = i / 4
    const pos = /** @type {[number,number,number]} */ ([
      from[0] + (to[0] - from[0]) * f,
      180,
      from[2] + (to[2] - from[2]) * f,
    ])
    const shot = await still(page, `b_move_${Math.round(f * 500)}m`, pos, OVERLOOK_YAW, -0.2)
    move_series.push({ m: Math.round(f * 500), path: shot.path, pos })
  }

  // Horizon vista: high + near-level so the far shell's horizon band fills the top third.
  await still(page, 'b_horizon_vista', [70, 240, 70], OVERLOOK_YAW, -0.05)

  // Sky-island archipelago from GROUND LEVEL: stand ~700m NE of the hero island (1825,321,1422) just
  // above the local surface, sun behind the camera, shallow up-pitch — the islands hang in the sky with
  // sea + horizon below for scale. At 700m they are beyond the 160m near ring, so this still doubles as
  // proof the FAR SHELL renders the archipelago (not just near chunks).
  const HERO = [1825, 321, 1422]
  const gx = 2345
  const gz = 1942
  const ground = await safe(page, () =>
    page.evaluate(({ x, z }) => /** @type {any} */ (window).__wsy(x, z), { x: gx, z: gz })
  )
  const gpos = [gx, Math.max(ground + 8, 140), gz]
  const gaim = look_at(gpos, [HERO[0], HERO[1] - 20, HERO[2]])
  await still(page, 'b_archipelago_ground', gpos, gaim.yaw, gaim.pitch, { min_ms: 2500, deadline_ms: 18_000 })

  await writeFile(
    `${BUNDLE}/b_farshell_manifest.json`,
    JSON.stringify(
      {
        boot_series,
        move_series,
        horizon: `${BUNDLE}/b_horizon_vista.png`,
        archipelago: { path: `${BUNDLE}/b_archipelago_ground.png`, ground_y: ground, cam: gpos, hero: HERO },
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(
    `[qa-b] boot ${boot_series.map((b) => `t${b.t_ms}:far${b.far_sections}`).join(' ')} | archipelago ground_y=${ground}`
  )
})

// ── (c) PERF — standard rotation + fly rAF measurement ──────────────────────────────────────────────
test('qa-c perf p50/p99 (rotate-in-place + 200m fly)', async ({ page }) => {
  test.setTimeout(120_000)
  await boot(page)
  const YAW = Math.PI / 4
  const OVERVIEW = /** @type {[number,number,number]} */ ([70, 150, 70])
  await ready(page)
  await park_camera(page, OVERVIEW, YAW, -0.25)
  await settle(page, { min_ms: 2000, deadline_ms: 15_000 })
  await ready(page)

  // Rotate in place 360° over 6s (parked), capturing rAF deltas.
  const rotate = page.evaluate(
    ({ pos, pitch, dur }) => {
      const cam = /** @type {any} */ (window).__cam
      const start = performance.now()
      return new Promise((resolve) => {
        const step = () => {
          const t = (performance.now() - start) / dur
          cam.real_pos(pos)
          cam.real_orient(Math.PI / 4 + t * Math.PI * 2, pitch)
          if (t < 1) requestAnimationFrame(step)
          else resolve(undefined)
        }
        requestAnimationFrame(step)
      })
    },
    { pos: OVERVIEW, pitch: -0.25, dur: 6000 }
  )
  const rot_frames = await capture_frames_during(page, 6000)
  await rotate

  // Fly forward 200m at constant altitude over 8s, capturing rAF deltas.
  const dest = /** @type {[number,number,number]} */ ([
    OVERVIEW[0] - 200 * Math.sin(YAW),
    150,
    OVERVIEW[2] - 200 * Math.cos(YAW),
  ])
  const fly = fly_camera(page, { from: OVERVIEW, to: dest, yaw: YAW, pitch: -0.25, duration_ms: 8000 })
  const fly_frames = await capture_frames_during(page, 8000)
  await fly

  const all = [...rot_frames.deltas_ms, ...fly_frames.deltas_ms]
  const perf = {
    scenario: 'rotate_in_place_6s + fly_forward_200m_8s',
    viewport: VIEWPORT,
    frames: all.length,
    p50_ms: Number(percentile(all, 50).toFixed(2)),
    p75_ms: Number(percentile(all, 75).toFixed(2)),
    p99_ms: Number(percentile(all, 99).toFixed(2)),
    rotate: {
      frames: rot_frames.deltas_ms.length,
      p50_ms: Number(percentile(rot_frames.deltas_ms, 50).toFixed(2)),
      p99_ms: Number(percentile(rot_frames.deltas_ms, 99).toFixed(2)),
    },
    fly: {
      frames: fly_frames.deltas_ms.length,
      p50_ms: Number(percentile(fly_frames.deltas_ms, 50).toFixed(2)),
      p99_ms: Number(percentile(fly_frames.deltas_ms, 99).toFixed(2)),
    },
    note: 'headed Metal; other GPU tests may contend — see report for concurrency at capture time',
  }
  await writeFile(`${BUNDLE}/c_perf.json`, JSON.stringify(perf, null, 2), 'utf8')
  console.log(`[qa-c] p50 ${perf.p50_ms}ms p75 ${perf.p75_ms}ms p99 ${perf.p99_ms}ms over ${perf.frames} frames`)
})

// ── (d) VIDEO — 60s free-fly (in-page captureStream) ────────────────────────────────────────────────
test('qa-d 60s free-fly video (captureStream hook)', async ({ browser }) => {
  test.setTimeout(180_000)
  const { page, finish } = await open_recorded_page(browser, 'qa_freefly', VIEWPORT)
  try {
    await boot(page)
    await page.waitForTimeout(2000)
    await ready(page)
    // A 60s continuous free-fly over varied terrain: spawn → out over the hills → sweeping turns, all at
    // altitudes that frame terrain + horizon. The path is authored as 6 big legs but DRIVEN as ~2s
    // sub-legs (each its own short in-page rAF evaluate, smooth within itself): a sibling vite reload
    // can only kill one 2s slice — safe() re-arms and the flight resumes at the next slice, so the
    // recording survives churn instead of dying 40s into a single monolithic evaluate.
    const legs = [
      { to: [70, 175, 70], yaw: Math.PI / 4, pitch: -0.35, ms: 3000 },
      { to: [-260, 190, -260], yaw: Math.PI / 4, pitch: -0.2, ms: 12000 },
      { to: [-620, 230, -420], yaw: Math.PI / 4 + 0.9, pitch: -0.12, ms: 12000 },
      { to: [-620, 250, 120], yaw: Math.PI * 1.1, pitch: -0.15, ms: 12000 },
      { to: [-120, 210, 360], yaw: Math.PI * 1.6, pitch: -0.22, ms: 12000 },
      { to: [70, 185, 70], yaw: Math.PI / 4, pitch: -0.4, ms: 9000 },
    ]
    /** @type {{ from: number[], to: number[], y0: number, y1: number, p0: number, p1: number, ms: number }[]} */
    const slices = []
    {
      let from = [70, 200, 70]
      let yaw = Math.PI / 4
      let pitch = -0.35
      for (const leg of legs) {
        const n = Math.max(1, Math.ceil(leg.ms / 2000))
        for (let i = 0; i < n; i += 1) {
          const f0 = i / n
          const f1 = (i + 1) / n
          const lerp3 = (f) => [
            from[0] + (leg.to[0] - from[0]) * f,
            from[1] + (leg.to[1] - from[1]) * f,
            from[2] + (leg.to[2] - from[2]) * f,
          ]
          slices.push({
            from: lerp3(f0),
            to: lerp3(f1),
            y0: yaw + (leg.yaw - yaw) * f0,
            y1: yaw + (leg.yaw - yaw) * f1,
            p0: pitch + (leg.pitch - pitch) * f0,
            p1: pitch + (leg.pitch - pitch) * f1,
            ms: leg.ms / n,
          })
        }
        from = leg.to
        ;({ yaw, pitch } = leg)
      }
    }
    for (const slice of slices) {
      await safe(page, () =>
        page.evaluate(async (s) => {
          const cam = /** @type {any} */ (window).__cam
          const start = performance.now()
          await new Promise((resolve) => {
            const step = () => {
              const t = Math.min(1, (performance.now() - start) / s.ms)
              cam.real_pos([
                s.from[0] + (s.to[0] - s.from[0]) * t,
                s.from[1] + (s.to[1] - s.from[1]) * t,
                s.from[2] + (s.to[2] - s.from[2]) * t,
              ])
              cam.real_orient(s.y0 + (s.y1 - s.y0) * t, s.p0 + (s.p1 - s.p0) * t)
              if (t < 1) requestAnimationFrame(step)
              else resolve(undefined)
            }
            requestAnimationFrame(step)
          })
        }, slice)
      )
    }
    const video_path = await finish('freefly')
    if (video_path) await copyFile(video_path, `${BUNDLE}/d_freefly_60s.webm`).catch(() => {})
    console.log(`[qa-d] video → ${video_path}`)
    expect(video_path, 'freefly video was saved').not.toBe('')
  } finally {
    await finish('freefly')
  }
})
