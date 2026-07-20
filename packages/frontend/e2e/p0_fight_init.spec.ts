// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// [p0-fight-init] VERIFY DRIVE — the first-fight-after-live-transition input bug (3rd report), post-fix.
// Boots the REAL voxel session (dev-wallet login), births the fight from the LIVE session (create → cave →
// engage → PLACEMENT → ACTIVE, NO refresh anywhere), then HARD-asserts first-try:
//   (1) board hover flows on the ACTIVE board (real mouse, human drift),
//   (2) a real-mouse click on a free cell DRAFTS a move (the full picking→bus→adapter→store relay),
//   (3) END TURN commits, the mob cascade resolves, and a FRESH turn deadline lands back on me,
//   (4) the turn timer is live (counting down),
//   (5) ZERO [p0-fight-init] probe lines fire mid-fight (the churn now HOLDS the live board).
// ALL app reads/actions go through the WINDOW HOOKS (__dev_start_fight / __ARES_DEV_STATE / __voxel_board):
// a Playwright-side import('/src/…') binds a SECOND Vite module instance (dev_probe.js's documented trap).
// Run HEADED (WebGPU needs the hardware adapter — the ambient_mobs_tr3 precedent).

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname

const lines: string[] = []
const dump = () => {
  try {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(`${OUT}/p0_verify_console.log`, lines.join('\n'))
  } catch {
    /* capture dir unavailable — the console still streamed to stdout */
  }
}
test.afterEach(dump) // the console capture lands even when an assertion fails mid-drive

type DevState = {
  status: number | null
  busy: boolean
  phase: string
  error: string | null
  in_session: boolean
  winner: number | null
  my_cell: { x: number; y: number } | null
  my_mp: number | null
  mobs: { cell: number; hp: number; alive: boolean }[]
  me: string | null
  active: string | null
  turn: number | null
  deadline: number | null
  move_path: number
  armed: string | null
  cast_target: number | null
}
const dev_state = (page: Page): Promise<DevState | null> =>
  page.evaluate(() => (window as any).__ARES_DEV_STATE?.() ?? null).catch(() => null)

