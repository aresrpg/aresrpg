// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// TRAP-TRIGGER VISUALS — the pixels/sequence proof for the regression (2026-07-13): a mob crossing a trap
// took real chain damage but showed NOTHING onscreen. Root: fight_bridge.plan_mob_beats only
// ever attributed PLAYER hp drops (its loop `continue`s on mob- ids), so a mob's OWN drop was structurally never
// inspected → no beat, no VFX, no floater. THE CONTRACT THIS OBSERVES:
//   a mob crossing a trap cell mid-move → the move PAUSES at the crossing cell → trigger VFX at the cell + hit
//   animation on the mob + damage floater → the move RESUMES the rest of its path.
//
// RIG: the __ARES_DEV_SYNTH_FIGHT + __ARES_DEV_SYNTH_TRAP harness (game/dev/dev_synth_fight.js) records MY trap on
// a cell the synthetic mob walks across, then folds ONE ACTIVE chain read (the mob walked start→across-the-trap→
// dest, hp 40→25, survived) through the REAL fight_view → sync_engine seam. From there EVERYTHING is production:
// emit_fight_deltas → plan_trap_hits attributes the drop to the crossing → the move packet carries trap_hits →
// the adapter's play_move PAUSES the walk at the trap cell for play_trap_trigger (eruption VFX + hit flinch +
// damage floater), then RESUMES. No tx signed (a RENDER harness). The ordered [fight-trap] game_log lines
// (PAUSE at trap cell → trap VFX + floater → RESUME move) are the proof bar's ms-timestamped record.
//
// GPU SAFETY: the live Metal dev session (:5173) must never contend for the hardware GPU (the 2026-07-12
// pink-screen WindowServer crash). This spec runs HEADLESS on SwiftShader (CPU software WebGPU) on playwright's
// OWN :5174 vite — never :5173. If the headless environment exposes no WebGPU adapter at all, the board can't
// build and the test SKIPS with a clear message (the deterministic bun proof — voxel_fight_move_playback.test.js
// "mob trap crossing" — already pins the pause→vfx→resume ordering headless; this is the live-pixels companion,
// runnable HEADED when the machine is idle for the full visual capture).

test.use({
  headless: true,
  viewport: { width: 1280, height: 720 },
  serviceWorkers: 'block', // the Workbox SW serves STALE modules — always drive the CURRENT working tree
  launchOptions: {
    // software WebGPU/WebGL (CPU, no hardware GPU pressure — safe alongside a live game session).
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

const lines: string[] = []
const page_errors: string[] = []
const dump = () => {
  try {
    fs.writeFileSync(`${OUT}/trap_visuals_console.log`, lines.join('\n'))
    fs.writeFileSync(`${OUT}/trap_visuals_pageerrors.log`, page_errors.join('\n\n') || '(none)')
  } catch {
    /* diagnostic only */
  }
}
test.afterEach(dump)

const shoot = async (page: Page, name: string) => {
  try {
    fs.writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 8000 }))
  } catch {
    /* the recorder log carries the ordering proof if a screenshot stalls */
  }
}

const board_up = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!(window as any).__voxel_board?._descriptor?.()).catch(() => false)

// parse one `[log] [fight-trap] <message> {"…","t":<ms>}` console line → { message, t }
const parse_trap = (line: string): { message: string; t: number } | null => {
  const i = line.indexOf('[fight-trap] ')
  if (i < 0) return null
  const rest = line.slice(i + '[fight-trap] '.length)
  const brace = rest.indexOf('{')
  const message = (brace < 0 ? rest : rest.slice(0, brace)).trim()
  let t = NaN
  if (brace >= 0) {
    try {
      ;({ t } = JSON.parse(rest.slice(brace)))
    } catch {
      /* malformed payload — the message order still stands */
    }
  }
  return { message, t }
}

