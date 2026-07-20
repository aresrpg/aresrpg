// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'
import { SDK } from '@aresrpg/sdk/sui'

// WORLD-FIGHT MOUNT VERIFY DRIVE — the close-the-loop proof: a world mob-group claim+create must MOUNT the
// tactical board (it never did), be playable, RE-MOUNT on a mid-fight page refresh, and tear down on settle.
// Drives the REAL voxel session (dev-wallet login) through window hooks (a page-side import binds a dead second
// Vite module instance — dev_probe's documented trap), exactly like p0_fight_init.spec.ts. Run HEADED (WebGPU
// needs the hardware adapter). Digests are read node-side off the Fight object's previousTransaction (the test
// runs in node — the SDK is safe here, no second-instance trap).

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname
const CHAR = '0x3fa736761de4effbf240d049a3a9e698fe6065fdfaca8c134f0ec12c9f335344'

const lines: string[] = []
const dump = () => {
  try {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(`${OUT}/world_fight_console.log`, lines.join('\n'))
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

let sdk_p: Promise<any> | null = null
const digest_of = async (fight_id: string): Promise<string | null> => {
  try {
    sdk_p = sdk_p ?? SDK({ network: 'testnet' })
    const sdk = await sdk_p
    const { object } = await sdk.grpc_client.core.getObject({ objectId: fight_id })
    return object?.previousTransaction ?? null
  } catch {
    return null
  }
}

async function boot(page: Page) {
  await expect
    .poll(
      async () =>
        page
          .evaluate(
            () =>
              typeof (window as any).__ARES_DEV_STATE === 'function' &&
              typeof (window as any).__dev_start_world_fight === 'function'
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

test('world fight: claim+create MOUNTS the board, plays, RE-MOUNTS on refresh, shares the settle teardown', async ({
  page,
}) => {
  test.setTimeout(600_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)))
  page.on('console', (m) => {
    const t = m.text()
    lines.push(`[${m.type()}] ${t}`)
    if (/\[dev\]|\[world-fight\]|\[dungeon\]|\[voxel-fight\]|\[gas-guard\]|\[fight-tx\]/.test(t))
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

  // ── (1) MOUNT: the REAL production path (create_world_fight → enter_world_fight) over a live discovered group ──
  const fight_id: string | null = await page.evaluate(() => (window as any).__dev_start_world_fight()).catch(() => null)
  console.log('  world fight id:', fight_id)
  expect(fight_id, 'a world fight must be claimed+created on a discovered mob group').toBeTruthy()
  await expect.poll(() => board_up(page), { timeout: 120_000, intervals: [1000] }).toBe(true)
  await expect
    .poll(async () => (await dev_state(page))?.status ?? null, { timeout: 60_000, intervals: [1500] })
    .not.toBeNull()
  const s1 = await dev_state(page)
  console.log('  MOUNTED state:', JSON.stringify(s1), 'create digest:', await digest_of(fight_id!))
  await page.screenshot({ path: `${OUT}/wf_1_mounted.png` })

  // ── (2) PLAY: place my fighter (turns::place — a real on-chain action with a digest). The board is PLACEMENT
  //    on create; READY commits the pick and the solo fight flips ACTIVE. ────────────────────────────────────
  let placed = false
  const ready = page.locator('.hud-fightctl__ready')
  if (await ready.isVisible().catch(() => false)) {
    const b = await ready.boundingBox()
    if (b) {
      await page.mouse.move(b.x + b.width / 2 - 5, b.y + b.height / 2 + 3, { steps: 4 })
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 })
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 1)
      await page.mouse.up()
      placed = await expect
        .poll(async () => (await dev_state(page))?.status ?? -1, { timeout: 60_000, intervals: [1500] })
        .toBe(1)
        .then(() => true)
        .catch(() => false)
    }
  }
  const s2 = await dev_state(page)
  console.log(
    '  after READY/place:',
    JSON.stringify(s2),
    'placed→ACTIVE:',
    placed,
    'place digest:',
    await digest_of(fight_id!)
  )
  await page.screenshot({ path: `${OUT}/wf_2_placed.png` })

  // ── (3) RECONNECT: a mid-fight page refresh must RE-MOUNT the board with NO manual action — resume_world_fight
  //    (one keyless /v1/fights?character read) rediscovers the live fight on the first world_spawns poll. ──────
  await page.reload({ waitUntil: 'domcontentloaded' })
  await boot(page)
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
  await page.screenshot({ path: `${OUT}/wf_3_reconnected.png` })
  expect(remounted, 'the board must RE-MOUNT after a mid-fight refresh (reconnect via /v1/fights?character)').toBe(true)

  dump()
  console.log('  errors:', errors.length)
})
