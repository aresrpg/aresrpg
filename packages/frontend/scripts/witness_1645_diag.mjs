// #1645 witness — DIAGNOSTIC: why can this seat not reach a mob group? Lane-local, never landed.
import { appendFileSync, mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'

import { open_page, await_seams } from './fight_bot/seam.mjs'
import { seat_key, address_of } from './fight_bot/world_surface.mjs'

const BASE = 'http://localhost:5181/'
const KEYS = '/Users/sceatstudio/dev/aresrpg/.dev/keys.json'
const OUT = '/private/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/witness'
const URL = `${BASE}game-world?dev&fighttrace=1&debug=1`
mkdirSync(OUT, { recursive: true })
const LOG = `${OUT}/diag.log`
const log = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
  console.log(line)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const secret = seat_key(KEYS, 'alice')
log(`=== DIAG alice ${address_of(secret)}`)
const { page, console_lines, client } = await open_page(browser, { dev_key: secret })
await page.addInitScript(() => {
  try {
    localStorage.setItem('ares_tutorial_seen_v2', '1')
    localStorage.setItem('ares_tutorial_seen', '1')
    localStorage.setItem('ares_debug', '1')
  } catch {}
})
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240_000 })
await page.waitForSelector('canvas', { timeout: 240_000 })
await await_seams(client, page, URL, { log, console_lines })
await page.waitForFunction(
  async () => {
    const { context } = await import('/src/game/store.js')
    return context.get_state().selected_character_id ?? false
  },
  null,
  { timeout: 240_000, polling: 1000 }
)
log('booted')

// WHERE IS THE PLAYER, and what has the world actually placed around them?
const world_probe = () =>
  page
    .evaluate(() => {
      const pos = window.__voxel_avatar?.()?.position ?? null
      return {
        player: pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null,
        prompts: Object.values(
          // read through the SAME registered hook (a page-side import would be a second module instance)
          window.__ARES_DEV_WITNESS ? { p: window.__ARES_DEV_WITNESS().prompts } : { p: [] }
        )[0],
      }
    })
    .catch((e) => ({ error: String(e) }))

for (let i = 0; i < 12; i++) {
  log(`t+${i * 5}s`, await world_probe())
  await sleep(5000)
}

log('--- firing __dev_start_world_fight (capturing every refusal) ---')
const mark = console_lines.length
const result = await page.evaluate(() => window.__dev_start_world_fight()).catch((e) => ({ error: String(e) }))
log('result:', result)
log('--- console since the call ---')
log(console_lines.slice(mark).join('\n'))
log('--- witness ---')
log(await page.evaluate(() => window.__ARES_DEV_WITNESS()).catch((e) => ({ error: String(e) })))
await page.screenshot({ path: `${OUT}/diag.png` }).catch(() => {})
await browser.close()
log('=== DIAG END')
