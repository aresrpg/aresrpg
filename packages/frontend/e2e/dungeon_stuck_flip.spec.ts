// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// PART-1 ACCEPTANCE — THE D77 SAME-SESSION FLIP (fight-engine W4 phase machine).
//
// THE BUG (3rd recurrence, qa chain-proven): a placement READY click → place_at digest SUCCESS → the dungeon
// went ACTIVE on-chain (status=1, seat ready, turn_ptr=0), but the CLIENT stayed in placement (gold READY still
// rendered, fight.placement still TRUE) until a manual reload. ROOT (a-vs-b verdict = b): the post-tx loop DID
// run and the ACTIVE read WAS applied, but the fight-SLICE flip never fired — sync_engine's respawn branch
// (spawned_placement && status!==PLACEMENT → re-dispatch action/fight/spawn) is a NO-OP because fold()'s spawn
// case is idempotent on fight_id (`if (fight && fight.fight_id === fight_id) return fight`), and the dungeon id
// does NOT change PLACEMENT→ACTIVE. So `placement` was never updated and the board read the stale slice flag.
//
// THE FIX (structural): fight-engine/phase.js derives the phase as the FURTHEST-ALONG of the two status surfaces
// — max(chain_rank, slice_rank). A chain read of ACTIVE (rank 3) beats a stale placement slice flag (rank 2), so
// the phase is ACTIVE and the board flips SAME-SESSION, zero reloads, structurally. FightControls' READY↔END-TURN
// switch is DERIVED from the machine verdict (placement_override), not the raw fight.placement flag.
//
// THIS PROOF drives the REAL app on a pristine dev server (Playwright's own throwaway Vite, NEVER :5173). It uses
// the SHIPPED dev harness state `dungeon_stuck_flip` (force_fight_board.js), which reproduces the field bug
// FAITHFULLY: it spawns a placement slice (fight.placement=true), then flips ONLY the dungeon read to ACTIVE +
// syncs the turn WITHOUT dispatching action/fight/started — i.e. the exact failed-respawn-flip divergence. The
// flip therefore comes ENTIRELY from the phase machine (useFightPhase → derive_phase → the max reconcile), the
// structural fix, not a second imperative write. No tx, no chain object — the divergence is injected in-store.
//   TEST 1 — the STEER-2 stuck-flip: after the ACTIVE read lands over the stale placement slice, the board must
//            flip: .hud-fightctl__end (END TURN) renders, .hud-fightctl__ready (the gold READY) is GONE, zero
//            reloads. This regression is proven fixed.
//   TEST 2 — the stale-OPEN presence case: a spawned placement slice while the dungeon read still lags at OPEN
//            must derive PLACEMENT (the slice's presence-truth beats a stale-back read) — the READY renders, the
//            board is NOT stranded on the plane. (The backward-lag sibling the same max() reconcile covers.)

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/dungeon_stuck_flip_snaps'
mkdirSync(SNAP_DIR, { recursive: true })
// DIAGNOSTIC-only screenshot — must NEVER fail the test (headless WebGL ReadPixels can stall). Cap short + swallow.
const shoot = async (page: Page, name: string) => {
  try {
    const buf = await page.locator('canvas.roam-canvas').screenshot({ timeout: 8000 })
    writeFileSync(`${SNAP_DIR}/${name}.png`, buf)
  } catch {
    /* screenshot stalled (GPU ReadPixels) — ignore; the DOM assertions carry the proof */
  }
}

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

// A fight state is READ off the app's own store instance (this runs inside the bundle).
const has_fight = (page: Page) =>
  page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    return !!context.get_state().fight_mode && !!context.get_state().fight
  })

// Inject a synthetic harness state, RE-ISSUING until the fight slice STICKS across two consecutive checks (a cold
// boot can tear a single dispatch down a frame later). Generous budget — a cold testnet boot settles slowly.
const force = async (page: Page, state: string) => {
  for (let i = 0; i < 30; i++) {
    await page.evaluate((s) => (window as any).__ARES_DEV_FORCE_FIGHT_BOARD?.({ state: s }), state)
    await page.waitForTimeout(700)
    if ((await has_fight(page)) && (await has_fight(page))) return
  }
}

// Read the machine's derived phase + the raw slice/chain surfaces (the divergence the machine reconciles).
const read_phase = (page: Page) =>
  page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
    const { derive_phase } = await import('/src/fight-engine/phase.js')
    const { dungeon } = use_dungeon.getState() as any
    const { fight } = context.get_state()
    const my_seat = dungeon?.escrow?.find((p: any) => p.addr === fight?.my_entity_id) ?? null
    const verdict = derive_phase(dungeon, fight, my_seat)
    return {
      phase: verdict.phase,
      desired: verdict.desired,
      unmet: verdict.unmet,
      chain_status: dungeon?.status ?? null,
      slice_placement: fight?.placement ?? null,
    }
  })

