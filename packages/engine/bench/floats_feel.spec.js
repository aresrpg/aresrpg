// [W7] FLOATING COMBAT NUMBERS — feel proof (headed WebGPU, isolated port).
//
// Owner FEEL DEMAND (2026-07-11, live fight): "floating numbers too small and not bouncy enough." Boots
// the ?board=1 demo (the SAME locked-iso fight camera + entity API the real dungeon board uses —
// board_entities.js), scripts floats via board.entity_beat (the EXACT call shape the app's own
// __ARES_DEV_FLOAT dev hook uses: anim:'hit' + a float payload — the float spawns at the clip's IMPACT
// frame, ~0.3×ATTACK's real clip duration after the call, NOT at call time — hit() below fires it WITHOUT
// awaiting that promise so multiple hits land back-to-back instead of serializing behind each other's
// impact delay). Two independent tests (separate browser contexts/GPU devices, so one's WebGPU state can't
// sink the other) capture stills proving:
//   • SIZE reads clearly at a legible fight-camera-like distance, and scales with magnitude (small tick <
//     big hit < crit top-band, crit with its distinct gold glow);
//   • a multi-target burst (one beat landing on 2 entities at once) FANS OUT via the ~80ms stagger instead
//     of clumping as one instant; heal reads in the house green.
// Runs against ARES_DEMO_ORIGIN (an isolated vite instance) — NEVER the main dev :5199/:5173. Artifacts →
// /tmp (throwaway proof stills, not committed).

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

const ORIGIN = process.env.ARES_DEMO_ORIGIN || 'http://localhost:5261'
const URL = `${ORIGIN}/demo/index.html?board=1`
const ART = '/tmp/aresrpg-engine-artifacts/floats_feel'
const VIEWPORT = { width: 1440, height: 900 }

/** Boots the board demo, clusters the 4 demo entities + dollies in tight (this demo's default p1/p2 vs
 *  m1/m2 layout sits in OPPOSITE corners of a 12×10 board — no single camera pose frames all 4 legibly at
 *  the demo's default wide span·1.7≈41m dolly), and returns { page, hit, shoot }. @param {import('@playwright/test').Browser} browser */
async function boot(/** @type {import('@playwright/test').Browser} */ browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(URL)

  const adapter = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return { ok: false, reason: 'no navigator.gpu' }
    // @ts-expect-error browser-only
    const a = await navigator.gpu.requestAdapter()
    return a ? { ok: true } : { ok: false, reason: 'no adapter' }
  })
  expect(adapter.ok, `WebGPU adapter: ${JSON.stringify(adapter)}`).toBe(true)

  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 40000 }).catch(async () => {
    throw new Error(`board never mounted — gate: "${await page.locator('#gate').textContent()}"`)
  })
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__board?._descriptor?.()), null, { timeout: 20000 })

  await page.evaluate(() => {
    const b = /** @type {any} */ (window).__board
    b.entity_upsert({ id: 'p1', kind: 'player', cell: { x: 6, y: 2 }, facing: 'south' })
    b.entity_upsert({ id: 'p2', kind: 'player', cell: { x: 7, y: 2 }, facing: 'south' })
    b.entity_upsert({ id: 'm1', kind: 'mob', cell: { x: 6, y: 3 }, facing: 'north' })
    b.entity_upsert({ id: 'm2', kind: 'mob', cell: { x: 7, y: 3 }, facing: 'north' })
    b.camera_rig.dolly_to(12)
  })
  await page.waitForTimeout(1500) // camera settle + avatar GLB load

  const shoot = (/** @type {string} */ name) => page.screenshot({ path: `${ART}/${name}.png` })
  /** Fires entity_beat WITHOUT awaiting its returned promise (only resolves at the impact frame) — so
   *  several hit() calls land back-to-back instead of serializing behind each other's impact delay. */
  const hit = (/** @type {string} */ id, /** @type {string} */ text, /** @type {string} */ kind) =>
    page.evaluate(
      ({ id, text, kind }) => {
        const board = /** @type {any} */ (window).__board
        board.entity_beat(id, { anim: 'hit', float: { text, kind } })
      },
      { id, text, kind }
    )

  return { page, hit, shoot }
}

test.describe('[W7] floating combat numbers — size + spring feel', () => {
  test('size curve: small < large < crit (top band + gold glow)', async ({ browser }) => {
    test.setTimeout(60000)
    await mkdir(ART, { recursive: true })
    const { page, hit, shoot } = await boot(browser)

    await hit('p2', '-3', 'damage') // small tick — near the scale floor
    await hit('m1', '-45', 'damage') // large hit — near the scale ceiling
    await hit('m2', '-68', 'crit') // crit — the top band + gold glow
    await page.waitForTimeout(750) // ~590ms impact delay + ~160ms — near the spring's overshoot peak
    await shoot('01_size_curve_pop')
    await page.waitForTimeout(400) // fully settled, still hanging at full opacity — clean size read
    await shoot('02_size_curve_settled')
  })

  test('heal color + a 2-target burst fans out via the stagger', async ({ browser }) => {
    test.setTimeout(60000)
    await mkdir(ART, { recursive: true })
    const { page, hit, shoot } = await boot(browser)

    await hit('p1', '+22', 'heal')
    await page.waitForTimeout(750)
    await shoot('03_heal_pop')
    await page.waitForTimeout(1200) // fully expire before the next scenario

    // one beat landing on 2 entities in the SAME tick: the shared burst clock must fan them ~80ms apart.
    await hit('p1', '-5', 'damage')
    await hit('m1', '-30', 'crit')
    await page.waitForTimeout(650)
    await shoot('04_burst_pre_impact')
    await page.waitForTimeout(90)
    await shoot('05_burst_t90ms')
    await page.waitForTimeout(300)
    await shoot('06_burst_settled')
  })
})
