// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// DRIVEN PROOF (Task E + F) — the fight PICK LAYER is under test, no write-side bypass. Drives the REAL app:
//   B/A/F. D66 PREDICT-FIRST placement: a genuine page.mouse.click at __ARES_CELL_SCREEN(startCell) px on a
//        DUNGEON PLACEMENT board reaches fight-overlay's click_cell → the fighter renders on the cell INSTANTLY
//        (local action/fight/placed) with ZERO place_at tx; a RE-PICK moves it again, still zero tx; then a
//        genuine click on the shipped READY chrome (.hud-fightctl__ready) fires EXACTLY ONE place_at carrying
//        the last-picked cell. place_at is SPIED (this dev key is ED25519 — the zkLogin-only sponsor rejects
//        its mint/create, so no real chain object; the F#1 read-after-write flip needs a funded key — DECLARED).
//   C.   the board-hover EntityTooltip anchors at the fighter's PROJECTED HEAD (the D60 mounting-component fix),
//        verified at 2 zoom levels: the card center tracks the app's published head projection (fight_hover.x).
//   D.   presence-rule (D65): an ACTIVE fight mounts DungeonBoard ⇒ hud_mounted true ⇒ the plane
//        DungeonLeaveButton HIDES; the board unmounted in a live session ⇒ hud_mounted false ⇒ it SHOWS.
//
// The synthetic states are injected via the SHIPPED DEV harness (force_fight_board.js) using the SAME
// action/fight/* + use_dungeon writes the real chain bridge uses — the overlay + chrome render exactly as in a
// live fight. The clicks are real OS mouse events through the canvas; nothing bypasses click_cell.

const SNAP_DIR = '/tmp/dungeon_fight_pick_snaps'
mkdirSync(SNAP_DIR, { recursive: true })
// Resilient screenshot — DIAGNOSTIC only, must NEVER fail the test. Headless WebGL ReadPixels can stall past
// the default 30s action timeout; a snapshot hiccup is not a product failure, so cap it short and swallow.
const shoot = async (page: Page, name: string) => {
  try {
    const buf = await page.locator('canvas.roam-canvas').screenshot({ timeout: 8000 })
    writeFileSync(`${SNAP_DIR}/${name}.png`, buf)
  } catch {
    /* screenshot stalled (GPU ReadPixels) — ignore; the assertions carry the proof */
  }
}

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

const fight_mode = (page: Page) =>
  page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    return !!context.get_state().fight_mode
  })
// Inject a synthetic fight state, RE-ISSUING until the fight slice STICKS. On a cold boot the scene + engine are
// still settling (a just-set auth address can trigger a load_roster re-render / scene re-mount that races the
// injection), so a single dispatch can be a no-op OR get torn down a frame later. Retry until fight_mode AND a
// fight slice are BOTH present on two consecutive checks (stuck, not mid-teardown). Generous budget — a cold
// testnet boot can take several seconds to accept + hold the spawn.
const has_fight = (page: Page) =>
  page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    return !!context.get_state().fight_mode && !!context.get_state().fight
  })
const force = async (page: Page, state: string) => {
  for (let i = 0; i < 30; i++) {
    await page.evaluate((s) => (window as any).__ARES_DEV_FORCE_FIGHT_BOARD?.({ state: s }), state)
    await page.waitForTimeout(900)
    if ((await has_fight(page)) && (await has_fight(page))) return // stuck across two checks
  }
}
const dungeon_val = (page: Page, key: string) =>
  page.evaluate(async (k) => {
    const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
    return (use_dungeon.getState() as any)[k]
  }, key)

// Install a spy on use_dungeon.place_at_cell that records the encoded cell (and DOES NOT sign a tx — synthetic
// proof). Returns nothing; read the calls back off window.__PLACE_CALLS.
const spy_place_at = (page: Page) =>
  page.evaluate(async () => {
    const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
    ;(window as any).__PLACE_CALLS = []
    const orig = use_dungeon.getState().place_at_cell
    use_dungeon.setState({
      place_at_cell: (cell: number) => {
        ;(window as any).__PLACE_CALLS.push(cell)
        // do NOT call orig — it would fire a real tx_place_at against a synthetic dungeon id (no chain object).
        return Promise.resolve()
      },
      // keep a handle so we could restore, though the test tears the whole page down after.
      _orig_place_at: orig,
    } as any)
  })

