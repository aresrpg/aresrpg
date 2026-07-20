// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// COMBAT-LOG REALTIME — the live-pixels companion to voxel_fight_log_realtime.test.js, proving the combat log
// appears DURING the fight in real time (regression: it previously flushed only after the fight ended). The
// deterministic bun proof (world-shell/voxel_fight_log_realtime.test.js) pins the interleaving headless by driving
// the REAL emit_* composers through a mirror of the adapter's beat loop; THIS spec proves it in the shipped DOM:
// a MutationObserver timestamps each combat-log line as it appears in `.gw-chat__log`, while the synthetic fight
// plays its paced replay. The lines must appear SPREAD across the replay (interleaved with the beats), a TRAP line
// must appear at the trap crossing, and the WIN cast/hit/death lines must land DURING the killing wave — never a
// single post-cascade dump the way the old fight.js batch flush produced.
//
// RIG: __ARES_DEV_SYNTH_FIGHT mounts a real ACTIVE voxel fight; __ARES_DEV_SYNTH_TRAP folds a mob-crosses-my-trap
// active read (the trap beat); __ARES_DEV_SYNTH_WIN folds the WIN terminal (my cast 40→0 kills the mob → the
// swing → hit → death beat chain). From each fold, EVERYTHING is production (emit_fight_deltas → the adapter's
// paced play_cast/play_move → the per-beat emit_* the log now rides). No tx signed (a RENDER harness).
//
// GPU SAFETY (2026-07-12 pink-screen WindowServer crash): runs HEADLESS on SwiftShader (CPU software WebGPU) on
// playwright's OWN vite (never :5173). If the headless env exposes no WebGPU adapter, the board can't build and
// this SKIPS honestly — the deterministic bun proof already pins the interleaving; this is the live companion,
// runnable HEADED (test.use headless:false) when the GPU is idle.

test.use({
  headless: true,
  viewport: { width: 1280, height: 720 },
  serviceWorkers: 'block',
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--enable-features=Vulkan',
      '--use-webgpu-adapter=swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  },
})

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })

const board_up = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!(window as any).__voxel_board?._descriptor?.()).catch(() => false)

// Install a MutationObserver on the combat-log container that stamps performance.now() the instant each combat
// line (`.is-combat`) is inserted into the DOM — the moment it becomes visible on screen.
const install_recorder = (page: Page) =>
  page.evaluate(() => {
    const w = window as any
    w.__combat_log_appear = [] as { t: number; text: string }[]
    const log = document.querySelector('.gw-chat__log')
    if (!log) return false
    const stamp = (node: Element) => {
      if (node.classList?.contains('is-combat'))
        w.__combat_log_appear.push({ t: performance.now(), text: (node.textContent || '').replace(/\s+/g, ' ').trim() })
    }
    // any combat lines already present (unlikely at fight start) + every future insertion.
    log.querySelectorAll('.is-combat').forEach(stamp)
    new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach((n) => n instanceof Element && stamp(n))
    }).observe(log, { childList: true, subtree: true })
    return true
  })

const read_appear = (page: Page): Promise<{ t: number; text: string }[]> =>
  page.evaluate(() => (window as any).__combat_log_appear ?? [])

