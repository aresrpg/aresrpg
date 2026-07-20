// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared bench primitives — the camera-pin protocol, stream settle, and the voxel-true HOLE
// CLASSIFIER, extracted from the old 876-line streaming.spec.js so both split gates
// (streaming.spec.js perf + holes_flight.spec.js) stay under the 600-LoC law and share ONE copy
// of the pin/classify logic. Pure helpers; no test() here. Consumed by bench/*.spec.js.

import { mkdir, writeFile } from 'node:fs/promises'

import { test } from '@playwright/test'

// ── ENG-6 VIDEO HOOK (in-page captureStream — direct WebGPU-canvas capture) ───────────────────────
// The whole point of a bench is watching the render; a .webm of every gate is the reviewer's eyes.
// Playwright's `recordVideo` records the COMPOSITOR, which is fragile on the headed-Metal WebGPU path
// (the same class as the known >720p screenshot-readback black: the browser compositor does not always
// composite the WebGPU swapchain into the captured surface). We instead tap the canvas DIRECTLY:
// `canvas.captureStream(fps)` → `MediaRecorder` (vp9/vp8 webm), armed IN-PAGE, chunks collected in the
// page. This records exactly the pixels the GPU presented — immune to compositor quirks and NOT capped
// at 720p — verified live to yield non-black frames of the streamed terrain (bench/_capprobe proof).
// A recorded spec opts in with the SAME one-liner as before: take `{ browser }` instead of `{ page }`
// and call `const { page, finish } = await open_recorded_page(browser, 'streaming')` at the top, then
// `await finish('<test>')` at the end — which stops the recorder, pulls the webm to disk as
// `<spec>_<test>_<timestamp>.webm`, logs the path, and returns it for the gate JSON.
export const VIDEO_DIR = '/tmp/aresrpg-engine-artifacts/videos'
export const MEASUREMENT_VIEWPORT = { width: 1280, height: 720 } // Desktop Chrome default (no config override)

// Runs IN-PAGE on every navigation (added via context.addInitScript). Self-arms a MediaRecorder on the
// #canvas capture stream the instant the canvas has a backing size, so a warm-up→real re-navigation
// records the FINAL (measured) document. Must be fully self-contained (no closure refs) — Playwright
// serializes it with .toString() and re-injects it before every document's own scripts.
function install_recorder(/** @type {{ fps: number, bitrate: number }} */ opts) {
  const w = /** @type {any} */ (window)
  if (w.__cap) return
  const cap = /** @type {any} */ ({ chunks: [], recorder: null, mime: '', started: false, error: null, blob: null })
  w.__cap = cap
  const arm = () => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('canvas'))
    if (!canvas || !canvas.width || !canvas.height) {
      setTimeout(arm, 100) // canvas not sized yet (pre-boot) — poll until the renderer configures it
      return
    }
    try {
      const stream = canvas.captureStream(opts.fps)
      const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.bitrate })
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) cap.chunks.push(e.data)
      }
      rec.onerror = /** @type {any} */ (
        (e) => {
          cap.error = String(e?.error || e)
        }
      )
      rec.start(200) // periodic 200ms chunks: a crash still leaves a partial, and stop() flushes fast
      cap.recorder = rec
      cap.mime = mime
      cap.started = true
    } catch (err) {
      cap.error = String(err) // captureStream/MediaRecorder unsupported — finish() degrades quietly
    }
  }
  arm()
}

/**
 * Opens a fresh page on a NEW browser context whose #canvas is recorded in-page (captureStream +
 * MediaRecorder) to VIDEO_DIR/<spec>/ at the measurement viewport. Returns the page plus a
 * `finish(test_name)` that stops the recorder, pulls the assembled webm to disk as
 * <spec>_<test>_<timestamp>.webm (base64-sliced over CDP so any size streams safely), closes the
 * context, logs + resolves the path. If the recorder never armed (no WebGPU/canvas, unsupported)
 * finish() degrades to '' — it never fails a green gate on video. One-line opt-in for any spec:
 * swap the `{ page }` fixture for `{ browser }` and call this.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} spec spec basename (e.g. 'streaming') — names the video subdir + filename prefix
 * @param {{ width: number, height: number }} [viewport] recorded size (default = MEASUREMENT_VIEWPORT)
 * @returns {Promise<{ page: import('@playwright/test').Page, finish: (test_name: string) => Promise<string> }>}
 */