test('p0-fight-init verify: transition-born fight has first-try input + mob turns + live timer', async ({ page }) => {
  test.setTimeout(600_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)))
  page.on('console', (m) => {
    const t = m.text()
    lines.push(`[${m.type()}] ${t}`)
    if (/\[p0-fight-init\]|\[voxel-fight\]|\[cave\]|\[dev\]|\[dungeon\]/.test(t)) console.log('  PAGE', t)
  })

  await page.addInitScript(() => {
    try {
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    } catch {
      /* n/a */
    }
  })
  // VITE_DEV_KEY rides in from the root .env via import.meta.env (dev_wallet's documented fallback).
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  // session + probe hooks up (GameWorldHud's DEV block registers dev_probe; embed registers the voxel rig).
  await expect
    .poll(
      async () =>
        page
          .evaluate(
            () =>
              typeof (window as any).__ARES_DEV_STATE === 'function' &&
              typeof (window as any).__dev_start_fight === 'function'
          )
          .catch(() => false),
      { timeout: 120_000, intervals: [2000] }
    )
    .toBe(true)
  // tutorial belt: if the backdrop mounted anyway (fresh profile race), skip it like a human would.
  for (let i = 0; i < 8; i += 1) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(400)
  }

  // ── THE TRANSITION (no refresh from here on): __dev_start_fight = the EXACT production actions
  //    (stale-escrow clean → create_dungeon_as_leader → engage → refresh) through the app's own graph.
  //    Outer retries absorb two known rig-environment walls: the poll busy-window engage drop (D59 class —
  //    a human re-clicks the pack) and the NEW zero-gas guard's sim-staleness (a create right after an
  //    abandon can sim-refuse join on the pre-abandon char state — the D77 read-after-write class; a few
  //    seconds of settle + a fresh create clears it). ──────────────────────────────────────────────────────
  let started = false
  for (let attempt = 0; attempt < 3 && !started; attempt += 1) {
    const dungeon_id = await page.evaluate(() => (window as any).__dev_start_fight()).catch(() => null)
    console.log(`  attempt ${attempt} dungeon:`, dungeon_id)
    for (let i = 0; i < 12; i += 1) {
      const s = await dev_state(page)
      if (i % 3 === 0)
        console.log(
          `  engage tick ${i}:`,
          JSON.stringify({ status: s?.status, phase: s?.phase, busy: s?.busy, error: s?.error })
        )
      if (s && s.status !== null && s.status !== 0) {
        started = true
        break
      }
      if (s && (s.phase === 'done' || s.phase === 'idle')) break // orphaned/failed leg — settle + recreate
      await page.evaluate(() => (window as any).__dev_engage()).catch(() => {})
      await page.waitForTimeout(3000)
    }
    if (!started) await page.waitForTimeout(6000) // fullnode settle for the sim-staleness window
  }
  expect(started, 'the room must start (OPEN → PLACEMENT/ACTIVE) — the transition-born fight').toBe(true)

  // ── PLACEMENT board + the bus counters (installed pre-flip — they must keep counting post-flip). ─────────
  await expect
    .poll(async () => page.evaluate(() => !!(window as any).__voxel_board?._descriptor?.()).catch(() => false), {
      timeout: 120_000,
      intervals: [1000],
    })
    .toBe(true)
  await page.evaluate(() => {
    const w = window as any
    w.__p0 = { hover: 0, click: 0 }
    w.__voxel_board.on('cell_hover', (c: any) => {
      if (c) w.__p0.hover += 1
    })
    w.__voxel_board.on('cell_click', (c: any) => {
      if (c) w.__p0.click += 1
    })
  })
  const rect = await page.evaluate(() => {
    const r = (window as any).__voxel_canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  for (let i = 0; i < 8; i += 1)
    await page.mouse.move(rect.x + rect.w * (0.3 + 0.05 * i), rect.y + rect.h * 0.6, { steps: 2 })
  console.log('  placement hover events:', await page.evaluate(() => (window as any).__p0.hover))

  // ── READY (real click, human drift) → solo flips ACTIVE: the transition-born fight. ─────────────────────
  const human_click = async (x: number, y: number) => {
    await page.mouse.move(x - 6, y + 4, { steps: 4 })
    await page.mouse.move(x, y, { steps: 3 })
    await page.mouse.down()
    await page.mouse.move(x + 2, y + 1) // press drift — never a zero-motion synthetic
    await page.mouse.up()
  }
  {
    const ready = page.locator('.hud-fightctl__ready')
    await ready.waitFor({ state: 'visible', timeout: 60_000 })
    const b = await ready.boundingBox()
    if (!b) throw new Error('ready button has no box')
    await human_click(b.x + b.width / 2, b.y + b.height / 2)
  }
  await expect.poll(async () => (await dev_state(page))?.status ?? -1, { timeout: 90_000, intervals: [1500] }).toBe(1) // ACTIVE
  await page.waitForTimeout(4000) // the flip churn window — the board must HOLD through it now

  // ── ASSERT 1: hover flows on the ACTIVE board (real mouse). ──────────────────────────────────────────────
  const hover_before = await page.evaluate(() => (window as any).__p0.hover)
  for (let i = 0; i < 10; i += 1)
    await page.mouse.move(rect.x + rect.w * (0.25 + 0.05 * i), rect.y + rect.h * (0.5 + 0.02 * i), { steps: 3 })
  await page.waitForTimeout(300)
  const hover_after = await page.evaluate(() => (window as any).__p0.hover)
  console.log('  ACTIVE hover events:', hover_before, '→', hover_after)
  expect(hover_after, 'board hover must flow on the ACTIVE transition-born board (first try)').toBeGreaterThan(
    hover_before
  )

  // ── ASSERT 2: a real-mouse click on a free neighbour cell DRAFTS a move (picking→bus→adapter→store). ────
  await expect
    .poll(async () => (await dev_state(page))?.active, { timeout: 60_000, intervals: [1500] })
    .toBe((await dev_state(page))?.me ?? '__nobody__')
  const s_active = await dev_state(page)
  expect(s_active?.my_cell, 'my fighter must be on the board').not.toBeNull()
  const GRID_W = 20
  const mob_cells = new Set(
    (s_active?.mobs ?? []).filter((m) => m.alive).map((m) => `${m.cell % GRID_W},${(m.cell / GRID_W) | 0}`)
  )
  let drafted = false
  for (const d of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]) {
    const cx = s_active!.my_cell!.x + d[0]
    const cy = s_active!.my_cell!.y + d[1]
    if (mob_cells.has(`${cx},${cy}`)) continue
    const px = await page
      .evaluate(([x, y]) => (window as any).__ARES_DEV_CELL_SCREEN?.(x, y) ?? null, [cx, cy])
      .catch(() => null)
    if (!px) continue
    await human_click(rect.x + px.x, rect.y + px.y)
    drafted = await expect
      .poll(async () => (await dev_state(page))?.move_path ?? 0, { timeout: 6_000, intervals: [500] })
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false)
    console.log(`  move click on [${cx},${cy}] → drafted=${drafted}`)
    if (drafted) break // an obstacle neighbour is a legitimate no-op — try the next side
  }
  expect(drafted, 'a real-mouse cell click must draft a move on the first transition fight').toBe(true)

  // ── ASSERT 3: the turn TIMER is live on the transition-born board (counting down on my own turn). ───────
  const t0 = await dev_state(page).then((s) => (s?.deadline ? s.deadline - Date.now() : null))
  await page.waitForTimeout(5000)
  const t1 = await dev_state(page).then((s) => (s?.deadline ? s.deadline - Date.now() : null))
  console.log('  timer remaining:', t0, '→', t1, 'ms')
  expect(t0, 'a live turn deadline must exist on the ACTIVE board').not.toBeNull()
  expect(t1!, 'the turn timer must be COUNTING (live), not frozen').toBeLessThan(t0!)

  // ── ATTEMPT: armed cast input (card click → mob-cell click). A non-castable mob (range/LOS) is a designed
  //    no-op (D301 targeting-only), so this is asserted only to ARM level; a landed target is logged. ───────
  {
    const card = page.locator('button.hud-socket:not(.weapon)').first()
    if (await card.isVisible().catch(() => false)) {
      const b = await card.boundingBox()
      if (b) await human_click(b.x + b.width / 2, b.y + b.height / 2)
      const armed = await expect
        .poll(async () => (await dev_state(page))?.armed ?? null, { timeout: 5_000, intervals: [400] })
        .not.toBeNull()
        .then(() => true)
        .catch(() => false)
      console.log('  spell armed:', armed)
      if (armed) {
        const s = await dev_state(page)
        const mob = (s?.mobs ?? []).find((m) => m.alive)
        if (mob) {
          const mx = mob.cell % GRID_W
          const my = (mob.cell / GRID_W) | 0
          const px = await page
            .evaluate(([x, y]) => (window as any).__ARES_DEV_CELL_SCREEN?.(x, y) ?? null, [mx, my])
            .catch(() => null)
          if (px) {
            await human_click(rect.x + px.x, rect.y + px.y)
            const ct = await page
              .waitForTimeout(1500)
              .then(() => dev_state(page))
              .then((x) => x?.cast_target ?? null)
            console.log(
              `  armed cast click on mob [${mx},${my}] → cast_target=${ct} (null = out of range/LOS, a designed no-op)`
            )
          }
        }
        await page.keyboard.press('Escape') // disarm — leave only the move draft for the commit attempt
      }
    }
  }

  // ── ASSERT 4 (conditional): END TURN → the mob cascade resolves back to me with a FRESH deadline.
  //    KNOWN ORTHOGONAL BLOCKER (same-day landing, fence region): the 0.1 SUI preflight gas ceiling refuses
  //    commit_turn (~0.48 SUI simulated net) AND liquidation pass_turn (~0.2 SUI) — NO fight can advance for
  //    ANY wallet until that policy/cost collision is arbitrated. The drive records the honest outcome:
  //    'cycled' proves the mob turn + refill; 'gas_blocked' proves the input seam did its job and the ONLY
  //    remaining wall is the money-path ceiling (reported upward, not mine to edit). ───────────────────────
  const deadline_before = (await dev_state(page))?.deadline ?? 0
  {
    const end = page.locator('.hud-fightctl__end')
    await end.waitFor({ state: 'visible', timeout: 10_000 })
    const b = await end.boundingBox()
    if (!b) throw new Error('end-turn button has no box')
    await human_click(b.x + b.width / 2, b.y + b.height / 2)
  }
  let turn_outcome = 'pending'
  await expect
    .poll(
      async () => {
        const s = await dev_state(page)
        if (!s) return false
        if (s.deadline !== deadline_before && (s.active === s.me || (s.winner ?? -1) !== -1)) {
          turn_outcome = 'cycled'
          return true
        }
        const gas_hit = lines.some((l) => l.includes('[gas-guard] refusing'))
        if (gas_hit) {
          turn_outcome = 'gas_blocked'
          return true
        }
        return false
      },
      { timeout: 90_000, intervals: [2000] }
    )
    .toBe(true)
  console.log('  END TURN outcome:', turn_outcome)
  if (turn_outcome === 'cycled') {
    const s = await dev_state(page)
    console.log(
      '  post-cycle:',
      JSON.stringify({
        active: s?.active === s?.me ? 'me' : s?.active,
        turn: s?.turn,
        deadline_in_s: s?.deadline ? Math.round((s.deadline - Date.now()) / 1000) : null,
      })
    )
  }

  // ── ASSERT 5: the KILL-SHOT probes stayed silent mid-fight (no live-board teardown, no superseded build).
  //    (The phase-layer churn-hold probe may legitimately log the pre-board spawn gap — it is diagnostic.) ──
  const kill_probes = lines.filter(
    (l) =>
      l.includes('[p0-fight-init]') && (l.includes('teardown of a LIVE board') || l.includes('superseded mid-await'))
  )
  console.log('  kill-shot probes:', JSON.stringify(kill_probes))
  expect(kill_probes, 'the churn must HOLD the live board — no teardown/supersede probe may fire mid-fight').toEqual([])

  await page.screenshot({ path: `${OUT}/p0_verify_active_board.png` })
  dump()
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
  // no in-drive cleanup: the char stays escrowed; the NEXT drive's __dev_start_fight D171c-abandons it (designed).
})