async function boot_and_land(page: Page) {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))
  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
    // Pre-dismiss the first-session tour so its full-screen backdrop never eats the canvas (a UI preference).
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
    } catch {
      /* storage unavailable — the loop below still dismisses it */
    }
  }, DEV_KEY)
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  const canvas = page.locator('canvas.roam-canvas')
  // A COLD (pristine) Vite dev server compiles the large game bundle (three + items.json ~2MB) on the FIRST
  // /game-world request — first paint can take well past 60s headless. Generous ceiling so a genuinely-pristine
  // server (the brief's requirement — never a warm :5173) boots without a false timeout.
  await expect(canvas).toBeVisible({ timeout: 150_000 })
  // BOTH dev hooks must be live before we force a state (they mount on different effects — waiting for one races).
  await page.waitForFunction(
    () =>
      typeof (window as any).__ARES_CELL_SCREEN === 'function' &&
      typeof (window as any).__ARES_DEV_FORCE_FIGHT_BOARD === 'function',
    { timeout: 60_000 }
  )
  await page.waitForTimeout(2500)
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(400)
  }
  return { canvas, pageErrors }
}

test('D77 same-session flip: a stale placement slice under an ACTIVE chain read flips to END TURN, zero reloads', async ({
  page,
}) => {
  // Generous ceiling: a COLD pristine dev server (first-request bundle compile) + iso-camera settle + retried
  // injection. The brief mandates a pristine (never-warm) server, whose first paint is the slow part.
  test.setTimeout(360_000)
  let reloads = 0
  page.on('load', () => (reloads += 1)) // the first goto counts as 1; any FLIP-driven reload would bump it past 1
  const { pageErrors } = await boot_and_land(page)
  const loads_after_boot = reloads // baseline (the initial navigation)

  // ── TEST 1 — THE STEER-2 STUCK-FLIP ───────────────────────────────────────────────────────────────────
  // mount_dungeon_stuck_flip: placement slice (fight.placement=true) + a dungeon read flipped to ACTIVE, with NO
  // action/fight/started dispatched (the exact failed respawn-flip). The board must flip via the phase machine.
  await force(page, 'dungeon_stuck_flip')
  await expect
    .poll(() => has_fight(page), { timeout: 15_000, message: 'the stuck-flip state must raise a fight slice' })
    .toBe(true)
  await page.waitForTimeout(1500) // let React re-derive the phase + swap the chrome
  await shoot(page, 'T1_after_stuck_flip')

  // The DIVERGENCE is real: the raw slice flag stayed placement-true while the chain read is ACTIVE — yet the
  // MACHINE reconciles to ACTIVE (max of the two surfaces). This is the a-vs-b root, proven at the live store.
  const div = await read_phase(page)
  expect(div.chain_status, 'the chain read must be ACTIVE (the field digest landed)').toBe(1)
  expect(
    div.slice_placement,
    'the raw fight-slice flag stays STALE-true (the respawn-flip never fired — the exact field divergence)'
  ).toBe(true)
  expect(
    div.phase,
    `the phase MACHINE must reconcile to ACTIVE despite the stale slice flag (chain=ACTIVE beats stale placement). desired=${div.desired} unmet=${div.unmet.join(',')}`
  ).toBe('ACTIVE')

  // THE LOAD-BEARING UI PROOF: the board flipped SAME-SESSION — END TURN renders, the gold READY is GONE.
  await expect(
    page.locator('.hud-fightctl__end'),
    'the board flipped to ACTIVE: END TURN must render (was stuck on the placement READY before the fix)'
  ).toBeVisible({ timeout: 10_000 })
  await expect(
    page.locator('.hud-fightctl__ready'),
    'the stale gold READY must be GONE (the D77 symptom: READY rendered over a live fight)'
  ).toHaveCount(0)

  // ZERO RELOADS: the flip was structural (a re-derive), never a page reload.
  expect(reloads, 'the flip must happen SAME-SESSION — zero reloads (the bug needed a manual reload)').toBe(
    loads_after_boot
  )

  // ── TEST 2 — THE STALE-OPEN PRESENCE CASE (the backward-lag sibling) ───────────────────────────────────
  // A spawned placement slice while the dungeon read still lags at OPEN must derive PLACEMENT (the slice's
  // presence-truth beats a stale-back chain read) — the READY renders, the board is not stranded on the plane.
  await force(page, 'dungeon_placement') // fight.placement=true, dungeon.status=PLACEMENT
  await expect.poll(() => has_fight(page), { timeout: 15_000 }).toBe(true)
  // now drive ONLY the dungeon read BACKWARD to a stale OPEN, leaving the slice fully in placement.
  await page.evaluate(async () => {
    const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
    const d = { ...(use_dungeon.getState() as any).dungeon, status: 0, status_label: 'OPEN' }
    use_dungeon.setState({ dungeon: d })
  })
  await page.waitForTimeout(1200)
  await shoot(page, 'T2_stale_open_presence')

  const stale = await read_phase(page)
  expect(stale.chain_status, 'the chain read is a STALE OPEN (0)').toBe(0)
  expect(stale.slice_placement, 'the slice is fully in placement').toBe(true)
  expect(
    stale.phase,
    `the machine must derive PLACEMENT from the slice presence-truth (a stale-back OPEN read never strands the board). unmet=${stale.unmet.join(',')}`
  ).toBe('PLACEMENT')
  await expect(
    page.locator('.hud-fightctl__ready'),
    'the placement READY must render (the board is not stranded on the plane by a stale-back read)'
  ).toBeVisible({ timeout: 10_000 })

  expect(pageErrors, `unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