export async function open_recorded_page(browser, spec, viewport = MEASUREMENT_VIEWPORT) {
  const dir = `${VIDEO_DIR}/${spec}`
  await mkdir(dir, { recursive: true })
  const context = await browser.newContext({ viewport })
  await context.addInitScript(install_recorder, { fps: 30, bitrate: 8_000_000 })
  const page = await context.newPage()
  let finished = false // guards the happy-path call + a `finally` re-call from running twice
  let saved = ''
  return {
    page,
    /**
     * Stops the in-page recorder, assembles the .webm, writes it to disk as
     * <spec>_<test>_<timestamp>.webm, closes the context, and returns the path (or '' if no video was
     * recorded). Idempotent: call it in the happy path for the return value AND in a `finally` so a
     * mid-test failure still keeps whatever was recorded.
     * @param {string} test_name
     * @returns {Promise<string>}
     */
    async finish(test_name) {
      if (finished) return saved
      finished = true
      // Stop the recorder + assemble the blob in-page (returns its byte size). Degrade quietly on any
      // fault — a missing video must never turn a green gate red.
      const info = await page
        .evaluate(
          () =>
            new Promise((resolve) => {
              const cap = /** @type {any} */ (window).__cap
              if (!cap || !cap.recorder) {
                resolve({ ok: false, size: 0, error: cap?.error || 'no recorder armed' })
                return
              }
              const rec = cap.recorder
              const assemble = () => {
                cap.blob = new Blob(cap.chunks, { type: cap.mime })
                resolve({ ok: cap.blob.size > 0, size: cap.blob.size, mime: cap.mime, error: cap.error })
              }
              if (rec.state === 'inactive') assemble()
              else {
                rec.onstop = assemble
                rec.stop()
              }
            })
        )
        .catch((err) => ({ ok: false, size: 0, error: String(err) }))

      const meta = /** @type {any} */ (info)
      if (meta.ok && meta.size > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const dest = `${dir}/${spec}_${test_name}_${stamp}.webm`
        const SLICE = 4 * 1024 * 1024
        /** @type {Buffer[]} */
        const parts = []
        for (let off = 0; off < meta.size; off += SLICE) {
          const b64 = await page
            .evaluate(
              async ({ off, len }) => {
                const cap = /** @type {any} */ (window).__cap
                const buf = await cap.blob.slice(off, off + len).arrayBuffer()
                const bytes = new Uint8Array(buf)
                let bin = ''
                const CH = 0x8000 // chunked fromCharCode: avoids the apply() arg-count stack limit
                for (let i = 0; i < bytes.length; i += CH)
                  bin += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CH)))
                return btoa(bin)
              },
              { off, len: SLICE }
            )
            .catch(() => '')
          if (b64) parts.push(Buffer.from(b64, 'base64'))
        }
        const webm = Buffer.concat(parts)
        await writeFile(dest, webm).catch(() => {})
        saved = dest
        console.log(`[video] ${spec}/${test_name} → ${dest} (${webm.length} B, captureStream ${meta.mime})`)
      } else {
        console.log(`[video] ${spec}/${test_name} → NOT SAVED (${meta.error})`)
      }
      await context.close().catch(() => {})
      return saved
    },
  }
}

// ── HOLE CLASSIFIER CONSTANTS ─────────────────────────────────────────────────────────────────
// "READS AS SKY" = BLUE-DOMINANT. The defect renders sky/water-blue where solid earth should be —
// a cyan-ambient riser measures ~(150,170,186): blue clearly the top channel. Earthy terrain is the
// opposite (warm sand r≈g>b, grass green g>>b). Channel dominance is categorical and lighting-robust:
// a correctly shaded warm/green riser can never trip it, a cyan one always does.
export const HOLE_BLUE_OVER_RED = 12 // blue must exceed red by ≥ this (sky/water blue vs warm earth)
export const HOLE_BLUE_OVER_GREEN = 6 // ...and exceed green by ≥ this (vs grass green, which is g-dominant)
export const HOLE_MIN_BRIGHTNESS = 90 // ignore near-black shaded pixels (a dark riser is shade, not a hole)
// Silhouette AA guard: ignore the first rows just under a column's horizon (anti-aliased edge blend
// reads sky-ish for ~1-2 px). A real hole is a BAND many rows tall well inside the silhouette.
export const HOLE_HORIZON_MARGIN_PX = 4
// Voxel raymarch bounds (the water + fog mask — see classify_holes stage 2).
export const HOLE_RAY_MAX_M = 400
export const HOLE_RAY_STEP_M = 0.75
// FRONTAL-HIT GUARD (stage 2). A near-solid ray hit counts as a HOLE only if the ray strikes the hit
// voxel's surface with incidence |ray·n| ≥ this — the face is turned toward the camera and would
// render as a full earth-colored pixel, so a blue pixel there is a genuine "terrain reads as sky"
// defect. GRAZING hits (< this) are where the ray skims a steep flank / terrace lip near-parallel to
// its face: the RASTERIZED pixel legitimately shows the fogged valley past the sub-pixel edge while
// the mathematical ray dips a few cm into the near voxel. Measured (headed Metal): every steep-leg
// false hole sat at incidence <0.3, real frontal risers/gaps >0.6, so 0.4 cleanly separates them.
export const HOLE_MIN_FRONTAL = 0.4

