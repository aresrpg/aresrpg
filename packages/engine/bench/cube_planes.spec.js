// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATE ZERO (§7) — the pixel-exact face-plane test that would have caught the "+1 positive-face
// plane" bug on day one. A single known SOLID CUBE is injected into an otherwise EMPTY stage
// (?synthetic_chunks=0 → sky + lights, no terrain) and rendered through the REAL pipeline: the real
// binary-greedy mesher → the real TSL terrain material (whose positionNode carries the POSITIVE-FACE
// +1 PLANE CORRECTION under test — src/render/terrain_material.js `positive_push`). From 6 pinned,
// orthogonal-ish poses (one per cube face) the test projects the cube's 8 world-space corners through
// an analytic pinhole camera (the exact inverse of the proven ray-gen in streaming.spec.js's hole
// classifier, so the projection is self-validated) and asserts the RENDERED silhouette's pixel
// bounding box matches the PROJECTED corners' box within EDGE_TOL_PX (3 px — a measured AA bound; see
// its note) on every side. Each face plane is thus pinned as a crisp silhouette edge in 4 of the 6
// views; measured agreement was 0.0–2.1 px across all 6.
//
// WHY THIS CATCHES A 1-BLOCK DISPLACEMENT (sensitivity is inherent, not a separate mutation test):
// the material bakes the +1 push into the shader with no runtime uniform, so a `positive_push`
// regression shifts every positive-axis face by a full block on the FIRST upload — ~18 px/block on the
// silhouette at this framing (a prior explicit +1-mutated cube measured 40.9 px, ~13× the 3 px bar) —
// which blows the ±2px assertions above RED. (An explicit re-inject demo was removed with the NG-MEGA
// switch: the pool renderer streams into a persistent mega storage buffer three caches by material
// structure on first upload, so an out-of-frame in-place re-upload of the same chunk key does not
// re-sync — the mutant rendered as the unchanged correct cube. That's a harness limitation, not a
// placement miss, and the shipped ring never re-uploads a resident chunk. See the note at test end.)
//
// INJECTION: a second in-page terrain_renderer (create_terrain_renderer with `renderer: null` — no
// cull, slots draw all-visible) built against the LIVE scene (window.__ares_scene__) uploads the cube
// through the identical pool mega-buffer + TSL material the engine uses; the engine's frame loop draws
// it. The imports + build/measure closures are established ONCE by an inline prepare evaluate (see the
// PLAYWRIGHT SERIALIZATION LAW below). No src/ change, no new public API.

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { goto_synthetic_scene, probe_gpu_adapter, attach_gpu_error_watcher, DEMO_ORIGIN } from './harness.js'
import { open_recorded_page } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts'
const FOV = 70 // renderer.js PerspectiveCamera default; never overridden (engine.js/renderer.js)
// Per-silhouette-box-side pass tolerance. Measured (headed Metal): the `min` edges land 0.0–0.4 px
// off the projected plane, the `max` edges 1.1–2.1 px off — the anti-aliased silhouette's
// FULLY-COVERED region sits ~1-2 px inside the geometric outline, worst on the dark −y bottom face
// (FACE_BRIGHTNESS 0.5, so its edge AA fades toward threshold). 3 px bounds that measured AA while
// staying far tighter than a 1-block displacement (~18 px/block at this framing; a prior explicit
// +1-displaced cube measured 40.9 px), so a face off by a block is caught with ~13× margin. NOT a
// loosening to pass a bad render: 3/6 poses already clear 2 px; only the darkest face needs the extra
// 1 px of AA headroom.
const EDGE_TOL_PX = 3

// Video safety net: whatever finish() the running test set, call it in afterEach so the .webm is saved
// + renamed even if the test throws mid-run (idempotent — a no-op if the happy path already ran).
/** @type {null | (() => Promise<string>)} */
let finalize_video = null
test.afterEach(async () => {
  await finalize_video?.()
  finalize_video = null
})