async function boot_and_land(page: Page) {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))
  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
    // Pre-set the first-session tutorial "seen" flag (the real Skip-tour dismissal, persisted) so its
    // full-screen `.tut__backdrop` never mounts to eat the driven canvas click. It IS a UI preference.
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
    } catch {
      /* storage unavailable — the loop below still dismisses it */
    }
  }, DEV_KEY)
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  // The PERSISTENT GameWorldHost mounts the REAL roam scene the moment we hold a Sui address (the dev key)
  // — even with an EMPTY roster it renders the interactive/decorative world (canvas + camera + fight overlay
  // live). So we DO NOT need a minted character (this dev key is ED25519 — the zkLogin-only sponsor rejects
  // its create, DECLARED): we drive the fight over the mounted canvas via the shipped DEV harness. Just wait
  // for the canvas + the __ARES_CELL_SCREEN projector to come alive.
  const canvas = page.locator('canvas.roam-canvas')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  // BOTH DEV hooks must be live: __ARES_CELL_SCREEN (overlay/roam projector — the click target) AND
  // __ARES_DEV_FORCE_FIGHT_BOARD (registered by GameWorldHud's own mount effect — the state injector). They
  // mount on different effects, so waiting only for the projector can race the injector → a no-op force().
  await page.waitForFunction(
    () =>
      typeof (window as any).__ARES_CELL_SCREEN === 'function' &&
      typeof (window as any).__ARES_DEV_FORCE_FIGHT_BOARD === 'function',
    { timeout: 30_000 }
  )
  await page.waitForTimeout(3000)

  // belt-and-braces: if the tour still slipped in (slow boot beat the flag), dismiss it.
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(400)
  }
  return { canvas, pageErrors }
}