// ── PER-RAY FOG WEIGHTING (NG1-B v3 canyon fix, option (a) — the honest physics) ────────────────
// v3's canyon relief (floor ~132 / rim ~216 / peaks ~268) means a single frame spans hit distances
// from a near rim (~20 m) to a far wall across the notch (~300 m). The OLD classifier masked haze
// with ONE global distance cutoff (fog.near×0.9) compared against the EUCLIDEAN ray length — but the
// renderer fogs by a SMOOTHSTEP curve on VIEW-Z depth. Those two notions of "fogged" diverge on steep
// relief: as the camera approached a canyon wall, the far-fog pixels' euclidean length crossed the
// cutoff and the WHOLE fogged population flipped fog→hole at once (measured leg2: 18442 phantom holes
// in one frame, fog_masked→0). The cure is to weight each ray by the fog factor the renderer ACTUALLY
// applied — same curve, same depth basis — so "how blue the pixel is" and "how much fog we expect"
// track together at every distance and the cliff disappears.
//
// Renderer ground truth (src/core/renderer.js + three FogRangeNode): THREE.Fog (linear) →
//   fogFactor = smoothstep(fog.near, fog.far, viewZ),  viewZ = −positionView.z (perpendicular depth),
//   rendered.rgb = mix(terrain.rgb, FOG_COLOR, fogFactor).
// FOG_COLOR authored 0x87a8c8 = (135,168,200), but the frame is AgX-tonemapped (exposure 1.1) before
// the sRGB framebuffer, which desaturates it: the DISPLAYED fully-fogged color measured off the v3
// canyon frames (low pose, HOLE_PITCH −0.15) is (150,170,186) — blue-dominance b−r=36, b−g=16 (the
// authored hex would read 65/32; using it would mask ~2× too much). These are the displayed fog
// chroma the per-ray test compares against; they track FOG_COLOR-after-tonemap and are re-measured by
// the gate's protocol on a world/look-dev fork (holes_flight_gate.json records them each run).
export const FOG_DR_DISPLAY = 36 // displayed (post-AgX) fog blue-over-red at full fog
export const FOG_DG_DISPLAY = 16 // displayed (post-AgX) fog blue-over-green at full fog
// Chroma slack on the per-ray fog test: a blue candidate at hit depth d (fog factor f) is legit fog
// when its blue-dominance ≤ FOG_D*×f + this. Measured: mid-fog displayed chroma tracks FOG_D*×f within
// ~±10 units (AgX midtone wobble + silhouette AA), so 12 masks legit haze with headroom while leaving
// a cyan riser (b−r 36 at f≈0) and a true sky-hole (b−r 45) flagged with 24–33 units to spare. Not a
// per-frame pixel budget (that is HOLE_AA_EPSILON in holes_flight.spec.js) — this is the per-PIXEL
// "is this blue explainable by fog" threshold.
export const HOLE_FOG_CHROMA_EPS = 12

// ── FROXEL NEAR-HAZE VEIL (NG2-ATMO) — the SECOND veil the per-ray fog test must allow ──────────────
// With the far shell live, THREE.Fog's FAR was pushed out to the far-shell radius (~4096 m), so its
// smoothstep(near=200, far=4096) factor is ≈0 across the whole near-mid band — yet the FROXEL fog
// (atmosphere.js) still paints a blue-white veil there. near_haze is a WINDOWED extinction (1/m): ramps
// in over [near_start, near_full] (foreground stays crisp), holds, then fades out over [near_fade_start,
// near_fade_end]. Modelling ONLY THREE.Fog therefore under-allows the veil and flags hazed near-mid
// terrain as false holes (the post-far-shell regression). The classifier adds the froxel veil
// 1−exp(−τ(viewZ)), τ = near_haze × the windowed path length to viewZ, and COMBINES it with THREE.Fog.
// Values MIRROR src/render/atmosphere.js ATMO_CONFIG.froxel (the gate boots the default clear-day
// config — engine.js passes no override); the veil chroma reuses FOG_D*_DISPLAY (the froxel inscatter is
// the same blue-white as THREE.Fog after AgX). Kept as mirrored constants (not an import) so the
// classifier stays free of the three-heavy atmosphere module; the gate JSON records them each run.
export const FROXEL_NEAR_HAZE = 0.0012 // 1/m (ATMO_CONFIG.froxel.near_haze)
export const FROXEL_NEAR_START_M = 30
export const FROXEL_NEAR_FULL_M = 80
export const FROXEL_NEAR_FADE_START_M = 160
export const FROXEL_NEAR_FADE_END_M = 300

/**
 * Reads the engine's current stat snapshot from the page.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Record<string, any>>}
 */
export function get_stats(page) {
  return page.evaluate(() => /** @type {any} */ (window).__engine?.get_stats?.() ?? {})
}

/**
 * Wrests camera control from the demo's per-frame push: captures the engine's real setters, then
 * overrides the public `set_camera_position`/`set_camera_orientation` so the demo's rAF loop becomes
 * a no-op, and stashes the originals on `window.__cam` for the spec to drive directly. Idempotent.
 * After this, only the spec moves the camera — so altitude/pitch stay exactly where we put them.
 * @param {import('@playwright/test').Page} page
 */
