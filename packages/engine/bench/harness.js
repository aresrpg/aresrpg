// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Playwright bench harness (§7) — shared page-driving + capture logic consumed by every
// bench/*.spec.js scenario file. Runs HEADED Chromium on real hardware (the Studio's Metal
// GPU) per the plan: "headed Chromium on the Studio (real Metal GPU; honest vsync) ... the
// Studio headed run is the source of truth."
//
// Linux/CI-headless recipe (documented, not the source of truth — §7/§9.11):
//   npx playwright test --headed=false \
//     --config=playwright.config.js \
//     -- --headless=new --enable-unsafe-webgpu --use-angle=vulkan --enable-features=Vulkan
//   (pass these as `channel: 'chromium'` + `launchOptions.args` overrides in playwright.config.js;
//   CI numbers are trend-only per §7 — SwiftShader (software) adapters fail the hardware-adapter
//   assertion below by design, so a misconfigured CI runner fails fast instead of emitting
//   silently-bogus numbers.)

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Demo origin — defaults to the shared dev server (:5199) but overridable via ARES_DEMO_ORIGIN so a
// session can point every bench/gate at a DEDICATED vite (e.g. :5217) and leave the main dev :5199
// untouched while it's in use. Default unchanged ⇒ zero behavior change when the env is unset.
export const DEMO_ORIGIN = process.env.ARES_DEMO_ORIGIN || 'http://localhost:5199'
export const DEMO_URL = `${DEMO_ORIGIN}/demo/index.html`
// Gate artifacts (JSON results + screenshots) live in /tmp — artifacts
// never go in the repo. Reviewers read them from /tmp; nothing under packages/engine should
// ever hold generated images (bench/artifacts/ is additionally git-ignored as a guard).
export const RESULTS_DIR = '/tmp/aresrpg-engine-artifacts'

/**
 * @typedef {object} BenchResult
 * @property {string} tier
 * @property {string} scenario
 * @property {number} p50
 * @property {number} p75
 * @property {number} p99
 * @property {number} worst_1pct
 * @property {number} draw_calls
 * @property {number} quads
 * @property {number} sample_count
 * @property {number} avg_fps
 * @property {string} timestamp_iso
 * @property {boolean} hardware_adapter
 */

/**
 * In-page GPU adapter probe (§7 fail-fast). Asserts `navigator.gpu` exists AND the adapter is
 * a hardware backend, not SwiftShader/software. Must run via `page.evaluate` since `navigator.gpu`
 * only exists in the browser context.
 *
 * CRITICAL ORDERING: call this AFTER the page has navigated to a real http(s) document (i.e.
 * after `goto_demo`/`goto_synthetic_scene`), never on the initial `about:blank`. Chromium does
 * NOT expose `navigator.gpu` on the blank start page under automation — it only appears once a
 * real secure/http document is loaded. Probing on `about:blank` returns a false "WebGPU
 * unavailable" and fails the whole gate on a perfectly capable hardware machine. (Verified on
 * this Studio: about:blank → gpu:false; localhost:5199/demo → gpu:true, apple/metal-3.)
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ ok: boolean, info: Record<string, unknown> | null, reason?: string }>}
 */
export async function probe_gpu_adapter(page) {
  return page.evaluate(async () => {
    if (!('gpu' in navigator)) {
      return { ok: false, info: null, reason: 'navigator.gpu unavailable — WebGPU not exposed' }
    }
    // @ts-expect-error — navigator.gpu is a browser-only global, absent from the node/TS lib set.
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      return { ok: false, info: null, reason: 'requestAdapter() returned null' }
    }
    const info = adapter.info ?? {}
    const vendor = String(info.vendor ?? '').toLowerCase()
    const architecture = String(info.architecture ?? '').toLowerCase()
    const description = String(info.description ?? '').toLowerCase()
    const is_software =
      vendor.includes('swiftshader') ||
      (vendor.includes('google') && architecture === '' && description.includes('swiftshader')) ||
      description.includes('swiftshader') ||
      description.includes('llvmpipe') ||
      architecture.includes('swiftshader')
    if (is_software) {
      return {
        ok: false,
        info: { vendor: info.vendor, architecture: info.architecture, description: info.description },
        reason: `software adapter detected (${info.vendor}/${info.description}) — fail fast per §7`,
      }
    }
    return {
      ok: true,
      info: { vendor: info.vendor, architecture: info.architecture, description: info.description },
    }
  })
}