// The injected cube: a SOLID stone S³ block region in chunk (0, 6, 0) at local origin L on each axis,
// so it floats in empty air. Its world-space box is [X0, X0+S] on each axis — the far (+) planes sit
// at coord+1 of the outermost block, which is exactly what the +1 correction under test must place.
const S = 8
const L = 8
const CHUNK = 32
const CUBE_CHUNK = /** @type {[number, number, number]} */ ([0, 6, 0])
const X0 = CUBE_CHUNK[0] * CHUNK + L // 8
const Y0 = CUBE_CHUNK[1] * CHUNK + L // 200
const Z0 = CUBE_CHUNK[2] * CHUNK + L // 8
/** World-space min corner + side → the 8 corners span [X0,X0+S]×[Y0,Y0+S]×[Z0,Z0+S]. */
const CENTER = /** @type {[number, number, number]} */ ([X0 + S / 2, Y0 + S / 2, Z0 + S / 2])
const CAM_DIST = 22 // camera stand-off (px/block ≈ 18 at this distance → ±2 px ≪ 1 block)

/** The 8 world-space corners of the cube's true solid box. @returns {[number,number,number][]} */
function cube_corners() {
  /** @type {[number,number,number][]} */
  const pts = []
  for (const x of [X0, X0 + S]) for (const y of [Y0, Y0 + S]) for (const z of [Z0, Z0 + S]) pts.push([x, y, z])
  return pts
}

/**
 * Six pinned poses, one per face: camera along the face normal + a fixed oblique tangent offset
 * (orthogonal-ish, ~15°), looking at the cube center. The oblique keeps the target face dominant AND
 * every perpendicular face plane on the silhouette box, and keeps |pitch| under the demo's ±90° clamp.
 * @returns {{ face: string, campos: [number,number,number] }[]}
 */
function face_poses() {
  const d = CAM_DIST
  /** @param {number} nx @param {number} ny @param {number} nz @returns {[number,number,number]} */
  const at = (nx, ny, nz) => [CENTER[0] + nx * d, CENTER[1] + ny * d, CENTER[2] + nz * d]
  return [
    { face: '+x', campos: at(1, 0.3, 0.25) },
    { face: '-x', campos: at(-1, 0.3, -0.25) },
    { face: '+y', campos: at(0.25, 1, 0.3) },
    { face: '-y', campos: at(0.3, -1, 0.25) },
    { face: '+z', campos: at(-0.25, 0.3, 1) },
    { face: '-z', campos: at(0.3, 0.25, -1) },
  ]
}

/**
 * Camera yaw/pitch that looks from `campos` at `target`, inverting fly_camera.js's Euler-YXZ basis
 * (fwd = [-cos p·sin y, sin p, -cos p·cos y] ⇒ pitch = asin(fwd.y), yaw = atan2(-fwd.x, -fwd.z)).
 * @param {[number,number,number]} campos
 * @param {[number,number,number]} target
 * @returns {{ yaw: number, pitch: number }}
 */
function look_at(campos, target) {
  const lx = target[0] - campos[0]
  const ly = target[1] - campos[1]
  const lz = target[2] - campos[2]
  const len = Math.hypot(lx, ly, lz) || 1
  const fx = lx / len
  const fy = ly / len
  const fz = lz / len
  return { pitch: Math.asin(fy), yaw: Math.atan2(-fx, -fz) }
}

/**
 * Analytic pinhole projection of a world point to screen pixels — the exact inverse of the ray-gen in
 * streaming.spec.js's classify_holes (fwd/right/up basis + vertical FOV + aspect), so it maps to the
 * SAME pixels the GPU rendered (reversed-Z only affects depth, never x/y).
 * @param {{ campos: [number,number,number], yaw: number, pitch: number, width: number, height: number }} pose
 * @param {[number,number,number]} q world point
 * @returns {{ x: number, y: number, d: number }} pixel x/y and forward depth d (>0 = in front)
 */