export function seize_camera(page) {
  return page.evaluate(() => {
    const engine = /** @type {any} */ (window).__engine
    if (!engine || /** @type {any} */ (window).__cam) return
    const real_pos = engine.set_camera_position.bind(engine)
    const real_orient = engine.set_camera_orientation.bind(engine)
    engine.set_camera_position = () => {} // demo's per-frame push → inert
    engine.set_camera_orientation = () => {}
    ;/** @type {any} */ (window).__cam = { real_pos, real_orient }
  })
}

/**
 * Drives the camera directly (bypassing the neutralized demo): sets yaw/pitch once, then linearly
 * flies from `from` to `to` over `duration_ms` via a self-perpetuating rAF loop, pushing the REAL
 * setter each frame so y stays EXACTLY fixed. Resolves when the flight completes.
 * @param {import('@playwright/test').Page} page
 * @param {{ from: [number,number,number], to: [number,number,number], yaw: number, pitch: number, duration_ms: number }} plan
 */
export function fly_camera(page, plan) {
  return page.evaluate(({ from, to, yaw, pitch, duration_ms }) => {
    const cam = /** @type {any} */ (window).__cam
    cam.real_orient(yaw, pitch)
    return new Promise((resolve) => {
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / duration_ms)
        cam.real_pos([
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ])
        if (t < 1) requestAnimationFrame(step)
        else resolve(undefined)
      }
      requestAnimationFrame(step)
    })
  }, plan)
}

/**
 * Parks the camera at a fixed pose (real setter), holding it there against the (neutralized) demo.
 * @param {import('@playwright/test').Page} page
 * @param {[number,number,number]} position
 * @param {number} yaw
 * @param {number} pitch
 */
export function park_camera(page, position, yaw, pitch) {
  return page.evaluate(
    ({ position, yaw, pitch }) => {
      const cam = /** @type {any} */ (window).__cam
      cam.real_pos(position)
      cam.real_orient(yaw, pitch)
    },
    { position, yaw, pitch }
  )
}

/**
 * Waits for the streaming ring to reach a fully-uploaded quiet state at the CURRENT camera pose.
 * Robust against the post-park race that produced the prior build's phantom "holes": the ring runs
 * its update() on the engine's rAF, so for a frame or two after a park `chunk_queue_depth` still
 * reflects the PREVIOUS pose — a bare `queue<=1` check exits BEFORE the new near chunks are even
 * enqueued, and the frame is then classified with its foreground still air (which the voxel oracle
 * correctly, but uselessly, calls a hole). We require BOTH a minimum elapsed time (`min_ms` — the
 * ring has certainly picked up the move and enqueued) AND the queue quiet (≤1) for 3 consecutive
 * polls. Bounded by `deadline_ms` so a genuinely stuck stream can't hang the gate.
 * @param {import('@playwright/test').Page} page
 * @param {{ min_ms: number, deadline_ms: number }} bounds
 */
export function settle_stream(page, { min_ms, deadline_ms }) {
  return page.evaluate(
    async ({ min_ms, deadline_ms }) => {
      const engine = /** @type {any} */ (window).__engine
      const t0 = performance.now()
      const deadline = t0 + deadline_ms
      let quiet = 0
      while (performance.now() < deadline) {
        const q = engine?.get_stats?.().chunk_queue_depth ?? 0
        quiet = q <= 1 ? quiet + 1 : 0
        if (quiet >= 3 && performance.now() - t0 >= min_ms) break
        await new Promise((r) => setTimeout(r, 120))
      }
    },
    { min_ms, deadline_ms }
  )
}

/**
 * Screenshots the canvas and classifies hole pixels in-page. Stage 1 (pixels): per sampled column,
 * find the terrain horizon, then collect BLUE-DOMINANT candidates below it (terrain above, past the
 * AA margin). Stage 2 (world — the WATER + PER-RAY FOG mask): for each candidate, cast the camera ray
 * through that pixel and march the ACTUAL GENERATED VOXELS (voxel-true oracle, see the import note):
 *   • first hit is a LIQUID voxel ⇒ legitimate water → masked;
 *   • first SOLID hit: compute the fog factor the renderer applied to it —
 *       f = smoothstep(fog.near, fog.far, viewZ),  viewZ = ray_t·(ray·forward) = −positionView.z —
 *     and mask as FOG iff the pixel's blue-dominance is within what fog-at-this-depth can paint on
 *     neutral terrain (b−r ≤ FOG_DR×f + eps AND b−g ≤ FOG_DG×f + eps). This is the honest physics: a
 *     far wall hazed to sky-blue passes (high f, high allowance); a NEAR frontal riser rendered
 *     sky-blue (low f, allowance ≈ eps) fails, because fog cannot explain that much blue that close.
 *   • otherwise the near solid is a GENUINE HOLE if the ray strikes it frontally (incidence ≥
 *     min_frontal), else a grazing sub-pixel skim (masked as graze — the rasterizer legitimately
 *     shows the fogged background there);
 *   • air (incl. V2/V3 overhang notches) and cross-foliage billboards are passed through — the pixel's
 *     blue belongs to whatever is genuinely visible behind them.
 * Ray basis mirrors core/fly_camera.js's Euler YXZ convention exactly. `paint` (optional) overwrites
 * a screen rect with a flat color BEFORE classification — the mutation-proof probe injects a
 * transparent-chunk "hole" (sky over known near-solid terrain) to prove the gate still fires.
 * @param {import('@playwright/test').Page} page
 * @param {{ bor: number, bog: number, minB: number, horizon_margin: number, fog_dr: number, fog_dg: number, chroma_eps: number, froxel_haze: number, froxel_start: number, froxel_full: number, froxel_fade_start: number, froxel_fade_end: number, near_ring_m?: number, ray_max: number, ray_step: number, min_frontal: number }} cfg
 * @param {{ position: [number, number, number], yaw: number, pitch: number, fov: number }} pose
 * @param {{ x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number } | null} [paint]
 * @returns {Promise<{ holes: number, water_masked: number, fog_masked: number, graze_masked: number, candidates: number, sky: {r:number,g:number,b:number} }>}
 */
