// #1645 WITNESS — lane-local instrumentation, NEVER landed.
// Decides the SILENT BUSY REFUSAL hypothesis: does enter_world_fight return 'busy' and leave the board
// unrendered when a seat boots carrying a live/stale chain fight and immediately presses [R] on a new group?
//
// It drives the REAL player door: a real KeyR keydown into the PromptStack's ONE listener, whose 'attack'
// prompt on_trigger IS world_spawns' engage(). The DEV seam __dev_start_world_fight is used ONLY to
// engineer the stale fight in phase A — it calls reset_local() when busy, so it can never witness the bug.
//
// Every attempt APPENDS to its own log file. Nothing here is ever overwritten.

import { appendFileSync, mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'

import { open_page, await_seams, wait_for } from './fight_bot/seam.mjs'
import { seat_key, address_of } from './fight_bot/world_surface.mjs'

const BASE = process.env.WITNESS_BASE ?? 'http://localhost:5181/'
const KEYS = process.env.FIGHT_BOT_KEYS ?? '/Users/sceatstudio/dev/aresrpg/.dev/keys.json'
const OUT = process.env.WITNESS_OUT ?? '/private/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/witness'
const ATTEMPT = process.env.WITNESS_ATTEMPT ?? '1'
const URL = `${BASE}game-world?dev&fighttrace=1&debug=1`

mkdirSync(OUT, { recursive: true })
const LOG = `${OUT}/attempt_${ATTEMPT}.log`
const log = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
  console.log(line)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const witness = (page) =>
  page.evaluate(() => (window.__ARES_DEV_WITNESS ? window.__ARES_DEV_WITNESS() : { error: 'NO_WITNESS_HOOK' })).catch((e) => ({ error: String(e) }))
const trace = (page) => page.evaluate(() => window.__ARES_FIGHT_TRACE ?? []).catch(() => [])

/** Boot one authenticated world page. Returns the page + its console capture. */
const boot = async (browser, secret, tag) => {
  const { page, console_lines, client } = await open_page(browser, { dev_key: secret })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ares_tutorial_seen_v2', '1')
      localStorage.setItem('ares_tutorial_seen', '1')
      localStorage.setItem('ares_debug', '1')
    } catch {
      /* storage blocked */
    }
  })
  const t0 = Date.now()
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240_000 })
  await page.waitForSelector('canvas', { timeout: 240_000 })
  log(`[${tag}] canvas at +${Date.now() - t0}ms`)
  await await_seams(client, page, URL, { log: (m) => log(`[${tag}] ${m}`), console_lines })
  log(`[${tag}] seams live at +${Date.now() - t0}ms`)
  const character = await page
    .waitForFunction(
      async () => {
        const { context } = await import('/src/game/store.js')
        return context.get_state().selected_character_id ?? false
      },
      null,
      { timeout: 240_000, polling: 1000 }
    )
    .then((h) => h.jsonValue())
  log(`[${tag}] character ${character} at +${Date.now() - t0}ms`)
  return { page, console_lines, client, character, boot_ms: t0 }
}

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const secret = seat_key(KEYS, 'alice')
log(`=== ATTEMPT ${ATTEMPT} — alice ${address_of(secret)} — ${URL}`)

try {
  // ── PHASE A — engineer a live/stale chain fight, killed mid-placement without settling ──────────────────
  log('--- PHASE A: engineering the stale fight ---')
  const a = await boot(browser, secret, 'A')
  log('[A] pre-create witness', await witness(a.page))
  const stale_fight = await a.page.evaluate(() => window.__dev_start_world_fight()).catch((e) => ({ error: String(e) }))
  log('[A] __dev_start_world_fight →', stale_fight)
  if (!stale_fight || typeof stale_fight !== 'string') {
    log('[A] NO FIGHT CREATED — cannot engineer the stale seat this attempt')
  } else {
    const placed = await wait_for(a.client, (r) => r.placement === true, { timeout_ms: 120_000 })
    log('[A] placement window open:', !!placed)
    log('[A] witness at kill time', await witness(a.page))
    log('[A] trace at kill time', await trace(a.page))
  }
  // KILL — the page dies mid-placement. No settle, no forfeit: the chain keeps the live fight.
  await a.page.close()
  log('[A] page KILLED (no settle, no forfeit) — stale fight left live on chain')

  // ── PHASE B — relaunch and press [R] on a NEW group as fast as the world allows ─────────────────────────
  log('--- PHASE B: relaunch + immediate [R] ---')
  const b = await boot(browser, secret, 'B')
  const press_deadline = Date.now() + 60_000
  let armed = null
  // The [R] pill arms on proximity. Take the FIRST frame it exists — waiting for a "nicer" moment would
  // hand the async resume leg the time the race is about.
  while (Date.now() < press_deadline) {
    const w = await witness(b.page)
    const attack = (w.prompts ?? []).find((p) => p.id === 'attack')
    if (attack) {
      armed = { at: Date.now(), prompt: attack, witness: w }
      break
    }
    await sleep(250)
  }
  if (!armed) {
    log('[B] NO [R] ATTACK PROMPT ARMED within 60s — no group in engage range')
    log('[B] witness at give-up', await witness(b.page))
  } else {
    log('[B] PRE-PRESS witness', armed.witness)
    log('[B] PRE-PRESS trace', await trace(b.page))
    log(`[B] [R] pill armed: ${JSON.stringify(armed.prompt)} — pressing NOW`)
    await b.page.keyboard.press('KeyR') // the REAL gesture, through the ONE keydown listener
    log('[B] AT-PRESS witness', await witness(b.page))
  }

  // ── RECORD: every 5s for 180s ───────────────────────────────────────────────────────────────────────────
  const start = Date.now()
  let mark = b.console_lines.length
  for (let i = 0; i < 37 && Date.now() - start < 185_000; i++) {
    const w = await witness(b.page)
    log(`[B] t+${Math.round((Date.now() - start) / 1000)}s`, w)
    const fresh = b.console_lines.slice(mark)
    mark = b.console_lines.length
    const notable = fresh.filter((l) =>
      /enter refused|fight_create_adopt|fight_adoption|fight_resume|fight_state|world-fight|world-spawns|busy|error/i.test(l)
    )
    if (notable.length) log(`[B]   console:`, notable.join(' || '))
    await sleep(5000)
  }
  log('[B] FINAL witness', await witness(b.page))
  log('[B] FINAL trace', await trace(b.page))
  await b.page.screenshot({ path: `${OUT}/attempt_${ATTEMPT}_final.png`, fullPage: false }).catch(() => {})
  log('--- FULL CONSOLE (phase B) ---')
  log(b.console_lines.join('\n'))
} catch (error) {
  log('DRIVE ERROR', String(error?.stack ?? error))
} finally {
  await browser.close()
  log(`=== ATTEMPT ${ATTEMPT} END`)
}