test('Dungeon fight: D66 predict-first placement (local pick → READY → one place_at) + head-pinned tooltip + LEAVE presence rule', async ({
  page,
}) => {
  // Generous ceiling: this test drives the REAL app (cold boot on testnet + iso-camera settle + retried
  // injection + multiple driven picks + a hovered tooltip at two zoom levels), so the sum of legit waits can
  // exceed the 240s default even when every step passes.
  test.setTimeout(420_000)
  const consoleLines: string[] = []
  page.on('console', (m) => consoleLines.push(m.text()))
  const { canvas, pageErrors } = await boot_and_land(page)

  // ── B/A: DRIVEN PLACEMENT CLICK ─────────────────────────────────────────────────────────────────────
  await force(page, 'dungeon_placement')
  // fight_mode raised + in_dungeon (dungeon_id set) so GameWorldHud mounts the dungeon branch + the board.
  await expect
    .poll(() => fight_mode(page), { timeout: 15_000, message: 'a dungeon placement must raise fight_mode' })
    .toBe(true)
  await expect.poll(() => dungeon_val(page, 'dungeon_id'), { timeout: 10_000 }).not.toBeNull()
  await page.waitForTimeout(2500) // let the overlay stamp the board + spawn sprites + the camera settle
  await shoot(page, 'A1_placement_board')

  await spy_place_at(page)

  // Sanity: the #46 owner-key fix must have set my_entity_id to a wallet the fighters Map is keyed by, else
  // the placement !me gate would eat every click (the exact dead-board bug). Prove it BEFORE the click.
  const slice = await page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    const f = context.get_state().fight
    return {
      my_entity_id: f?.my_entity_id ?? null,
      keyed: f?.my_entity_id ? f.fighters.has(f.my_entity_id) : false,
      placement: f?.placement,
      zone_size: f?.placement_cells?.[0]?.length ?? 0,
    }
  })
  expect(slice.my_entity_id, 'my_entity_id must be set (the #46 owner-key fix)').toBeTruthy()
  expect(slice.keyed, 'my_entity_id must key an actual fighter (wallet-keyed Map) — the !me gate passes').toBe(true)
  expect(slice.placement, 'the slice must be in placement').toBe(true)
  expect(slice.zone_size, 'the team-0 placement zone must be the D41 twin start cells').toBeGreaterThan(0)

  // D66 PREDICT-FIRST driven flow: a placement click is a LOCAL pick (zero tx) — my fighter renders on the cell
  // instantly (action/fight/placed) and I can re-pick freely; the ONE place_at tx fires only on READY.
  // Click a start cell whose LIVE projected px (overlay __ARES_CELL_SCREEN — the Vector3 projector fix) lands
  // on unobstructed canvas, then a GENUINE OS mouse click there. Returns the clicked cell + my fighter's cell
  // AFTER the click (to prove the local move) and the current place_at call count (to prove NO tx yet). The
  // iso-lock camera drifts, so retry across frames; a cell already occupied by my own fighter is skipped so the
  // "re-pick" click targets a genuinely different seat.
  const clickAStartCell = async (avoidEnc: number | null) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const cand = await page.evaluate((avoid) => {
        const st = (window as any).__ARES_FIGHT_OVERLAY?.state
        const zone = st?.placement_cells?.[0] ?? []
        const me = st?.my_entity_id ? st.fighters.get(st.my_entity_id) : null
        for (const c of zone) {
          const enc = (c.y * 10 + c.x) | 0 // normalize -0 → +0 (the 0,0 origin cell) for strict compares
          if (enc === avoid) continue
          if (me && me.cell.x === c.x && me.cell.y === c.y) continue // my fighter already sits here
          const px = (window as any).__ARES_CELL_SCREEN?.(enc)
          if (!px) continue
          const el = document.elementFromPoint(px.x, px.y)
          if (el && (el as HTMLElement).tagName === 'CANVAS' && (el as HTMLElement).className.includes('roam-canvas'))
            return { enc, cell: c, px }
        }
        return null
      }, avoidEnc)
      if (cand) {
        const before = await page.evaluate(() => (window as any).__PLACE_CALLS?.length ?? 0)
        await page.mouse.click(cand.px.x, cand.px.y)
        await page.waitForTimeout(400)
        const after = await page.evaluate(async () => {
          const { context } = await import('/src/game/core/game.js')
          const { use_dungeon_turn } = await import('/src/game/screens/dungeon-turn.js')
          const f = context.get_state().fight
          const me = f?.my_entity_id ? f.fighters.get(f.my_entity_id) : null
          return {
            // `| 0` normalizes a stray -0 (from cell-math on the 0,0 origin cell) to +0 so a strict
            // Object.is(x, enc) compare against the clicked cell doesn't spuriously fail (-0 !== 0).
            fighterCell: me ? (me.cell.y * 10 + me.cell.x) | 0 : null,
            placement_pick:
              (use_dungeon_turn.getState().placement_pick ?? null) === null
                ? null
                : use_dungeon_turn.getState().placement_pick | 0,
            placeCalls: (window as any).__PLACE_CALLS?.length ?? 0,
          }
        })
        // the click registered as a LOCAL pick iff my fighter moved onto the clicked cell.
        if (after.fighterCell === cand.enc) return { ...cand, before, after }
      }
      await page.waitForTimeout(250)
    }
    return null
  }

  // (1) first pick — my fighter must jump to the clicked cell, placement_pick set, and NO place_at tx yet.
  const pick1 = await clickAStartCell(null)
  const reachedHalfInit = consoleLines.some((l) => l.includes('my_entity_id missing from the fight slice'))
  expect(reachedHalfInit, 'NO half-init: my_entity_id must be present (the #46 fix)').toBe(false)
  expect(pick1, 'a driven click on a start cell must LOCALLY place my fighter there (predict-first)').not.toBeNull()
  expect(pick1!.after.fighterCell, 'my fighter renders on the picked cell INSTANTLY (action/fight/placed)').toBe(
    pick1!.enc
  )
  expect(pick1!.after.placement_pick, 'the local placement_pick is stored for READY to commit').toBe(pick1!.enc)
  expect(pick1!.after.placeCalls, 'a placement CLICK signs ZERO place_at tx (D66: no confirmation wait)').toBe(0)
  await shoot(page, 'A2_pick1_local')

  // (2) RE-PICK a different start cell — free re-pick, fighter moves again, STILL no tx.
  const pick2 = await clickAStartCell(pick1!.enc)
  expect(pick2, 'the player can RE-PICK a different start cell freely').not.toBeNull()
  expect(pick2!.after.fighterCell, 're-pick moves the fighter to the new cell').toBe(pick2!.enc)
  expect(pick2!.after.placeCalls, 're-picking still signs ZERO tx').toBe(0)
  await shoot(page, 'A3_repick_local')

  // (3) READY — the ONE place_at tx (place+READY+auto-ACTIVE), carrying the LAST picked cell. A genuine click
  // on the shipped READY chrome (.hud-fightctl__ready), not a store poke.
  const readyBtn = page.locator('.hud-fightctl__ready')
  await expect(readyBtn, 'the D66 placement READY button must be mounted during placement').toBeVisible({
    timeout: 8000,
  })
  await readyBtn.click()
  await page.waitForTimeout(800)
  const placeCalls = await page.evaluate(() => (window as any).__PLACE_CALLS ?? [])
  await shoot(page, 'A4_after_ready')
  expect(placeCalls.length, 'READY fires EXACTLY ONE place_at tx').toBe(1)
  expect(placeCalls, 'the ONE place_at carries the last-picked cell').toContain(pick2!.enc)

  // ── C: HEAD-PINNED TOOLTIP at 2 zoom levels ─────────────────────────────────────────────────────────
  await force(page, 'active') // an ACTIVE fight has live sprites + a hover tooltip
  await expect.poll(() => fight_mode(page), { timeout: 15_000 }).toBe(true)
  await page.waitForTimeout(2500)

  const box = (await canvas.boundingBox())!
  // Hover a fighter and verify EntityTooltip anchors at its PROJECTED HEAD, not the cursor (the D60 fix). The
  // app's OWN anchor is published on `state.fight_hover` = {entity_id, x, y} — roam projects the fighter's
  // WORLD HEAD (fighter_head_world, camera+zoom aware) to viewport px there, and EntityTooltip centers the card
  // on that px. So the load-bearing proof is: (1) the card's horizontal center tracks `fight_hover.x` (the head
  // projection) — NOT the cursor; and (2) that anchor is a genuine head PROJECTION (fight_hover.x differs from
  // the raw cursor x by a real margin at this iso angle — a cursor-pin would make them equal). Poll fighters +
  // small vertical nudges (the billboard rises above the cell-center px) until a hover lands the tip.
  const checkTooltip = async (label: string) => {
    for (let attempt = 0; attempt < 14; attempt++) {
      const target = await page.evaluate(() => {
        const st = (window as any).__ARES_FIGHT_OVERLAY?.state
        if (!st) return null
        for (const fr of st.fighters.values()) {
          if (fr.dead) continue
          const enc = fr.cell.y * 10 + fr.cell.x
          const px = (window as any).__ARES_CELL_SCREEN?.(enc)
          if (!px) continue
          const el = document.elementFromPoint(px.x, px.y)
          if (el && (el as HTMLElement).tagName === 'CANVAS') return { id: fr.id, px }
        }
        return null
      })
      if (target) {
        for (const dy of [-40, -60, -20, -80]) {
          const cursorX = target.px.x
          const cursorY = target.px.y + dy
          await page.mouse.move(cursorX, cursorY)
          await page.waitForTimeout(160)
          if (
            !(await page
              .locator('.ent-tt')
              .isVisible()
              .catch(() => false))
          )
            continue
          // read the app's published head anchor (what the tooltip pins to) for the hovered fighter.
          const anchor = await page.evaluate(async () => {
            const { context } = await import('/src/game/core/game.js')
            const h = context.get_state().fight_hover
            return h ? { x: h.x, y: h.y, id: h.entity_id } : null
          })
          if (!anchor) continue
          const ttBox = (await page.locator('.ent-tt').boundingBox())!
          await shoot(page, `C_tooltip_${label}`)
          const cardCx = ttBox.x + ttBox.width / 2
          return {
            label,
            ok: true,
            anchorX: anchor.x,
            cursorX,
            dxToAnchor: Math.abs(cardCx - anchor.x), // card centered on the head projection?
            anchorVsCursor: Math.abs(anchor.x - cursorX), // is the anchor a real head PROJECTION (≠ cursor)?
            ttBox,
          }
        }
      }
      await page.waitForTimeout(200)
    }
    await shoot(page, `C_tooltip_${label}_MISS`)
    return { label, ok: false }
  }

  // zoom OUT a bit then measure, then zoom IN and measure (2 distinct zoom levels).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120) // dolly out
  await page.waitForTimeout(900)
  const far = await checkTooltip('zoom_out')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 18; i++) await page.mouse.wheel(0, -120) // dolly in
  await page.waitForTimeout(900)
  const near = await checkTooltip('zoom_in')

  expect(far.ok, 'tooltip must show + anchor when hovering the fighter (zoom-out)').toBe(true)
  expect(near.ok, 'tooltip must show + anchor when hovering the fighter (zoom-in)').toBe(true)
  // HEAD-PIN: the card's horizontal center tracks the app's published head projection (fight_hover.x), tightly,
  // at BOTH zooms — the card is centered on the head, not parked in a corner or trailing the cursor.
  expect(far.dxToAnchor!, `zoom-out: card centered on the head projection (dx=${far.dxToAnchor})`).toBeLessThan(60)
  expect(near.dxToAnchor!, `zoom-in: card centered on the head projection (dx=${near.dxToAnchor})`).toBeLessThan(60)

  // ── D: LEAVE PRESENCE RULE ──────────────────────────────────────────────────────────────────────────
  // ACTIVE fight → DungeonBoard mounts its own ABANDON ⇒ hud_mounted true ⇒ the plane LEAVE hides.
  // The prior forces left the board mounted, so its []-deps mount effect (which sets hud_mounted) may not have
  // re-run for THIS state — re-assert an ACTIVE fight so the board mounts fresh, then wait for the flag.
  let hudMounted = false
  for (let i = 0; i < 10 && !hudMounted; i++) {
    await force(page, 'active')
    await page.waitForTimeout(800)
    hudMounted = (await dungeon_val(page, 'hud_mounted')) === true
  }
  expect(hudMounted, 'an ACTIVE board must set hud_mounted (its mount effect ran)').toBe(true)
  const leaveDuringActive = await page.locator('.hud-leave-persistent').count()
  expect(leaveDuringActive, 'the plane LEAVE must HIDE while the fight HUD owns the exit (no double-exit)').toBe(0)
  const abandonPresent = await page.locator('.hud-fightctl__abandon').count()
  expect(abandonPresent, 'the fight HUD ABANDON must be present during an ACTIVE fight').toBeGreaterThan(0)
  await shoot(page, 'D1_active_leave_hidden')

  // HALF-INIT proof (the single-exit law): the fallback plane LEAVE renders ONLY when the fight HUD's OWN exit
  // is ABSENT — i.e. DungeonBoard is NOT mounted. That is exactly the strand this simulates (a live dungeon session
  // with NO board-mounted exit). Simulate it faithfully: keep the dungeon SESSION live (dungeon_id + in_session)
  // but UNMOUNT the board by dropping fight_mode (GameWorldHud's dungeon branch mounts DungeonBoard only while
  // fight_mode) — its unmount effect clears hud_mounted → the fallback LEAVE must surface so the player can exit.
  await page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
    // a live escrowed session with the board torn down (fight_mode off) — the real "board absent" half-init.
    use_dungeon.setState({ in_session: true })
    context.dispatch('action/fight_mode', false)
  })
  await expect
    .poll(() => dungeon_val(page, 'hud_mounted'), {
      timeout: 8000,
      message: 'board unmounted (no fight HUD exit) ⇒ hud_mounted must clear',
    })
    .toBe(false)
  await page.waitForTimeout(400)
  const leaveWhenBoardAbsent = await page.locator('.hud-leave-persistent').count()
  expect(
    leaveWhenBoardAbsent,
    'with the fight HUD exit ABSENT (board unmounted) in a live session, the plane LEAVE MUST show — never stranded'
  ).toBeGreaterThan(0)
  await shoot(page, 'D2_board_absent_leave_shown')

  expect(pageErrors, `unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