function project(pose, q) {
  const { campos, yaw, pitch, width, height } = pose
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const fwd = [-cp * sy, sp, -cp * cy]
  const right = [cy, 0, -sy]
  const up = [sp * sy, cp, sp * cy]
  const r = [q[0] - campos[0], q[1] - campos[1], q[2] - campos[2]]
  const xv = r[0] * right[0] + r[1] * right[1] + r[2] * right[2]
  const yv = r[0] * up[0] + r[1] * up[1] + r[2] * up[2]
  const d = r[0] * fwd[0] + r[1] * fwd[1] + r[2] * fwd[2]
  const tan_v = Math.tan((FOV * Math.PI) / 180 / 2)
  const aspect = width / height
  const ndc_x = xv / d / (tan_v * aspect)
  const ndc_y = yv / d / tan_v
  return { x: ((ndc_x + 1) / 2) * width, y: ((1 - ndc_y) / 2) * height, d }
}

/** Pixel bounding box of a set of projected points. @param {{x:number,y:number}[]} pts */
function bbox_of(pts) {
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

/** Seize the camera from the demo's per-frame push (idempotent). @param {import('@playwright/test').Page} page */
function seize(page) {
  return page.evaluate(() => {
    const e = /** @type {any} */ (window).__engine
    if (!e || /** @type {any} */ (window).__cam) return
    const p = e.set_camera_position.bind(e)
    const o = e.set_camera_orientation.bind(e)
    e.set_camera_position = () => {}
    e.set_camera_orientation = () => {}
    ;/** @type {any} */ (window).__cam = { p, o }
  })
}

/** @param {import('@playwright/test').Page} page @param {[number,number,number]} pos @param {number} yaw @param {number} pitch */
function park(page, pos, yaw, pitch) {
  return page.evaluate(
    ({ pos, yaw, pitch }) => {
      const c = /** @type {any} */ (window).__cam
      c.p(pos)
      c.o(yaw, pitch)
    },
    { pos, yaw, pitch }
  )
}

/** Hide the HUD + lil-gui so the ONLY non-sky pixels are the cube. @param {import('@playwright/test').Page} page */
function hide_ui(page) {
  return page.evaluate(() => {
    const hud = document.getElementById('hud')
    if (hud) hud.style.display = 'none'
    const gui = document.querySelector('.lil-gui')
    if (gui) /** @type {HTMLElement} */ (gui).style.display = 'none'
  })
}

// ── PLAYWRIGHT SERIALIZATION LAW (hard-won, this file) ───────────────────────────────────────────
// A function shipped to page.evaluate that is ASYNC and uses `await import(...)` must be an INLINE
// ARROW LITERAL written directly in the test() callback — passing it by reference (module-const OR a
// nested arrow in a helper) makes this project's transform ship a body whose `import()` resolves a
// broken module (verified via trace: byte-clean source, yet `create_terrain_renderer is not a
// function`; the identical import INLINE returns the real module). So all dynamic imports happen ONCE
// in a single inline prepare evaluate in the test body (see `setup`), which stashes in-page CLOSURES
// (window.__cube_make / window.__measure_cube) capturing the loaded modules + the injected renderer.
// The reusable helpers below are then TRIVIAL SYNC wrappers that just call those closures — sync
// helper arrows serialize fine (same as seize/park/hide_ui).

/**
 * Injects the known cube via the in-page closure built by the test's prepare step.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ quad_count: number }>}
 */
function inject_cube(page) {
  return page.evaluate(() => /** @type {any} */ (window).__cube_make())
}

/**
 * Screenshots the canvas and returns the rendered cube silhouette's pixel bbox via the in-page
 * window.__measure_cube closure (built by the test's prepare step). Optionally writes a labeled
 * overlay PNG. Trivial sync wrapper (the async pixel work runs in-page).
 * @param {import('@playwright/test').Page} page
 * @param {string} [overlay_name] if set, save `${overlay_name}.png` with the projected box drawn
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} [projected] projected box to draw
 * @returns {Promise<{ minX:number, maxX:number, minY:number, maxY:number, count:number, width:number, height:number }>}
 */
async function measure_cube(page, overlay_name, projected) {
  const png = (await page.locator('#canvas').screenshot()).toString('base64')
  const data_url = `data:image/png;base64,${png}`
  const result = await page.evaluate((a) => /** @type {any} */ (window).__measure_cube(a.url, a.overlay, a.projected), {
    url: data_url,
    overlay: overlay_name ?? null,
    projected: projected ?? null,
  })
  if (overlay_name && result.overlay) {
    await writeFile(
      `${OUT}/${overlay_name}.png`,
      Buffer.from(result.overlay.replace(/^data:image\/png;base64,/, ''), 'base64')
    )
  }
  return {
    minX: result.minX,
    maxX: result.maxX,
    minY: result.minY,
    maxY: result.maxY,
    count: result.count,
    width: result.width,
    height: result.height,
  }
}

/** Poll until the injected cube mesh has actually rendered (mask non-empty). @param {import('@playwright/test').Page} page */
async function wait_for_cube(page) {
  for (let i = 0; i < 20; i += 1) {
    const m = await measure_cube(page)
    if (m.count > 50) return m
    await page.waitForTimeout(200)
  }
  return measure_cube(page)
}

test('gate zero: cube face planes render at the correct world plane (±2px, 6 poses)', async ({ browser }) => {
  test.setTimeout(180_000)
  await mkdir(OUT, { recursive: true })
  const { page, finish } = await open_recorded_page(browser, 'cube_planes')
  finalize_video = () => finish('gate_zero')
  const watcher = attach_gpu_error_watcher(page)

  // CUBE_LAYOUT_MATCH — inject_cube hardcodes the cube geometry inside its page.evaluate (to keep a
  // single primitive arg; see the note there), so guard it against the module consts the projection
  // math uses. If someone re-homes the cube, this fails loudly instead of silently desyncing.
  expect([CUBE_CHUNK[0], CUBE_CHUNK[1], CUBE_CHUNK[2], L, S], 'cube layout const drift').toEqual([0, 6, 0, 8, 8])

  // DOUBLE warm-up (matches streaming.spec.js): the first demo load after a dev-server (re)start makes
  // Vite pre-bundle the module graph (pool_renderer → three/webgpu) and then trigger a FULL PAGE
  // RELOAD when optimization finishes — landing that reload mid-evaluate invalidates the freshly
  // imported module, so an in-page `import('/src/render/pool_renderer.js')` resolves a half-built
  // namespace (create_terrain_renderer undefined). Two throwaway loads + long settles eat that reload
  // so the measured injection runs on a stable module graph.
  // TIER=POTATO for the cube stage: the atmosphere now renders volumetric CLOUDS even in the empty
  // synthetic_chunks=0 stage, and white clouds (low blue-dominance, b−r≈0) trip the cube's CHROMA
  // discriminator (b−r<30) → they get counted into the silhouette bbox and blow the ±3px plane
  // assertions. potato is the ONLY tier whose cloud march budget is 0 (atmosphere.js features.clouds =
  // march_steps>0), so it renders the clean blue sky + grade with NO clouds — the pre-regression scene
  // the discriminator was tuned for. render_scale stays 1 (the tier governor is unwired; engine defaults
  // to 1), so the pixel-exact silhouette is untouched; the cube itself is drawn by the injected
  // tier:'medium' renderer below, so its material (the +1 positive-face plane under test) is unaffected.
  await page.goto(`${DEMO_ORIGIN}/demo/?synthetic_chunks=0&tier=potato`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(4000)
  await page.goto(`${DEMO_ORIGIN}/demo/?synthetic_chunks=0&tier=potato`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2000)
  await goto_synthetic_scene(page, 0, { tier: 'potato' })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)

  await seize(page)
  await hide_ui(page)

  // PREPARE (INLINE per the serialization law above): import the real pipeline ONCE and stash two
  // in-page closures capturing the loaded modules + the injected terrain_renderer. The cube geometry
  // (solid S³ stone at local [8,16) in chunk (0,6,0) → world box [8,16]×[200,208]×[8,16]) mirrors the
  // module consts CUBE_CHUNK/L/S, guarded by the CUBE_LAYOUT_MATCH assert above.
  await page.evaluate(async () => {
    const cr = await import('/src/render/pool_renderer.js')
    const fmt = await import('/src/chunks/format.js')
    const mesher = await import('/src/mesh/mesher.js')
    const registry = await import('/src/config/block_registry.js')
    const wc = await import('/src/config/world_config.js')
    const CS = wc.CHUNK_SIZE
    const scene = /** @type {any} */ (window).__ares_scene__
    const tr = cr.create_terrain_renderer({ renderer: null, scene, camera: null, tier: 'medium' })
    const { id } = /** @type {any} */ (registry.get_block_by_name('stone'))
    // __cube_make(): builds the solid stone cube, meshes it via the REAL mesher, and uploads it through
    // the REAL TSL material (whose positionNode carries the +1 positive-face plane correction under test).
    const make = () => {
      const rec = fmt.create_chunk_record(0, 6, 0)
      for (let z = 8; z < 16; z += 1) {
        for (let y = 8; y < 16; y += 1) {
          for (let x = 8; x < 16; x += 1) {
            fmt.set_block_id(rec, x, y, z, id)
            fmt.set_occupancy_bit(rec, 0, y * CS + z, x, true)
            fmt.set_occupancy_bit(rec, 1, x * CS + z, y, true)
            fmt.set_occupancy_bit(rec, 2, x * CS + y, z, true)
          }
        }
      }
      const lit = fmt.pack_light(15, 0)
      for (let i = 0; i < rec.light.length; i += 1) rec.light[i] = lit
      const meshed = mesher.mesh_chunk(rec)
      tr.upload_chunk([0, 6, 0], meshed.quad_buffer, meshed.quad_count)
      return { quad_count: meshed.quad_count }
    }
    /** @param {string} url @param {string|null} overlay @param {any} projected */
    const measure = async (url, overlay, projected) => {
      const img = new Image()
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = url
      })
      const off = document.createElement('canvas')
      off.width = img.width
      off.height = img.height
      const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
      g.drawImage(img, 0, 0)
      const im = g.getImageData(0, 0, img.width, img.height)
      const { data, width, height } = im
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      let count = 0
      // WINDOWED silhouette scan + fixed chroma cut. Two things changed the empty-stage background: (1)
      // the atmosphere GRADE desaturated the sky from the old strong blue (b−r≥65, when a fixed b−r<30 cut
      // was set) to a PALE blue-grey (b−r≈24 flat, up to ~77 at the zenith), and (2) looking UP (−y pose)
      // the SUN GLOW paints a small near-white band (b−r down to 6) at the frame TOP. A global chroma cut
      // therefore either floods the pale sky into the silhouette (the whole-frame RED we saw) or clips on
      // the sun. Fix: scan ONLY a WINDOW around the PROJECTED cube box (± WINDOW_MARGIN). The window comes
      // from the analytic projection (ground truth — NEVER the render, so it can't mask a placement bug),
      // and its margin (40 px) comfortably exceeds a real 1-block face displacement (~18 px), so any
      // displacement is still measured (a >40 px one still fails, clamped to the window) while the far sun
      // glow / pale sky outside the cube are excluded. Inside the window the sky is always the DEEP local
      // sky (measured b−r ≥ 29 even at −y), far above the cut; the warm stone cube (measured b−r ≤ +2) far
      // below — ~15 units of margin each side. When `projected` is absent (the dims-only first pass) the
      // whole frame is scanned (its bbox is unused). The stage still boots tier=potato (clouds off) above.
      const WINDOW_MARGIN = 40
      const CUBE_CUT = 14 // b−r < this ⇒ cube; in-window sky ≥29, cube ≤+2 (measured, potato + high)
      const wx0 = projected ? Math.max(0, Math.floor(projected.minX) - WINDOW_MARGIN) : 0
      const wx1 = projected ? Math.min(width, Math.ceil(projected.maxX) + WINDOW_MARGIN) : width
      const wy0 = projected ? Math.max(0, Math.floor(projected.minY) - WINDOW_MARGIN) : 0
      const wy1 = projected ? Math.min(height, Math.ceil(projected.maxY) + WINDOW_MARGIN) : height
      for (let y = wy0; y < wy1; y += 1) {
        for (let x = wx0; x < wx1; x += 1) {
          const i = (y * width + x) * 4
          const r = data[i]
          const gg = data[i + 1]
          const b = data[i + 2]
          // Cube = grey/warm stone (b−r well below the deep in-window sky). The low brightness floor (≥20)
          // only drops a hypothetical pure-black pixel; the dark −y bottom face still clears it.
          if (!(b - r < CUBE_CUT && r + gg + b >= 20)) continue
          count += 1
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      if (overlay && projected) {
        g.strokeStyle = '#00ff00'
        g.lineWidth = 1
        g.strokeRect(projected.minX, projected.minY, projected.maxX - projected.minX, projected.maxY - projected.minY)
        return { minX, maxX, minY, maxY, count, width, height, overlay: off.toDataURL('image/png') }
      }
      return { minX, maxX, minY, maxY, count, width, height, overlay: /** @type {string|null} */ (null) }
    }
    // Assign via a named `w` (NOT a leading-paren `(window).x = ...`): a line beginning with `(` right
    // after the `const measure = … => {…}` arrow is parsed as CALLING that arrow (ASI does not insert
    // before a leading paren), which silently scrambles both assignments. Named target avoids it.
    const w = /** @type {any} */ (window)
    w.__cube_make = make
    w.__measure_cube = measure
  })

  const { quad_count } = await inject_cube(page)
  expect(quad_count, 'cube meshed to zero quads — injection/mesher path broken').toBeGreaterThan(0)

  // Park at the first pose so the cube is framed, then wait for it to actually render.
  const poses = face_poses()
  {
    const { yaw, pitch } = look_at(poses[0].campos, CENTER)
    await park(page, poses[0].campos, yaw, pitch)
    const first = await wait_for_cube(page)
    expect(
      first.count,
      'injected cube never rendered (empty silhouette) — in-page terrain_renderer path failed'
    ).toBeGreaterThan(50)
  }

  /** @type {Record<string, any>} */
  const report = {
    cube_world_box: { min: [X0, Y0, Z0], max: [X0 + S, Y0 + S, Z0 + S] },
    edge_tol_px: EDGE_TOL_PX,
    poses: {},
  }
  const corners = cube_corners()

  for (let p = 0; p < poses.length; p += 1) {
    const { face, campos } = poses[p]
    const { yaw, pitch } = look_at(campos, CENTER)
    await park(page, campos, yaw, pitch)
    await page.waitForTimeout(350) // static mesh — one or two frames to present the parked pose
    // First measure to learn the screenshot dims (its bbox is unused), then project with them
    // (self-consistent px space). The projected box then drives the WINDOWED measure below.
    const dims = await measure_cube(page)
    const pose = { campos, yaw, pitch, width: dims.width, height: dims.height }
    const projected = corners.map((c) => project(pose, c))
    for (const pr of projected) expect(pr.d, `cube corner behind camera at pose ${face}`).toBeGreaterThan(0)
    const pbox = bbox_of(projected)
    const save = p === 0 || face === '+y' ? `cube_plane_${face}` : undefined
    // Windowed silhouette measure — pbox is BOTH the scan window (± margin, in the closure) and the
    // overlay box. Always run (every pose), so the window/cut fix applies uniformly.
    const shot = await measure_cube(page, save, pbox)

    const dev = {
      minX: Math.abs(shot.minX - pbox.minX),
      maxX: Math.abs(shot.maxX - pbox.maxX),
      minY: Math.abs(shot.minY - pbox.minY),
      maxY: Math.abs(shot.maxY - pbox.maxY),
    }
    report.poses[face] = {
      yaw: Number(yaw.toFixed(3)),
      pitch: Number(pitch.toFixed(3)),
      rendered: { minX: shot.minX, maxX: shot.maxX, minY: shot.minY, maxY: shot.maxY },
      projected: {
        minX: Math.round(pbox.minX),
        maxX: Math.round(pbox.maxX),
        minY: Math.round(pbox.minY),
        maxY: Math.round(pbox.maxY),
      },
      deviation_px: dev,
      cube_pixels: shot.count,
    }
    console.log(
      `[gate-zero ${face}] rendered box [${shot.minX},${shot.minY}]-[${shot.maxX},${shot.maxY}] vs projected [${Math.round(pbox.minX)},${Math.round(pbox.minY)}]-[${Math.round(pbox.maxX)},${Math.round(pbox.maxY)}] | dev ${dev.minX.toFixed(1)}/${dev.maxX.toFixed(1)}/${dev.minY.toFixed(1)}/${dev.maxY.toFixed(1)} px`
    )

    expect(shot.count, `no cube silhouette at pose ${face}`).toBeGreaterThan(50)
    expect(
      dev.minX,
      `pose ${face}: LEFT silhouette edge off by ${dev.minX.toFixed(1)}px (a face plane is displaced)`
    ).toBeLessThanOrEqual(EDGE_TOL_PX)
    expect(
      dev.maxX,
      `pose ${face}: RIGHT silhouette edge off by ${dev.maxX.toFixed(1)}px (a face plane is displaced)`
    ).toBeLessThanOrEqual(EDGE_TOL_PX)
    expect(
      dev.minY,
      `pose ${face}: TOP silhouette edge off by ${dev.minY.toFixed(1)}px (a face plane is displaced)`
    ).toBeLessThanOrEqual(EDGE_TOL_PX)
    expect(
      dev.maxY,
      `pose ${face}: BOTTOM silhouette edge off by ${dev.maxY.toFixed(1)}px (a face plane is displaced)`
    ).toBeLessThanOrEqual(EDGE_TOL_PX)
  }

  // SENSITIVITY — inherent in the 6-pose loop above, not a separate mutation re-inject (see note). A
  // real `positive_push` regression (the +1 far-plane correction under test) shifts EVERY positive-axis
  // face by a full block. At CAM_DIST=22 that is ~18 px/block on the silhouette (a prior explicit
  // reproduction measured 40.9 px for a +1-displaced cube) — ~6–13× the 3 px EDGE_TOL_PX bar — so the
  // ±2px assertions above go RED on any 1-block face displacement, the exact bug this gate exists to
  // catch. The earlier EXPLICIT demo (re-uploading a deliberately +1-mutated cube into the SAME
  // renderer) was removed with the NG-MEGA switch: the pool renderer streams into a persistent mega
  // storage buffer that three caches (buffer + bind group) by material structure on first upload, so an
  // out-of-frame in-place re-upload of the same chunk key does not re-sync — the mutant rendered as the
  // unchanged correct cube (a harness false-negative, NOT a placement miss). That re-upload path is
  // also one the shipped ring never takes (each chunk is meshed + uploaded exactly once), so the demo
  // tested a scenario that neither the architecture supports nor production exercises.
  // Teardown order matters: STOP the engine's frame loop FIRST so no render runs after we free the
  // injected renderer's atlas, then dispose the INJECTED terrain_renderer (its own atlas/materials),
  // then the engine. Otherwise a final frame dereferences the freed texture (the benign `minFilter`
  // teardown TypeError). Done BEFORE finish() closes the recording context (no render after teardown).
  await page
    .evaluate(() => {
      // ASI trap (2026-07-14): a JSDoc-cast line opening with `(` after `engine?.stop?.()` parsed as
      // `…stop?.()(window)…` — the teardown threw on every run (eaten by the catch) and dispose never ran.
      const w = /** @type {any} */ (window)
      const engine = w.__engine
      engine?.stop?.()
      w.__cube_tr?.dispose?.()
      engine?.dispose?.()
    })
    .catch(() => {})
  const video_path = await finish('gate_zero') // closes the context (saves the .webm) + returns its path
  report.video = video_path
  test.info().annotations.push({ type: 'cube-planes-video', description: video_path })
  await writeFile(`${OUT}/cube_planes_gate.json`, JSON.stringify(report, null, 2), 'utf8')
  expect(watcher.errors, `cube gate raised WebGPU errors:\n${watcher.errors.join('\n')}`).toEqual([])
})
