import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// DEATH-SEQUENCE GATE — the pixels proof for the repeatedly-reported bug (ending the turn while dying skipped
// the mob's play and removed the fight instantly). Root fixed at derive_phase (the
// fight-end machine's is_ending ROAM-force leaked onto a TERMINAL read during claim()'s death-beat hold →
// the adapter tore the frozen board down UNGATED). THE CONTRACT THIS OBSERVES:
//   end-turn death → the board SURVIVES while the killing wave replays (mob walk → attack → floaters → my
//   death clip) → the DEFEAT card mounts → ONLY THEN the board/world teardown (strictly not-before the card).
//
// RIG: the __ARES_DEV_SYNTH_FIGHT/KILL harness (game/dev/dev_synth_fight.js — the D139 revival) folds a
// synthetic WORLD-fight chain read through the REAL fight_view → sync_engine seam; from the kill fold on,
// EVERYTHING is production (DungeonBoard terminal effect → claim() → note_victory(terminal) → the
// death-beat-gated present()). No tx signed; the background settle fails on the synthetic ids (caught +
// logged — the accepted tradeoff the dead D116 spec documented).
//
// Runs HEADED (WebGPU needs the hardware adapter — world_fight_mount.spec.ts's documented constraint) on
// playwright's own :5174 vite (NEVER :5173). ONE browser; the webServer playwright started dies with the run.
//
// This spec also FOLDS IN the D116 assertions of the deleted dungeon_death_continue.spec.ts (its
// __ARES_DEV_FORCE_FIGHT_BOARD harness died with the isometric renderer in D139 — the force() loop could
// never mount a board again): after CONTINUE the session is exited, no board, no stuck scene.

// serviceWorkers BLOCKED: the app's Workbox SW serves STALE-while-revalidate modules — every run would execute
// the PREVIOUS run's code (probe-proven: run N's console always matched run N-1's instrumentation). The proof
// must drive the CURRENT working tree.
test.use({ headless: false, viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })

const lines: string[] = []
const page_errors: string[] = []
const dump_console = () => {
  try {
    fs.writeFileSync(`${OUT}/death_sequence_console.log`, lines.join('\n'))
    fs.writeFileSync(`${OUT}/death_sequence_pageerrors.log`, page_errors.join('\n\n') || '(none)')
  } catch {
    /* diagnostic only */
  }
}
test.afterEach(dump_console)

const shoot = async (page: Page, name: string) => {
  try {
    const buf = await page.screenshot({ timeout: 8000 })
    fs.writeFileSync(`${OUT}/${name}.png`, buf)
  } catch {
    /* screenshot stalled — the recorder log carries the ordering proof */
  }
}

type SeqEvent = { t: number; ev: string }
const board_up = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!(window as any).__voxel_board?._descriptor?.()).catch(() => false)