test('mob crossing a trap: PAUSE at the cell → trigger VFX + floater → RESUME (ordered, timestamped)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))
  page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`))
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
      localStorage.setItem('ares_tutorial_seen_v2', '1')
      localStorage.setItem('ares_debug', '1') // game_log → console (so the [fight-trap] lines are captured)
    } catch {
      /* storage unavailable */
    }
  })

  // The voxel board build needs a HARDWARE WebGPU adapter (the death_sequence_gate.spec.ts constraint): the WebGL2
  // software fallback throws `occ.set_screen is not a function` on build, so the board never seats entities and
  // play_move no-ops. In a headless env with no WebGPU adapter, SKIP honestly — the deterministic bun ordering
  // proof (voxel_fight_move_playback.test.js "mob trap crossing") already pins pause<vfx<resume headless; THIS
  // spec is the live-pixels companion, meant to run HEADED (test.use headless:false) when the GPU is idle.
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
              (window as any).__voxel_canvas instanceof HTMLCanvasElement &&
              typeof (window as any).__ARES_DEV_SYNTH_FIGHT === 'function' &&
              typeof (window as any).__ARES_DEV_SYNTH_TRAP === 'function' &&
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
  await page.waitForTimeout(8000) // terrain stream + ground settle around the player (the board seat samples it)

  // (1) mount the synthetic ACTIVE fight (real fight_view → sync_engine → real voxel board), wait for the board.
  const mounted = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_FIGHT())
  expect(mounted?.ok, `synth fight must mount: ${JSON.stringify(mounted)}`).toBe(true)
  await expect.poll(() => board_up(page), { timeout: 90_000, intervals: [1000] }).toBe(true)
  await page.waitForTimeout(2500) // fighters seat + camera settles
  await shoot(page, 'trap_1_board_active')

  // (2) fold the mob-crosses-my-trap read. From here production owns it: the mob's paced move plays, PAUSES at the
  //     trap cell for the trigger, then resumes. The paced slot floors to ~3s, so the sequence takes a few seconds.
  const mark = lines.length
  const trap = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_TRAP())
  expect(trap?.ok, `synth trap must fold: ${JSON.stringify(trap)}`).toBe(true)
  expect(trap?.damage, 'the trap deals the real chain damage the crab took').toBe(15)

  // (3) capture the three ordered [fight-trap] beats off the console (PAUSE → VFX+floater → RESUME).
  await expect
    .poll(() => lines.slice(mark).filter((l) => l.includes('[fight-trap] RESUME move')).length, {
      timeout: 30_000,
      intervals: [500],
    })
    .toBeGreaterThan(0)
  await shoot(page, 'trap_2_after_trigger')

  const beats = lines
    .slice(mark)
    .map(parse_trap)
    .filter((b): b is { message: string; t: number } => !!b)
  fs.writeFileSync(`${OUT}/trap_visuals_beats.json`, JSON.stringify(beats, null, 2))

  // ── THE ORDERING PROOF: the three beats fired, in order, with strictly increasing timestamps. ──
  const pause = beats.find((b) => b.message === 'PAUSE at trap cell')
  const vfx = beats.find((b) => b.message === 'trap VFX + floater')
  const resume = beats.find((b) => b.message === 'RESUME move')
  expect(pause, `PAUSE beat must fire — beats: ${JSON.stringify(beats)}`).toBeTruthy()
  expect(vfx, 'trap VFX + floater beat must fire').toBeTruthy()
  expect(resume, 'RESUME beat must fire (the move continues past the trap)').toBeTruthy()
  // strict ordering by the in-page ms timestamps: pause < vfx < resume (the contract sequence).
  expect(pause!.t).toBeLessThan(vfx!.t)
  expect(vfx!.t).toBeLessThan(resume!.t)
  // and by console arrival order too (belt-and-suspenders — the sampling can't reorder synchronous logs).
  const order = beats.map((b) => b.message)
  expect(order.indexOf('PAUSE at trap cell')).toBeLessThan(order.indexOf('trap VFX + floater'))
  expect(order.indexOf('trap VFX + floater')).toBeLessThan(order.indexOf('RESUME move'))

  // no-regress: the death-sequence sentinel must never fire from a mere trap crossing (a survivor, not a kill).
  expect(
    lines.filter((l) => l.includes('[terminal-gate2]')),
    'no ungated terminal teardown from a trap'
  ).toEqual([])
  expect(page_errors, `unexpected page errors:\n${page_errors.join('\n')}`).toEqual([])
})