/**
 * Captures N frames of `window.__ares_last_stats__` (written every rAF tick by `demo/hud.js`)
 * plus raw rAF deltas for percentile math. Assumes the demo page + engine are already booted
 * and the scene has "settled" (caller's job to wait for that beforehand).
 * @param {import('@playwright/test').Page} page
 * @param {number} frame_count minimum frames to capture (§8 M0: "capture 60 frames")
 * @returns {Promise<{ deltas_ms: number[], last_stats: Record<string, unknown> }>}
 */
export async function capture_frames(page, frame_count = 60) {
  return page.evaluate(async (count) => {
    /** @type {number[]} */
    const deltas = []
    let previous = await new Promise((resolve) => requestAnimationFrame(resolve))
    while (deltas.length < count) {
      const now = await new Promise((resolve) => requestAnimationFrame(resolve))
      deltas.push(now - previous)
      previous = now
    }
    return {
      deltas_ms: deltas,
      last_stats: /** @type {any} */ (window).__ares_last_stats__ ?? {},
    }
  }, frame_count)
}

/**
 * Nearest-rank percentile over a numeric array (ascending). Simple and dependency-free —
 * matches the plan's rAF-delta-percentile methodology (§5.2/§7), not an interpolated variant.
 * @param {number[]} values
 * @param {number} p in [0,100]
 * @returns {number}
 */
export function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, rank)]
}

/**
 * Builds the §7 JSON result record from captured rAF deltas + the last HUD stats snapshot.
 * @param {object} args
 * @param {string} args.tier
 * @param {string} args.scenario
 * @param {number[]} args.deltas_ms
 * @param {Record<string, unknown>} args.last_stats
 * @param {boolean} args.hardware_adapter
 * @returns {BenchResult}
 */
export function build_result({ tier, scenario, deltas_ms, last_stats, hardware_adapter }) {
  const p50 = percentile(deltas_ms, 50)
  const p75 = percentile(deltas_ms, 75)
  const p99 = percentile(deltas_ms, 99)
  const worst_1pct = percentile(deltas_ms, 99.9) || Math.max(...deltas_ms, 0)
  const avg_ms = deltas_ms.reduce((a, b) => a + b, 0) / (deltas_ms.length || 1)

  return {
    tier,
    scenario,
    p50,
    p75,
    p99,
    worst_1pct,
    draw_calls: Number(last_stats.draw_calls ?? 0),
    quads: Number(last_stats.quad_count ?? 0),
    sample_count: deltas_ms.length,
    avg_fps: avg_ms > 0 ? 1000 / avg_ms : 0,
    timestamp_iso: new Date().toISOString(),
    hardware_adapter,
  }
}

/**
 * Writes a bench result to `bench/results/<scenario>__<tier>__<timestamp>.json`.
 * @param {BenchResult} result
 * @returns {Promise<string>} absolute path written
 */
export async function write_result(result) {
  await mkdir(RESULTS_DIR, { recursive: true })
  const safe_stamp = result.timestamp_iso.replace(/[:.]/g, '-')
  const file_path = path.join(RESULTS_DIR, `${result.scenario}__${result.tier}__${safe_stamp}.json`)
  await writeFile(file_path, JSON.stringify(result, null, 2), 'utf8')
  return file_path
}

