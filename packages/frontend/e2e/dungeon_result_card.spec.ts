// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// DUNGEON RESULT CARD — the pixels proof for the ticket's open question: at a fight END, does the player SEE a
// result card BEFORE teardown — on WIN (Victory + spoils) and on FAIL (Defeat) — for the DUNGEON flavor (and a
// WORLD-WIN cross-check)? The terminal card path is flavor-agnostic by construction: DungeonBoard's terminal
// effect fires claim() on dungeon.status ∈ {STATUS_WON, STATUS_FAILED} → the death-beat-gated present() opens the
// Victory (FightResult) / Defeat (FightSummary) card, THEN teardown_engine. A dungeon LAST-room win folds to
// STATUS_WON exactly like a world win; any-room defeat folds to STATUS_FAILED — so the two statuses the card
// branches on are what the synth rig produces, per flavor.
//
// RIG: the __ARES_DEV_SYNTH_FIGHT(flavor) / __ARES_DEV_SYNTH_WIN / __ARES_DEV_SYNTH_KILL harness
// (game/dev/dev_synth_fight.js) folds a synthetic chain read through the REAL fight_view → sync_engine seam; from
// the terminal fold on, EVERYTHING is production (claim → note_victory(terminal) → gated present() → the card).
// No tx signed; the background settle fails on the synthetic ids (caught + logged — the accepted D116 tradeoff),
// so a WIN card's xp/loot stay in their DESIGNED pending-skeleton state (no chain delta to hydrate) — the card
// STRUCTURE (Victory verdict + party + spoils section) is what this proves renders before teardown.
//
// Runs HEADED (WebGPU needs the hardware adapter — world_fight_mount.spec.ts's documented constraint; headless on
// Mac gets no adapter, so the synth board never builds). ONE browser on playwright's own :5174 vite (NEVER
// :5173). serviceWorkers BLOCKED so the CURRENT working tree runs (the Workbox SW serves stale modules).
test.use({ headless: false, viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })

const lines: string[] = []
const page_errors: string[] = []
const verdicts: any[] = []
const dump = () => {
  try {
    fs.writeFileSync(`${OUT}/result_card_console.log`, lines.join('\n'))
    fs.writeFileSync(`${OUT}/result_card_pageerrors.log`, page_errors.join('\n\n') || '(none)')
    fs.writeFileSync(`${OUT}/result_card_verdicts.json`, JSON.stringify(verdicts, null, 2))
  } catch {
    /* diagnostic only */
  }
}
test.afterEach(dump)

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