test('end-turn death: board survives the killing wave, defeat card mounts, teardown strictly after', async ({
  page,
}) => {
  test.setTimeout(420_000)
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))
  page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`))
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    } catch {
      /* storage unavailable */
    }
  })
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  // ── BOOT: world session up (engine canvas + player controller + the synth hooks registered by GameWorldHud
  //    DEV). The engine's OWN canvas via __voxel_canvas — golden_path's instance-accurate probe (a bare DOM
  //    locator on the persistent host is headless-fragile, its documented trap). ──
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              (window as any).__voxel_canvas instanceof HTMLCanvasElement &&
              typeof (window as any).__ARES_DEV_SYNTH_FIGHT === 'function' &&
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

  // ── (1) MOUNT the synthetic ACTIVE world fight (real fight_view → sync_engine → real voxel board). ──
  const mounted = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_FIGHT())
  expect(mounted?.ok, `synth fight must mount: ${JSON.stringify(mounted)}`).toBe(true)
  await expect.poll(() => board_up(page), { timeout: 90_000, intervals: [1000] }).toBe(true)
  await page.waitForTimeout(2500) // fighters seat + camera settles on the board
  await shoot(page, 'ds_1_board_active')

  // ── (2) ARM the ms-precision recorder, THEN fold the KILL. The recorder timestamps, in-page: the defeat
  //    card's DOM arrival (MutationObserver) and every board descriptor flip (50ms poll) — the exact ordering
  //    the proof bar demands, immune to the spec's own sampling jitter. ──
  await page.evaluate(() => {
    const w = window as any
    const seq: { t0: number; events: { t: number; ev: string }[] } = { t0: performance.now(), events: [] }
    w.__seq = seq
    const log = (ev: string) => seq.events.push({ t: Math.round(performance.now() - seq.t0), ev })
    let card_seen = false
    const mo = new MutationObserver(() => {
      if (!card_seen && document.querySelector('.result--fe.fe--loss')) {
        card_seen = true
        log('card_visible')
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    let last = !!w.__voxel_board?._descriptor?.()
    log(last ? 'board_up' : 'board_down')
    w.__seq_timer = setInterval(() => {
      const up = !!w.__voxel_board?._descriptor?.()
      if (up !== last) {
        last = up
        log(up ? 'board_up' : 'board_down')
      }
    }, 50)
  })
  const killed = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_KILL())
  expect(killed?.ok, `synth kill must fold: ${JSON.stringify(killed)}`).toBe(true)

  // ── (3) THE WAVE WINDOW: the board must SURVIVE the first seconds post-kill (the old bug tore it down on the
  //    same reconcile). Frame series for the visual record. ──
  await page.waitForTimeout(600)
  expect(await board_up(page), 'board must still be mounted 0.6s after the kill (old bug: instant teardown)').toBe(true)
  await shoot(page, 'ds_2_wave_600ms')
  await page.waitForTimeout(1400)
  expect(await board_up(page), 'board must still be mounted 2s after the kill (mob wave replaying)').toBe(true)
  await shoot(page, 'ds_3_wave_2s')
  await page.waitForTimeout(2000)
  await shoot(page, 'ds_4_wave_4s')

  // ── (4) THE CARD: the defeat card mounts once the wave + death-poof linger drain (hard cap ~9s). ──
  const card = page.locator('.result--fe.fe--loss')
  await expect(card, 'the DEFEAT card must mount after the killing wave').toBeVisible({ timeout: 25_000 })
  await shoot(page, 'ds_5_defeat_card')

  // ── (5) THE ORDERING PROOF: read the recorder — the board's LAST down-flip must be ≥ the card's arrival
  //    (present() opens the card THEN tears the scene down; the gate owns everything before that). The events
  //    dump lands BEFORE the assert so a failed run still leaves the ordering evidence on disk. ──
  const read_seq = (): Promise<SeqEvent[]> => page.evaluate(() => (window as any).__seq.events)
  await expect
    .poll(
      async () => {
        fs.writeFileSync(`${OUT}/death_sequence_events.json`, JSON.stringify(await read_seq(), null, 2))
        return board_up(page)
      },
      { timeout: 20_000, intervals: [500] }
    )
    .toBe(false) // the teardown does land (behind the card) — the fight never wedges open
  const seq: SeqEvent[] = await page.evaluate(() => {
    const w = window as any
    clearInterval(w.__seq_timer)
    return w.__seq.events
  })
  fs.writeFileSync(`${OUT}/death_sequence_events.json`, JSON.stringify(seq, null, 2))
  const card_t = seq.find((e) => e.ev === 'card_visible')?.t
  const downs = seq.filter((e) => e.ev === 'board_down').map((e) => e.t)
  expect(card_t, 'recorder must have caught the card arrival').toBeGreaterThan(0)
  expect(downs.length, 'recorder must have caught the board teardown').toBeGreaterThan(0)
  const teardown_t = downs[downs.length - 1]
  expect(
    teardown_t,
    `board teardown (${teardown_t}ms) must be at-or-after the defeat card (${card_t}ms) — sequence: ${JSON.stringify(seq)}`
  ).toBeGreaterThanOrEqual(card_t!)
  expect(
    card_t!,
    'the card must NOT be instant — the killing wave owns the first beats (old bug: <1s)'
  ).toBeGreaterThan(2000)
  await shoot(page, 'ds_6_world_restored_behind_card')

  // ── (6) fold in the deleted D116 spec's CONTINUE assertions: dismissing the card leaves NO stuck board/scene. ──
  await card.locator('.cta .btn').click()
  await expect(card, 'CONTINUE dismisses the defeat card').toBeHidden({ timeout: 10_000 })
  expect(await board_up(page), 'after CONTINUE: still no board (no stuck fight scene)').toBe(false)
  const st = await page.evaluate(() => (window as any).__ARES_DEV_STATE?.() ?? null)
  expect(st?.in_session, 'after CONTINUE: session exited').toBe(false)
  expect(st?.status, 'after CONTINUE: no live dungeon view').toBeNull()
  const canvas_alive = await page.evaluate(() => (window as any).__voxel_canvas instanceof HTMLCanvasElement)
  expect(canvas_alive, 'the world canvas is live under the dismissed card').toBe(true)
  await shoot(page, 'ds_7_after_continue')

  // ── (7) the regression sentinels stayed silent: no ungated terminal teardown, no never-armed gate collapse. ──
  const gate2 = lines.filter((l) => l.includes('[terminal-gate2]'))
  expect(gate2, `the [terminal-gate2] UNGATED-teardown sentinel must never fire:\n${gate2.join('\n')}`).toEqual([])
  const never_armed = lines.filter((l) => l.includes('collapsed with NO sequence signal ever armed'))
  expect(never_armed, 'the killing wave must actually arm the gate (a bypass names itself)').toEqual([])
  // uncaught page errors fail the run (the background settle failure is CAUGHT — console, not pageerror).
  expect(page_errors, `unexpected page errors:\n${page_errors.join('\n')}`).toEqual([])
})