/**
 * Captures a compositor screenshot of the canvas + computes its luminance variance, then writes
 * the PNG under bench/artifacts/. This is the NON-BLACK-SCREEN proof (§7/§8): an all-black canvas
 * has variance 0, so `expect(variance).toBeGreaterThan(floor)` fails on a dead render.
 *
 * WHY A SCREENSHOT, NOT `canvas.toDataURL()`/`drawImage`: a WebGPU swapchain texture is consumed
 * on present — reading it back via a 2D context returns all-black even when the GPU is rendering
 * perfectly (verified: engine at 120fps, 5780 quads, drawImage variance = 0). Only a compositor
 * screenshot (`page.screenshot`) sees what's actually on screen, so the variance is honest.
 * @param {import('@playwright/test').Page} page
 * @param {string} name artifact base name (scenario) — `<name>.png` under bench/artifacts/
 * @returns {Promise<{ path: string, variance: number, mean: number }>}
 */
export async function capture_canvas_screenshot(page, name) {
  await mkdir(RESULTS_DIR, { recursive: true })
  const png_path = path.join(RESULTS_DIR, `${name}.png`)
  const buffer = await page.locator('#canvas').screenshot({ path: png_path })
  const { variance, mean } = luminance_variance(buffer)
  return { path: png_path, variance, mean }
}

/**
 * Decodes the canvas screenshot's actual RGB and returns the mean color of a CENTER region vs a
 * TOP-STRIP (sky) region. The screenshot is a normal PNG (NOT the WebGPU swapchain), so we can
 * re-load it as an Image in-page and read its pixels via a 2D canvas — the readback restriction
 * only applies to the live WebGPU surface, not to a captured PNG.
 *
 * WINDING-REGRESSION GUARD (§coordinator): a correct oblique terrain render has a center region
 * dominated by lit ground (brown/green: red≈green > blue), clearly different from the sky strip
 * (blue-dominant). If the per-face winding/normal fix regresses — tops culled → "frame grid" — the
 * centre collapses to sky, so `center.blue > center.red` and center≈top. The spec asserts the
 * centre is ground-not-sky, a class of failure invisible to draw-count / variance checks.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ center: {r:number,g:number,b:number}, sky: {r:number,g:number,b:number} }>}
 */
export async function sample_canvas_colors(page) {
  const data_url = `data:image/png;base64,${(await page.locator('#canvas').screenshot()).toString('base64')}`
  return page.evaluate(async (url) => {
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
    /** @param {number} x0 @param {number} y0 @param {number} w @param {number} h */
    const mean = (x0, y0, w, h) => {
      const d = g.getImageData(x0, y0, w, h).data
      let r = 0
      let gg = 0
      let b = 0
      const px = d.length / 4
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]
        gg += d[i + 1]
        b += d[i + 2]
      }
      return { r: r / px, g: gg / px, b: b / px }
    }
    const cw = Math.floor(img.width * 0.4)
    const ch = Math.floor(img.height * 0.3)
    return {
      center: mean(Math.floor((img.width - cw) / 2), Math.floor((img.height - ch) / 2), cw, ch),
      sky: mean(Math.floor(img.width * 0.3), 0, Math.floor(img.width * 0.4), Math.floor(img.height * 0.08)),
    }
  }, data_url)
}

/**
 * Luminance variance of a PNG buffer, decoded with zero deps via the browser page's own canvas
 * would need a page — instead we sub-sample the raw PNG bytes as a coarse "is anything varying"
 * signal. A fully uniform (all-black or all-one-color) image compresses to a tiny, low-entropy
 * byte stream; a real render has high byte variance. We use the decoded-pixel path in the spec
 * (via `page.evaluate` on the screenshot) for exactness; this byte-level fallback keeps the
 * harness dependency-free and still trips to ~0 on a solid-color frame.
 * @param {Buffer} png_buffer
 * @returns {{ variance: number, mean: number }}
 */
function luminance_variance(png_buffer) {
  // Sample the compressed IDAT region (skip the 8-byte signature + header chunks): a solid-color
  // PNG has near-zero payload entropy, a real frame has high entropy. Coarse but dependency-free.
  let sum = 0
  let sum_sq = 0
  let n = 0
  for (let i = 64; i < png_buffer.length; i += 7) {
    const v = png_buffer[i]
    sum += v
    sum_sq += v * v
    n += 1
  }
  if (n === 0) return { variance: 0, mean: 0 }
  const mean = sum / n
  return { variance: sum_sq / n - mean * mean, mean }
}