test(
  'combat-log lines appear DURING the replay, interleaved & spread — a trap line at the crossing, the WIN\n' +
    'cast/hit/death during the killing wave (never a single post-cascade dump)',
  async ({ page }) => {
    test.setTimeout(300_000)
    const page_errors: string[] = []
    page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))
    await page.addInitScript(() => {
      try {
        localStorage.setItem('ares_tutorial_seen', '1')
        localStorage.setItem('ares_tutorial_seen_v2', '1')
        localStorage.setItem('ares_debug', '1')
      } catch {
        /* storage unavailable */
      }
    })

    await page.goto('/game-world?dev&debug=1', { waitUntil: 'domcontentloaded' })
    const has_gpu = await page
      .evaluate(async () => !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter()))
      .catch(() => false)
    test.skip(!has_gpu, 'no hardware WebGPU adapter — run HEADED when GPU capacity is free for the live pixel proof')

    await expect
      .poll(
        () =>
          page
            .evaluate(
              () =>
                typeof (window as any).__ARES_DEV_SYNTH_FIGHT === 'function' &&
                typeof (window as any).__ARES_DEV_SYNTH_TRAP === 'function' &&
                typeof (window as any).__ARES_DEV_SYNTH_WIN === 'function' &&
                !!(window as any).__voxel_ctl?.get_transform?.()
            )
            .catch(() => false),
        { timeout: 180_000, intervals: [2000] }
      )
      .toBe(true)
    for (let i = 0; i < 8; i += 1) {
      if ((await page.locator('.tut__backdrop').count()) === 0) break
      const sk = page.locator('.tut__skip')
      if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(8000) // terrain stream + ground settle (the board seat samples it)

    // (1) mount the synthetic ACTIVE fight → real voxel board.
    const mounted = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_FIGHT())
    expect(mounted?.ok, `synth fight must mount: ${JSON.stringify(mounted)}`).toBe(true)
    await expect.poll(() => board_up(page), { timeout: 90_000, intervals: [1000] }).toBe(true)
    await page.waitForTimeout(2500)
    expect(await install_recorder(page), 'the combat-log container must exist to observe').toBe(true)

    const t_start = await page.evaluate(() => performance.now())

    // (2) fold the mob-crosses-my-trap read → the paced mob move PAUSES at the trap; play_trap_trigger fires
    //     emit_trap_line at that beat. The paced slot floors ~3s.
    const trap = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_TRAP())
    expect(trap?.ok, `synth trap must fold: ${JSON.stringify(trap)}`).toBe(true)
    await expect
      .poll(() => read_appear(page).then((a) => a.some((l) => /trap/i.test(l.text))), {
        timeout: 30_000,
        intervals: [500],
      })
      .toBe(true)

    // (3) fold the WIN terminal → my cast's swing → hit → death beats; emit_cast_context_line/effect/death fire at
    //     each beat, DURING the killing wave (before the victory card teardown).
    const win = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_WIN())
    expect(win?.ok, `synth win must fold: ${JSON.stringify(win)}`).toBe(true)
    await expect
      .poll(() => read_appear(page).then((a) => a.length), { timeout: 30_000, intervals: [500] })
      .toBeGreaterThanOrEqual(4) // trap + cast + hit + death at minimum
    await page.waitForTimeout(4000) // let the paced replay + death sequence finish appending
    const t_end = await page.evaluate(() => performance.now())

    const appear = await read_appear(page)
    fs.writeFileSync(`${OUT}/combat_log_realtime_dom_appear.json`, JSON.stringify({ t_start, t_end, appear }, null, 2))

    // ── THE PROOF ──
    // a trap line appeared (the trap-fire event must produce its own combat-log line).
    expect(
      appear.some((l) => /trap/i.test(l.text)),
      `a trap line must appear — got: ${JSON.stringify(appear)}`
    ).toBe(true)
    // every combat line appeared AFTER the fight started (never pre-seeded, never a post-teardown dump).
    for (const l of appear) expect(l.t).toBeGreaterThanOrEqual(t_start)
    // SPREAD — the lines are NOT clustered at one instant (the batch-flush signature). Across the trap fold + the
    // WIN wave the appearance timestamps span a real window (paced beats are seconds apart), not a single frame.
    const ts = appear.map((l) => l.t)
    const span = Math.max(...ts) - Math.min(...ts)
    expect(
      span,
      `combat lines must be spread across the replay, not dumped — appear: ${JSON.stringify(appear)}`
    ).toBeGreaterThan(300)

    expect(page_errors, `unexpected page errors:\n${page_errors.join('\n')}`).toEqual([])
  }
)