export async function classify_holes(page, cfg, pose, paint = null) {
  // The demo's lil-gui panel (top-right — a cyan slider + accents) and the #hud (top-left) are DOM
  // overlays captured by the #canvas element screenshot, but they are NOT part of the rendered frame.
  // Their cyan/blue chrome fell inside the x∈[0.28,0.98] scan window and scored as a ~73-px constant
  // floor of false "sky-holes". Hide them (visibility only — layout/engine untouched) before the
  // readback so the classifier sees the RENDER, not the UI chrome. Idempotent; harmless to the mutation
  // paint (which stamps the centre band, clear of both).
  await page.evaluate(() => {
    for (const sel of ['.lil-gui', '#hud'])
      for (const el of document.querySelectorAll(sel)) /** @type {HTMLElement} */ (el).style.visibility = 'hidden'
  })
  const data_url = `data:image/png;base64,${(await page.locator('#canvas').screenshot()).toString('base64')}`
  return page.evaluate(
    async ({ url, cfg, pose, paint }) => {
      // VOXEL-TRUE world oracle, served by the same dev server. The heightfield is NOT enough: the
      // density terrain has real OVERHANGS — see-through gaps that legitimately show hazy background,
      // which a heightfield march mislabels as "near land rendered as sky". So the ray marches the
      // ACTUAL generated voxels (generate_world_chunk, cached per chunk across frames — deterministic,
      // same data the renderer drew) and classifies hits by registry class: liquid → water; solid →
      // per-ray fog test; air + cross foliage → pass through.
      const { generate_world_chunk } = await import('/src/gen/world_gen.js')
      const { BLOCK_REGISTRY } = await import('/src/config/block_registry.js')
      const { CHUNK_SIZE, WORLD_HEIGHT } = await import('/src/config/world_config.js')
      /** @type {Map<number, string>} */
      const class_of = new Map(BLOCK_REGISTRY.map((b) => [b.id, b.class]))
      const chunk_cache = /** @type {any} */ (window.__gate_chunks ??= new Map())
      const block_at = (wx, wy, wz) => {
        if (wy < 0 || wy >= WORLD_HEIGHT) return 0
        const ccx = Math.floor(wx / CHUNK_SIZE)
        const ccy = Math.floor(wy / CHUNK_SIZE)
        const ccz = Math.floor(wz / CHUNK_SIZE)
        const key = `${ccx},${ccy},${ccz}`
        let ch = chunk_cache.get(key)
        if (!ch) {
          if (chunk_cache.size > 400) chunk_cache.clear() // bound in-page memory across legs
          ch = generate_world_chunk(ccx, ccy, ccz)
          chunk_cache.set(key, ch)
        }
        const lx = wx - ccx * CHUNK_SIZE
        const ly = wy - ccy * CHUNK_SIZE
        const lz = wz - ccz * CHUNK_SIZE
        return ch.ids[(ly * CHUNK_SIZE + lz) * CHUNK_SIZE + lx]
      }

      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = url
      })
      const off = document.createElement('canvas')
      off.width = img.width
      off.height = img.height
      const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
      g.drawImage(img, 0, 0)
      const image = g.getImageData(0, 0, img.width, img.height)
      const { data } = image
      const { width, height } = image
      const idx = (x, y) => (y * width + x) * 4

      // MUTATION-PROOF probe: stamp a flat rect (e.g. sky over near-solid terrain = a transparent /
      // missing chunk) into the decoded image before classification. The voxel oracle is untouched,
      // so the painted sky sits over real near frontal terrain → the gate MUST report it as holes.
      if (paint) {
        for (let y = Math.max(0, paint.y0); y < Math.min(height, paint.y1); y += 1) {
          for (let x = Math.max(0, paint.x0); x < Math.min(width, paint.x1); x += 1) {
            const i = idx(x, y)
            data[i] = paint.r
            data[i + 1] = paint.g
            data[i + 2] = paint.b
          }
        }
      }

      // Sky reference (top strip) — logged for the record; classification uses blue-dominance.
      let sr = 0
      let sg = 0
      let sb = 0
      let sn = 0
      const strip = Math.max(2, Math.floor(height * 0.04))
      for (let y = 0; y < strip; y += 1) {
        for (let x = 0; x < width; x += 4) {
          const i = idx(x, y)
          sr += data[i]
          sg += data[i + 1]
          sb += data[i + 2]
          sn += 1
        }
      }
      sr /= sn
      sg /= sn
      sb /= sn

      const reads_sky = (i) => {
        const r = data[i]
        const gg = data[i + 1]
        const b = data[i + 2]
        return b - r >= cfg.bor && b - gg >= cfg.bog && b >= cfg.minB
      }
      const is_terrain = (i) => !reads_sky(i) && (data[i] >= 20 || data[i + 1] >= 20 || data[i + 2] >= 20)

      // Stage 1 — pixel candidates. Skip the HUD (top-left) and lil-gui (top-right) UI chrome. No
      // screen-space "near field" here — distance is decided physically per-ray in stage 2.
      const x0 = Math.floor(width * 0.28)
      const x1 = Math.floor(width * 0.98)
      /** @type {{x: number, y: number, r: number, gg: number, b: number}[]} */
      const candidates = []
      for (let x = x0; x < x1; x += 2) {
        let horizon = -1
        for (let y = 0; y < height; y += 1) {
          if (is_terrain(idx(x, y))) {
            horizon = y
            break
          }
        }
        if (horizon < 0) continue
        let seen_terrain = false
        for (let y = horizon; y < height; y += 1) {
          const i = idx(x, y)
          if (is_terrain(i)) seen_terrain = true
          else if (reads_sky(i) && seen_terrain && y >= horizon + cfg.horizon_margin) {
            candidates.push({ x, y, r: data[i], gg: data[i + 1], b: data[i + 2] })
          }
        }
      }

      // Stage 2 — water + PER-RAY FOG mask via voxel raymarch. Camera basis = fly_camera's Euler YXZ.
      // Fog near/far read LIVE off the scene (renderer.js clamps them per frame via the ring's
      // fog_far_ceiling), so the fog curve is always the real one the renderer drew with.
      const scene_fog = /** @type {any} */ (window).__ares_scene__?.fog
      const fog_near = scene_fog?.near ?? 60
      const fog_far = scene_fog?.far ?? 112
      // Near-ring radius (blocks) — where the near voxel ring ends and the FAR SHELL takes over (the
      // near-ring scope below masks hits past it). Read LIVE in-page HERE (classify time = settled, so
      // get_stats is stable) rather than once from the spec (which caught an early construction state and
      // read 0). Prefer the live value, then any cfg override, then fog.near as a loose fallback.
      let near_ring_m = cfg.near_ring_m || fog_near
      try {
        const nr = /** @type {any} */ (window).__engine?.get_stats?.()?.near_ring_m
        if (nr) near_ring_m = nr
      } catch {
        /* get_stats unavailable mid-teardown — keep the fallback */
      }
      // smoothstep(a,b,x) — byte-identical to three's MathNode.smoothstep (the fog factor curve).
      const smoothstep = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)))
        return t * t * (3 - 2 * t)
      }
      // ∫₀^d of the froxel near-haze σ-weight ds — the effective σ-path length to depth d.
      // [2026-07-05 FROXEL REBUILD consumer sweep] The near-haze CAMERA-DISTANCE WINDOW was killed in
      // src/render/atmosphere.js (the shell-kill: rise/fall = 1 — a distance-windowed density is a fog
      // shell welded to the camera — a known artifact class). The σ is now a CONSTANT physical floor,
      // so the path length is simply d. The window cfg fields (froxel_start/full/fade_*) are retained in
      // the call signature but INERT — callers unchanged, and the classifier's fog allowance now matches
      // what the renderer actually draws (the old window model UNDER-allowed far fog past 300 m, which
      // would have flagged false "holes" once froxels default on).
      const froxel_window_len = (/** @type {number} */ d) => d
      const [px, py, pz] = pose.position
      const cy = Math.cos(pose.yaw)
      const sy = Math.sin(pose.yaw)
      const cp = Math.cos(pose.pitch)
      const sp = Math.sin(pose.pitch)
      const fwd = [-cp * sy, sp, -cp * cy]
      const right = [cy, 0, -sy]
      const up = [sp * sy, cp, sp * cy] // cross(right, fwd), unit by construction
      const tan_v = Math.tan((pose.fov * Math.PI) / 180 / 2)
      const aspect = width / height

      // Estimated outward surface normal at a hit voxel = Σ of the unit directions to its AIR
      // neighbors (the classic 6-tap voxel normal). `incidence_at` returns |ray·n̂| ∈ [0,1]: ~1 when
      // the ray strikes the face head-on (frontal), ~0 when it skims along the surface (grazing).
      const incidence_at = (
        /** @type {number} */ hx,
        /** @type {number} */ hy,
        /** @type {number} */ hz,
        /** @type {number} */ rx,
        /** @type {number} */ ry,
        /** @type {number} */ rz
      ) => {
        let nx = 0
        let ny = 0
        let nz = 0
        if (block_at(hx + 1, hy, hz) === 0) nx += 1
        if (block_at(hx - 1, hy, hz) === 0) nx -= 1
        if (block_at(hx, hy + 1, hz) === 0) ny += 1
        if (block_at(hx, hy - 1, hz) === 0) ny -= 1
        if (block_at(hx, hy, hz + 1) === 0) nz += 1
        if (block_at(hx, hy, hz - 1) === 0) nz -= 1
        const nl = Math.hypot(nx, ny, nz)
        if (nl === 0) return 1 // fully buried voxel (no exposed face) — treat as frontal, never hide a real hit
        return Math.abs((-rx * nx + -ry * ny + -rz * nz) / nl)
      }

      let holes = 0
      let water_masked = 0
      let fog_masked = 0
      let graze_masked = 0
      const fwd_dot = (dx, dy, dz) => dx * fwd[0] + dy * fwd[1] + dz * fwd[2]
      for (const c of candidates) {
        const ndc_x = (c.x / width) * 2 - 1
        const ndc_y = -((c.y / height) * 2 - 1)
        let dx = fwd[0] + right[0] * ndc_x * tan_v * aspect + up[0] * ndc_y * tan_v
        let dy = fwd[1] + right[1] * ndc_x * tan_v * aspect + up[1] * ndc_y * tan_v
        let dz = fwd[2] + right[2] * ndc_x * tan_v * aspect + up[2] * ndc_y * tan_v
        const dlen = Math.hypot(dx, dy, dz)
        dx /= dlen
        dy /= dlen
        dz /= dlen
        // SKIN-DEPTH RULE: a solid "hit" needs ≥3 consecutive solid samples (≥2×step penetration) so
        // a grazing 1-2 sample lip-nick over a terrace corner (the RASTERIZER clears it sub-pixel and
        // legitimately shows the fogged far valley) is not mistaken for a near solid surface.
        let verdict = 'fog' // ray escapes ray_max without a confirmed hit ⇒ far haze, never near terrain
        let solid_run = 0
        let first_solid_t = 0
        let hit_x = 0
        let hit_y = 0
        let hit_z = 0
        for (let t = 1; t <= cfg.ray_max; t += cfg.ray_step) {
          const wx = Math.floor(px + dx * t)
          const wy = Math.floor(py + dy * t)
          const wz = Math.floor(pz + dz * t)
          const id = block_at(wx, wy, wz)
          const cls = id === 0 ? 'air' : class_of.get(id)
          if (cls === 'liquid') {
            verdict = 'water'
            break
          }
          if (cls === 'solid') {
            if (solid_run === 0) {
              first_solid_t = t
              hit_x = wx
              hit_y = wy
              hit_z = wz
            }
            solid_run += 1
            if (solid_run >= 3) {
              // PER-RAY FOG WEIGHTING (option a). The renderer fogged this hit by
              // smoothstep(near, far, viewZ) on VIEW-Z depth (−positionView.z), NOT euclidean length:
              // viewZ = first_solid_t × (ray·forward). Mask as fog iff the pixel's blue-dominance is
              // within what fog-at-this-depth paints on neutral terrain; otherwise it is bluer than
              // fog can explain → a real "terrain reads as sky" hit (frontal) or a sub-pixel skim
              // (grazing). This keeps the classifier's fog notion identical to the renderer's, so a
              // far wall hazing to blue and a near wall crossing the old cutoff no longer flip verdict.
              const view_z = first_solid_t * fwd_dot(dx, dy, dz)
              // NEAR-RING SCOPE (post-far-shell). This gate exists to catch NEAR voxel terrain reading as
              // sky (terrace risers, all inside the streamed ring). BEYOND the ring the FAR SHELL renders
              // the horizon as a smoothed, aerially-hazed LOD, and the volumetric CLOUDS sit there too —
              // both LEGITIMATELY paint the horizon blue-white (a verified-correct render), and a smoothed
              // far-shell silhouette softening into sky is not a near hole. So a solid hit past the near
              // ring radius (near_ring_m = ring_manager.loaded_radius_blocks(), the exact edge where the far
              // shell takes over; fog.near is a loose fallback) is far-shell/horizon → mask as fog. The
              // mutation proof paints NEAR frontal terrain (< the ring), so it still fires with full margin.
              if (view_z > near_ring_m) {
                verdict = 'fog'
                break
              }
              const f = smoothstep(fog_near, fog_far, view_z)
              // Combine THREE.Fog with the FROXEL near-haze veil (see FROXEL_* in _shared.js): with the
              // far shell live, THREE.Fog far sits at ~4096 m so f≈0 across the near-mid band, but the
              // froxel still paints a blue-white veil there — 1−exp(−τ), τ = near_haze × windowed path
              // length. Compositing (1−(1−f)(1−froxel)) makes the allowance match the haze the renderer
              // ACTUALLY applied at this depth, so hazed near-mid terrain isn't flagged as a sky-hole.
              const froxel_veil = 1 - Math.exp(-cfg.froxel_haze * froxel_window_len(view_z))
              const veil = 1 - (1 - f) * (1 - froxel_veil)
              const over_r = c.b - c.r - cfg.fog_dr * veil
              const over_g = c.b - c.gg - cfg.fog_dg * veil
              if (over_r <= cfg.chroma_eps && over_g <= cfg.chroma_eps) {
                verdict = 'fog' // fog-at-this-depth fully explains the blue → legitimate atmosphere
              } else {
                verdict = incidence_at(hit_x, hit_y, hit_z, dx, dy, dz) >= cfg.min_frontal ? 'hole' : 'graze'
              }
              break
            }
          } else {
            solid_run = 0 // air (incl. overhang notches) or cross foliage — graze/billboard pass-through
          }
        }
        if (verdict === 'water') water_masked += 1
        else if (verdict === 'fog') fog_masked += 1
        else if (verdict === 'graze') graze_masked += 1
        else holes += 1
      }

      return {
        holes,
        water_masked,
        fog_masked,
        graze_masked,
        candidates: candidates.length,
        sky: { r: Math.round(sr), g: Math.round(sg), b: Math.round(sb) },
      }
    },
    { url: data_url, cfg, pose, paint }
  )
}

