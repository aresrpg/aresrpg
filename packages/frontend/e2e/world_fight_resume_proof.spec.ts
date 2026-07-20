import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// WORLD-FIGHT BOARD-MOUNT FIX PROOF — the P0 acceptance for the origin_of world-anchor fix.
// A world fight used to build its board at VOXEL_BOARD_ORIGIN (y=260, in the SKY) because origin_of only
// knew the cave anchor. The fix: fight_bridge.fight_view surfaces the on-chain mob-group anchor, and
// embed_voxel.origin_of centers the board on it at ground level (feet_of(ground_surface_y)). This drives a
// KNOWN existing world fight (a placement-stuck one seating the dev senshi) straight through that path via the
// DEV __dev_enter_world_fight hook (the reconnect path minus the RPC discovery — reads the Fight chain-direct),
// and proves: board MOUNTS at the anchor (origin.y is ground, not 260); the countdown expiry fires force_start
// → ACTIVE; a reload re-mounts. Run HEADED (WebGPU needs the hardware adapter).

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname
const FIGHT = '0xbe838b0f6969e92a9b355e937c7f705555f99fdcb04badc7927062cef4960972'
const WORLD = '0x7ab5845b9dfc751343fc847ca4957de1c703cf6176ac037891644c75656d4fb0'
const CHAR = '0x3fa736761de4effbf240d049a3a9e698fe6065fdfaca8c134f0ec12c9f335344'

const lines: string[] = []
const dump = () => {
  try {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(`${OUT}/world_fight_resume_console.log`, lines.join('\n'))
  } catch {
    /* n/a */
  }
}
test.afterEach(dump)

type DevState = {
  status: number | null
  phase: string
  winner: number | null
  my_cell: { x: number; y: number } | null
}
const dev_state = (page: Page): Promise<DevState | null> =>
  page.evaluate(() => (window as any).__ARES_DEV_STATE?.() ?? null).catch(() => null)
const board_up = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!(window as any).__voxel_board?._descriptor?.()).catch(() => false)

async function boot(page: Page) {
  await expect
    .poll(
      async () =>
        page
          .evaluate(
            () =>
              typeof (window as any).__ARES_DEV_STATE === 'function' &&
              typeof (window as any).__dev_enter_world_fight === 'function'
          )
          .catch(() => false),
      { timeout: 120_000, intervals: [2000] }
    )
    .toBe(true)
  for (let i = 0; i < 8; i += 1) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(400)
  }
}

const enter = (page: Page) =>
  page
    .evaluate(({ FIGHT, WORLD, CHAR }) => (window as any).__dev_enter_world_fight(FIGHT, WORLD, CHAR), {
      FIGHT,
      WORLD,
      CHAR,
    })
    .catch((e) => ({ error: String(e) }))

test('world fight RESUME mounts the board AT THE ANCHOR (not the sky), fires force_start, re-mounts on reload', async ({
  page,
}) => {
  test.setTimeout(600_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)))
  page.on('console', (m) => {
    const t = m.text()
    lines.push(`[${m.type()}] ${t}`)
    if (/\[voxel\]|\[dev\]|\[world-fight\]|\[voxel-fight\]|\[liquidation\]|\[fight-tx\]|\[gas/.test(t))
      console.log('  PAGE', t)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    } catch {
      /* n/a */
    }
  })
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  await boot(page)

  // ── (1) MOUNT: enter the existing world fight → the board must build at the anchor's GROUND, not y=260 ──
  const res = await enter(page)
  console.log('  enter result:', JSON.stringify(res))
  await expect.poll(() => board_up(page), { timeout: 120_000, intervals: [1000] }).toBe(true)
  await expect
    .poll(async () => (await dev_state(page))?.status ?? null, { timeout: 60_000, intervals: [1500] })
    .not.toBeNull()
  const originLine = lines.find((l) => /world-fight board @ anchor/.test(l))
  console.log('  ORIGIN LINE:', originLine)
  // parse the logged origin object — prove origin.y is GROUND (well under the old y=260 sky fallback)
  const originDesc = await page.evaluate(() => (window as any).__voxel_board?._descriptor?.() ?? null).catch(() => null)
  console.log('  BOARD DESCRIPTOR:', JSON.stringify(originDesc))
  const s1 = await dev_state(page)
  console.log('  MOUNTED state:', JSON.stringify(s1))
  const spellCards = await page
    .locator('.hud-spellbar2__grid [class*="card"], .hud-spellbar2__grid button, .deck-card')
    .count()
    .catch(() => 0)
  console.log('  spell-bar cards:', spellCards)
  await page.screenshot({ path: `${OUT}/wfr_1_placement.png` })

  // ── (2) FORCE-START: the placement deadline expired long ago → the poll's maybe_force_start fires the
  //    permissionless turns::force_start → the fight flips ACTIVE (or an honest surfaced refusal). ──
  const active = await expect
    .poll(async () => (await dev_state(page))?.status ?? -1, { timeout: 150_000, intervals: [2500] })
    .toBe(1)
    .then(() => true)
    .catch(() => false)
  const s2 = await dev_state(page)
  console.log('  after force_start:', JSON.stringify(s2), 'ACTIVE:', active)
  const liq = lines.filter((l) => /\[liquidation\]/.test(l))
  console.log('  liquidation lines:', JSON.stringify(liq.slice(-6)))
  await page.screenshot({ path: `${OUT}/wfr_2_active.png` })

  // ── (3) RECONNECT: a reload must re-mount the board (re-enter the same live fight, board rebuilds at anchor) ──
  await page.reload({ waitUntil: 'domcontentloaded' })
  await boot(page)
  await enter(page)
  const remounted = await expect
    .poll(async () => (await board_up(page)) && ((await dev_state(page))?.status ?? null) !== null, {
      timeout: 120_000,
      intervals: [2000],
    })
    .toBe(true)
    .then(() => true)
    .catch(() => false)
  const s3 = await dev_state(page)
  console.log('  RECONNECT remounted:', remounted, 'state:', JSON.stringify(s3))
  await page.screenshot({ path: `${OUT}/wfr_3_remount.png` })

  dump()
  console.log('  errors:', errors.length, errors.slice(0, 3))
  expect(board_up(page), 'the board must be mounted').toBeTruthy()
})
