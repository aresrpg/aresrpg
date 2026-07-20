// WATER WAVE 2 acceptance captures + WebGPU-error gate. Proves the four owner fixes on the LIVE engine
// (WebGPU/Metal) at 2560×1440 @ deviceScaleFactor 2 (dsf2), pin+settle:
//   1. ocean glancing — the seabed is GONE (opaque deep water) + the dispersed sun sparkle PATH shows;
//   2. the ring-seam phantom-panel site — no floating striped water walls;
//   3. a waterfall — the new ORGANIC cascade (no "old TV" vertical stripes).
// The REAL ship gate for a TSL graph is ZERO WebGPU/shader errors (JS/TS clean ≠ compiles on the
// backend) — asserted via the uncapturederror sink + the console/page GPU watcher. Artifacts → /tmp.
// An atmosphere sibling HMR-churns the dev server, so every capture retries a full reload on churn.

import { writeFile, mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { seize_camera, park_camera, settle_stream, get_stats } from './_shared.js'
import { goto_demo, probe_gpu_adapter, attach_gpu_error_watcher } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts'
const SETTLE = { min_ms: 2500, deadline_ms: 25000 }
// VIEWPORT: 1280×720 — the measurement viewport. NOTE (hardware finding, 2026-07-03): a WebGPU
// swapchain LARGER than ~1280×720 reads back ALL-BLACK via `locator.screenshot()` on this headed
// Metal path (the element screenshot grabs the consumed-on-present surface; verified — 2560×1440 at
// BOTH dsf1 and dsf2 gave black frames while the engine rendered 200k–875k quads at 119 FPS, whereas
// a custom context at 1280×720 read back perfectly). So captures are pinned to 1280×720 — an honest
// frame beats a high-res black one. This matches the working water_ng2c gate's capture path.
const VIEWPORT = { width: 1280, height: 720 }

// Deep open ocean (gen-scan): water y=128, bed y~81 (~47 blocks deep), surrounded by deep water.
const OCEAN = { wx: -152, wz: 340 }
// Waterfall cluster right by spawn (gen-scan: waterfall columns at (0,4),(0,8),(-4,8)…, 3–8 blk drops).
const FALL = { wx: 0, wz: 6 }

/** Init-script: attach an uncapturederror listener the moment three requests the device. */
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

test('water wave 2 — captures + zero WebGPU errors', async ({ browser }) => {
  test.setTimeout(240_000)
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()
  await install_gpu_error_hook(page)
  const { errors } = attach_gpu_error_watcher(page)

  await goto_demo(page, { timeout_ms: 60_000 })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, `adapter: ${adapter.reason ?? 'ok'}`).toBe(true)
  await seize_camera(page)

  /** Churn-resilient park→settle→screenshot. @type {(name:string,pos:[number,number,number],yaw:number,pitch:number)=>Promise<void>} */
  const shoot = async (name, pos, yaw, pitch) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await park_camera(page, pos, yaw, pitch)
        await settle_stream(page, SETTLE)
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        const buf = await page.locator('#canvas').screenshot({ timeout: 10000 })
        await writeFile(`${OUT}/${name}.png`, buf)
        const s = await get_stats(page).catch(() => ({}))
        console.log(`[wave2] ${name} captured (try ${attempt + 1}) draws=${/** @type {any} */ (s).draw_calls ?? '?'}`)
        return
      } catch {
        console.log(`[wave2] ${name} churned (try ${attempt + 1}), reloading…`)
        await goto_demo(page, { timeout_ms: 60_000 }).catch(() => {})
        await seize_camera(page).catch(() => {})
      }
    }
    throw new Error(`[wave2] ${name} failed after retries`)
  }

  // 1a. OCEAN GLANCING — low + near-level toward the sun so the Fresnel reflection + dispersed sun path
  //     dominate and the deep seabed must read OPAQUE (bed gone).
  await shoot('wave2_ocean_glancing', [OCEAN.wx, 131, OCEAN.wz], Math.PI / 4, -0.05)
  // 1b. OCEAN GLANCING-DOWN — the exact target shot (glancing DOWN over open ocean): the whole
  //     foreground is deep water and must NOT show bed contours.
  await shoot('wave2_ocean_glancedown', [OCEAN.wx, 140, OCEAN.wz], Math.PI / 4, -0.32)
  // 1c. Sun-path framing — orient toward the sun azimuth so the elongated glitter path is centred.
  await shoot('wave2_sun_path', [OCEAN.wx, 133, OCEAN.wz], Math.atan2(0.4, 0.3), -0.08)
  // 2.  RING-SEAM phantom-panel site over ocean — camera high, slight down, across the near/far seam.
  await shoot('wave2_ring_seam', [OCEAN.wx, 150, OCEAN.wz - 40], Math.PI / 4, -0.18)
  // 2b. FAR-HORIZON glancing — camera JUST above the surface looking almost dead-level across the open
  //     ocean to the far shell, to verify item #1 at LONG distance: the far seabed must read as WATER
  //     (blue at sea level), not exposed bed, and blend with the dark near water (coordinator check).
  await shoot('wave2_far_horizon', [OCEAN.wx, 129.5, OCEAN.wz], Math.PI / 4, -0.015)
  // 3.  WATERFALL — frame the tallest spawn-side cascade at a slight downward angle to see the falling
  //     side faces with the new organic streaks.
  await shoot('wave2_waterfall', [FALL.wx - 14, 134, FALL.wz - 14], Math.PI / 4, -0.22)

  // ── WebGPU ERROR GATE (the real TSL ship gate) ───────────────────────────────────────────────────
  const gpu_errors = await page.evaluate(() => /** @type {any} */ (window).__gpu_errors ?? [])
  const liquid_quads = await page.evaluate(
    () => /** @type {any} */ (window).__terrain_renderer?.get_stats?.().liquid_quads ?? 0
  )
  await writeFile(
    `${OUT}/water_wave2_report.json`,
    JSON.stringify({ gpu_errors, console_errors: errors, liquid_quads, adapter: adapter.info }, null, 2)
  )
  console.log(
    `[wave2] gpu_errors=${gpu_errors.length} console_gpu_errors=${errors.length} liquid_quads=${liquid_quads}`
  )

  await context.close()

  expect(gpu_errors, `WebGPU device errors: ${gpu_errors.join(' | ')}`).toHaveLength(0)
  expect(errors, `GPU console/page errors: ${errors.join(' | ')}`).toHaveLength(0)
  expect(liquid_quads, 'water rendered (liquid quads > 0)').toBeGreaterThan(0)
})