// ── DEGENERATE-RENDER FLOOR — the silent-compile-death tripwire ──────────────────────────────────
// Proven failure class (naga-127 nesting cliff): the fragment pipeline dies silently — terrain
// stops DRAWING while collision and every data oracle stay green. The floor is a mechanical pixel
// check any frame-capturing bench can opt into as its first assert: screenshot #canvas, decode
// in-page, and run the pure verdict (bench/degenerate_render.js — imported via the dev server,
// the classify_holes idiom, so only the small verdict object crosses CDP). Thresholds are
// corpus-calibrated (252 headed-Metal captures: 244 world/scene frames pass incl. moonlit night,
// starfield, underwater fog; only void-backdrop diff/particle-component artifacts read degenerate).

/**
 * Screenshots #canvas and throws — failing the calling gate — when the frame reads as
 * BLANK / flat / single-color (nonzero verdict). UI chrome (.lil-gui, #hud) is hidden first,
 * exactly like classify_holes: a dead canvas must not pass the floor on its overlay's pixels.
 * Returns the verdict record (code, flags, five metrics) for gate JSONs.
 * @param {import('@playwright/test').Page} page
 * @param {string} [label] names the frame in the throw/log (e.g. 'post-settle rest pose')
 * @returns {Promise<{ code: number, flags: string[], metrics: Record<string, number> }>}
 */