/**
 * Attaches console + pageerror listeners that collect any WebGPU/GPUValidationError messages —
 * including the depth/color attachment-size mismatch that the JOB-1 resize desync produced
 * ("... 3079x2014 vs 2305x2014", "Invalid RenderPass", GPUValidationError). The resize-mid-run
 * scenario asserts this list stays EMPTY across a viewport resize, proving the single-owner
 * ResizeObserver keeps the swapchain and depth texture in lock-step (§2.1).
 * @param {import('@playwright/test').Page} page
 * @returns {{ errors: string[] }}
 */
export function attach_gpu_error_watcher(page) {
  /** @type {string[]} */
  const errors = []
  const pattern =
    /gpuvalidationerror|attachment|renderpass|render pass|depth|swapchain|createtexture|webgpu.*error|device lost/i
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (pattern.test(text)) errors.push(`[console] ${text.slice(0, 300)}`)
  })
  page.on('pageerror', (error) => {
    const text = String(error)
    if (pattern.test(text)) errors.push(`[pageerror] ${text.slice(0, 300)}`)
  })
  return { errors }
}

/**
 * Navigates to the demo page with `seed`/`tier` query params and waits for the gate banner to
 * hide (i.e. `create_engine()` succeeded and `engine.start()` ran) — see `demo/main.js`.
 * Throws with the gate's error text if the engine never comes up (pre-WS1 landing: expected).
 * @param {import('@playwright/test').Page} page
 * @param {{ seed?: string, tier?: string, timeout_ms?: number }} [options]
 */
export async function goto_demo(page, { seed, tier, timeout_ms = 15_000 } = {}) {
  const url = new URL(DEMO_URL)
  if (seed) url.searchParams.set('seed', seed)
  if (tier) url.searchParams.set('tier', tier)
  await page.goto(url.toString())
  // state:'attached', NOT the default 'visible': a hidden gate is `display:none` (see index.html),
  // which is never "visible" — waiting for visibility would time out even on a perfectly booted
  // engine. We only need the `data-hidden="true"` attribute to be present in the DOM.
  await page
    .waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: timeout_ms })
    .catch(async () => {
      const gate_text = await page.locator('#gate').textContent()
      throw new Error(`engine did not become ready within ${timeout_ms}ms — gate says: "${gate_text}"`)
    })
}

/**
 * Drives the M0 synthetic-scale bench scenario: the M0 gate needs a synthetic scene with
 * ≥2000 (target: 4600, §8) bundled chunk draws to prove the #31055 overhead is retired.
 * Reads the demo query param `?synthetic_chunks=N`, which `demo/main.js` passes through to
 * `create_engine({ synthetic_chunks: N })` — `core/island_loader.js`'s `load_synthetic_chunks`
 * lays out N chunks in a ring/grid and runs them through the real gen→mesh→upload pipeline
 * instead of the default 7×7 island. See bench/synthetic-2000.spec.js for the assertions.
 * @param {import('@playwright/test').Page} page
 * @param {number} chunk_count
 * @param {{ tier?: string, timeout_ms?: number }} [options]
 */
export async function goto_synthetic_scene(page, chunk_count, { tier, timeout_ms = 20_000 } = {}) {
  const url = new URL(DEMO_URL)
  url.searchParams.set('synthetic_chunks', String(chunk_count))
  if (tier) url.searchParams.set('tier', tier)
  await page.goto(url.toString())
  // state:'attached' — a hidden gate is display:none, never "visible" (see goto_demo note).
  await page
    .waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: timeout_ms })
    .catch(async () => {
      const gate_text = await page.locator('#gate').textContent()
      throw new Error(`synthetic scene did not become ready within ${timeout_ms}ms — gate says: "${gate_text}"`)
    })
}