// Drive ONE terminal path end-to-end: mount the ACTIVE fight (flavor), record the card arrival + board flips, fold
// the terminal (win|fail), then assert the card mounts and teardown lands AT-OR-AFTER it (the player SEES the card
// before the scene tears down). Returns the ordering + the card's text content for the proof table.
async function run_path(page: Page, flavor: 'world' | 'dungeon', outcome: 'win' | 'fail') {
  const won = outcome === 'win'
  const card_sel = won ? '.result--fe.fe--win' : '.result--fe.fe--loss'
  const tag = `${flavor}_${outcome}`

  // ── (1) MOUNT the synthetic ACTIVE fight in this flavor (real fight_view → sync_engine → real voxel board). ──
  const mounted = await page.evaluate((flv) => (window as any).__ARES_DEV_SYNTH_FIGHT(flv), flavor)
  expect(mounted?.ok, `[${tag}] synth fight must mount: ${JSON.stringify(mounted)}`).toBe(true)
  await expect.poll(() => board_up(page), { timeout: 90_000, intervals: [1000] }).toBe(true)
  await page.waitForTimeout(2500) // fighters seat + camera settles on the board
  await shoot(page, `${tag}_1_active`)

  // ── (2) ARM the ms-precision recorder (card DOM arrival via MutationObserver + every board descriptor flip). ──
  await page.evaluate((sel) => {
    const w = window as any
    if (w.__seq_timer) clearInterval(w.__seq_timer)
    const seq: { t0: number; events: { t: number; ev: string }[] } = { t0: performance.now(), events: [] }
    w.__seq = seq
    const log = (ev: string) => seq.events.push({ t: Math.round(performance.now() - seq.t0), ev })
    let card_seen = false
    const mo = new MutationObserver(() => {
      if (!card_seen && document.querySelector(sel)) {
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
  }, card_sel)

  // ── (3) FOLD the terminal read → production owns everything (claim → gated present() → card → teardown). ──
  const ended = await page.evaluate(
    (w) => (w ? (window as any).__ARES_DEV_SYNTH_WIN() : (window as any).__ARES_DEV_SYNTH_KILL()),
    won
  )
  expect(ended?.ok, `[${tag}] synth terminal must fold: ${JSON.stringify(ended)}`).toBe(true)

  // ── (4) THE WAVE WINDOW: the FROZEN board must SURVIVE the killing/winning wave (not tear down instantly). ──
  await page.waitForTimeout(800)
  await shoot(page, `${tag}_2_wave`)

  // ── (5) THE CARD: mounts once the wave + death-poof linger drain (hard cap in fight_bridge). ──
  const card = page.locator(card_sel)
  await expect(card, `[${tag}] the ${won ? 'Victory' : 'Defeat'} card must mount`).toBeVisible({ timeout: 25_000 })
  await shoot(page, `${tag}_3_card`)
  const card_text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()

  // ── (6) THE ORDERING PROOF: teardown lands (the fight never wedges open) AT-OR-AFTER the card. ──
  await expect
    .poll(
      async () => {
        fs.writeFileSync(
          `${OUT}/${tag}_events.json`,
          JSON.stringify(await page.evaluate(() => (window as any).__seq.events), null, 2)
        )
        return board_up(page)
      },
      { timeout: 20_000, intervals: [500] }
    )
    .toBe(false)
  const seq: SeqEvent[] = await page.evaluate(() => {
    const w = window as any
    if (w.__seq_timer) clearInterval(w.__seq_timer)
    return w.__seq.events
  })
  fs.writeFileSync(`${OUT}/${tag}_events.json`, JSON.stringify(seq, null, 2))
  const card_t = seq.find((e) => e.ev === 'card_visible')?.t
  const downs = seq.filter((e) => e.ev === 'board_down').map((e) => e.t)
  expect(card_t, `[${tag}] recorder must have caught the card arrival`).toBeGreaterThan(0)
  expect(downs.length, `[${tag}] recorder must have caught the board teardown`).toBeGreaterThan(0)
  const teardown_t = downs[downs.length - 1]
  expect(
    teardown_t,
    `[${tag}] board teardown (${teardown_t}ms) must be at-or-after the card (${card_t}ms) — seq: ${JSON.stringify(seq)}`
  ).toBeGreaterThanOrEqual(card_t!)

  const st_after_fold = await page.evaluate(() => (window as any).__ARES_DEV_STATE?.() ?? null)

  // ── (7) CONTINUE dismisses the card, leaving NO stuck board/scene (the world is restored for the next path). ──
  await card.locator('.cta .btn').click()
  await expect(card, `[${tag}] CONTINUE dismisses the card`).toBeHidden({ timeout: 10_000 })
  expect(await board_up(page), `[${tag}] after CONTINUE: still no board`).toBe(false)
  const st_after_continue = await page.evaluate(() => (window as any).__ARES_DEV_STATE?.() ?? null)
  expect(st_after_continue?.in_session, `[${tag}] after CONTINUE: session exited`).toBe(false)
  const canvas_alive = await page.evaluate(() => (window as any).__voxel_canvas instanceof HTMLCanvasElement)
  expect(canvas_alive, `[${tag}] the world canvas is live under the dismissed card`).toBe(true)
  await page.waitForTimeout(1500) // let the world scene fully restore before the next mount (synth refuses a live session)

  verdicts.push({
    path: tag,
    card_visible: true,
    card_t,
    teardown_t,
    teardown_after_card: teardown_t >= card_t!,
    status_at_fold: st_after_fold?.status,
    card_text,
  })
  return { card_t, teardown_t, card_text }
}

test('dungeon result card: WIN + FAIL show a card before teardown (dungeon flavor + world-win cross-check)', async ({
  page,
}) => {
  test.setTimeout(600_000)
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

  // ── BOOT: world session up (engine canvas + player controller + the synth hooks registered by GameWorldHud). ──
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              (window as any).__voxel_canvas instanceof HTMLCanvasElement &&
              typeof (window as any).__ARES_DEV_SYNTH_FIGHT === 'function' &&
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
  await page.waitForTimeout(8000) // terrain stream + ground settle around the player (the board seat samples it)

  // ── THE MATRIX (the ticket's three paths). Each runs a full mount → terminal → card → teardown → CONTINUE. ──
  await run_path(page, 'dungeon', 'win')
  await run_path(page, 'dungeon', 'fail')
  await run_path(page, 'world', 'win')

  // ── regression sentinels stayed silent across all paths: no ungated terminal teardown, no never-armed gate. ──
  const gate2 = lines.filter((l) => l.includes('[terminal-gate2]'))
  expect(gate2, `the [terminal-gate2] UNGATED-teardown sentinel must never fire:\n${gate2.join('\n')}`).toEqual([])
  const never_armed = lines.filter((l) => l.includes('collapsed with NO sequence signal ever armed'))
  expect(never_armed, 'the terminal wave must actually arm the gate (a bypass names itself)').toEqual([])
  // uncaught page errors fail the run (the background settle failure is CAUGHT — console, not pageerror).
  expect(page_errors, `unexpected page errors:\n${page_errors.join('\n')}`).toEqual([])
})