export async function assert_render_floor(page, label = 'frame') {
  await page.evaluate(() => {
    for (const sel of ['.lil-gui', '#hud'])
      for (const el of document.querySelectorAll(sel)) /** @type {HTMLElement} */ (el).style.visibility = 'hidden'
  })
  const url = `data:image/png;base64,${(await page.locator('#canvas').screenshot()).toString('base64')}`
  const verdict = await page.evaluate(async (url) => {
    const { degenerate_render_verdict } = await import('/bench/degenerate_render.js')
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
    g.drawImage(img, 0, 0)
    const { data, width, height } = g.getImageData(0, 0, img.width, img.height)
    return degenerate_render_verdict(data, { width, height })
  }, url)
  const summary = Object.entries(verdict.metrics)
    .map(([key, value]) => `${key}=${Number(value).toFixed(4)}`)
    .join(' ')
  if (verdict.code !== 0)
    throw new Error(`[render-floor] ${label}: DEGENERATE frame (${verdict.flags.join('+')}) — ${summary}`)
  console.log(`[render-floor] ${label}: pass — ${summary}`)
  return verdict
}

/**
 * Nearest-rank percentile (ascending) — matches harness.js's methodology.
 * @param {number[]} values
 * @param {number} p in [0,100]
 * @returns {number}
 */
export function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

/**
 * Euclidean distance between two [x,y,z] positions (meters).
 * @param {[number,number,number]} a
 * @param {[number,number,number]} b
 * @returns {number}
 */
export function distance(a, b) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Captures raw rAF deltas for a fixed wall-clock duration (unlike harness.capture_frames which
 * captures a fixed COUNT) — we want every frame across the whole flight window, however many.
 * @param {import('@playwright/test').Page} page
 * @param {number} duration_ms
 * @returns {Promise<{ deltas_ms: number[] }>}
 */
export function capture_frames_during(page, duration_ms) {
  return page.evaluate(async (ms) => {
    /** @type {number[]} */
    const deltas = []
    let previous = await new Promise((r) => requestAnimationFrame(r))
    const end = performance.now() + ms
    while (performance.now() < end) {
      const now = await new Promise((r) => requestAnimationFrame(r))
      deltas.push(/** @type {number} */ (now) - /** @type {number} */ (previous))
      previous = now
    }
    return { deltas_ms: deltas }
  }, duration_ms)
}

// Keep the linter happy about the imported `test` symbol staying available to consumers that
// re-export test types through this module boundary (no runtime effect).
export { test }
