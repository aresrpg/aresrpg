// SCRATCH capture — the equipped HAT + CLOAK proof (not part of the bench suite). Films the
// worn_cosmetics_showcase with the REAL create_worn_cosmetics rig (the aresrpg-legacy equip_hat/equip_cape
// mechanism transcribed: Head/cape bone children) on the real create_character_avatar rig — the SAME engine
// capability embed_voxel_player.js drives live. Assets are the ACTUAL authored GLBs served straight
// off ./models by a page.route (no committed demo binaries): cape_fuwa + solomonk are LEGACY-authored (raw
// bone-child, zero transform — legacy entities.js:101-137), sui_helmet is the NEW asset with the approved
// measured fit. Runtime provenance: worn.mounted() carries each slot's real mesh names + bone + mode.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN, probe_gpu_adapter } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts/worn'
const VIDEO_DIR = '/tmp/aresrpg-engine-artifacts/worn/video_raw'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
// /worn/<name>.glb → the real GLB on disk (the authored shop-cosmetic equipment folder).
const WORN_ON_DISK = {
  'cape_fuwa.glb': path.join(REPO, 'models/equipment/cape_fuwa.glb'),
  'solomonk.glb': path.join(REPO, 'models/equipment/solomonk.glb'),
}

/** Serve the routed /worn/* GLBs from ./models so no demo binary is committed (USE-THE-ACTUAL-ASSETS). */
async function route_worn(page) {
  await page.route('**/worn/*.glb', async (route) => {
    const name = route.request().url().split('/').pop()
    const file = WORN_ON_DISK[name]
    if (!file) return route.fulfill({ status: 404, body: 'not routed' })
    return route.fulfill({ contentType: 'model/gltf-binary', body: await readFile(file) })
  })
}

const HARNESS = '/demo/worn_cosmetics_showcase.html?head=/sui_helmet.glb&back=/worn/cape_fuwa.glb'

test('worn hat + cloak — sui_helmet (fitted) + cape_fuwa (legacy raw) orbit + provenance', async ({ browser }) => {
  await mkdir(OUT, { recursive: true })
  await mkdir(VIDEO_DIR, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 960, height: 960 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 960, height: 960 } },
  })
  const page = await context.newPage()
  await route_worn(page)
  await page.goto(`${DEMO_ORIGIN}${HARNESS}&face=0&period=9`) // face=0 ⇒ front view at orbit centre
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 })
  const gpu = await probe_gpu_adapter(page)
  expect(gpu.ok, `hardware GPU required: ${gpu.reason ?? ''}`).toBe(true)

  // RUNTIME PROVENANCE — each slot mounted on its legacy bone with the real asset's mesh names.
  const info = await page.evaluate(() => window.__info())
  console.log('[worn] info:', JSON.stringify(info))
  await writeFile(path.join(OUT, 'info.json'), JSON.stringify(info, null, 2))
  expect(info.worn.head, 'hat must mount').toBeTruthy()
  expect(info.worn.back, 'cloak must mount').toBeTruthy()
  expect(info.worn.head.bone, 'hat rides the Head bone (legacy equip_hat)').toMatch(/head/i)
  expect(info.worn.back.bone, 'cloak rides the cape bone (legacy equip_cape)').toMatch(/cape/i)
  expect(info.worn.head.mode, 'sui_helmet uses its approved measured fit').toBe('fitted')
  expect(info.worn.back.mode, 'cape_fuwa mounts raw like legacy').toBe('raw')

  for (const [name, tt] of [
    ['front', 0],
    ['right45', 2.25],
    ['left45', 6.75],
  ]) {
    await page.evaluate((t) => window.__seek(t), tt)
    await page.waitForTimeout(120)
    await page.screenshot({ path: path.join(OUT, `worn_${name}.png`) })
  }

  await page.waitForTimeout(9000) // one natural orbit for the webm (idle sway + orbit)
  await page.close()
  await context.close() // video flushes on context close
  const files = await readdir(VIDEO_DIR)
  const webm = files.find((f) => f.endsWith('.webm'))
  expect(webm, 'no video produced').toBeTruthy()
  await rename(path.join(VIDEO_DIR, webm), path.join(OUT, 'worn_hat_cloak_orbit.webm'))
})

test('worn cloak — BACK view (the cape drapes the back, legacy π-flip)', async ({ browser }) => {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 960, height: 960 } })
  const page = await context.newPage()
  await route_worn(page)
  // face AWAY from the camera (π) so the orbit-centre frame shows the avatar's BACK — the cloak's home angle.
  await page.goto(`${DEMO_ORIGIN}${HARNESS}&face=${Math.PI}&period=9`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 })
  const gpu = await probe_gpu_adapter(page)
  expect(gpu.ok, `hardware GPU required: ${gpu.reason ?? ''}`).toBe(true)
  await page.evaluate(() => window.__seek(0))
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(OUT, 'worn_back.png') })
  await page.close()
  await context.close()
})

test('worn hat — a LEGACY-authored hat mounts raw (solomonk, zero transform)', async ({ browser }) => {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 960, height: 960 } })
  const page = await context.newPage()
  await route_worn(page)
  await page.goto(`${DEMO_ORIGIN}/demo/worn_cosmetics_showcase.html?head=/worn/solomonk.glb&face=0&period=9`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 })
  const gpu = await probe_gpu_adapter(page)
  expect(gpu.ok, `hardware GPU required: ${gpu.reason ?? ''}`).toBe(true)
  const info = await page.evaluate(() => window.__info())
  console.log('[worn] solomonk info:', JSON.stringify(info))
  expect(info.worn.head.mode, 'a legacy-authored hat mounts raw').toBe('raw')
  await page.evaluate(() => window.__seek(0))
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(OUT, 'worn_solomonk_raw.png') })
  await page.close()
  await context.close()
})
