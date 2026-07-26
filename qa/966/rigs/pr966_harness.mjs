// PR #966 verification harness — one browser, real input, port 5310 (lane/placement-resume-2 @ 695dab7d).
import fs from 'node:fs'
import { chromium } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

export const BASE = 'http://localhost:5310'
export const SHOTS =
  '/private/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/pr966_shots'
export const RPC = 'https://rpc.aresrpg.world'
const KEYS = JSON.parse(fs.readFileSync('/Users/sceatstudio/dev/aresrpg/.dev/keys.json', 'utf8'))

fs.mkdirSync(SHOTS, { recursive: true })

export const secret_of = name => (typeof KEYS[name] === 'string' ? KEYS[name] : KEYS[name]?.secret || KEYS[name]?.key)
export const address_of = name =>
  Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secret_of(name)).secretKey).getPublicKey().toSuiAddress()

export const launch = async () =>
  chromium.launch({ headless: false, args: ['--window-size=1280,860', '--enable-unsafe-swiftshader'] })

/** THE REGRESSION-BAR WATCHLIST (#966 bar 4) — every string the client emits when it RELEASES the character
 *  or announces the fight cleared. Any hit while the seat is LIVE on chain is the worse-symptom regression. */
export const RELEASE_SIGNALS = [
  /already resolved/i, // the expired_fight_cleared toast copy (en)
  /your character is free/i,
  /resume rejected — persisted Fight is/i, // _recover_dead_fight_reference game_log
  /fight_resume_expired_gone/i, // the trace on the gone branch
  /Dungeon fight is (settled|absent)/i, // the liveness-gate release
  /_recover_dead_fight_reference/i,
]
export const REFUSAL_SIGNAL = /resume refused/i

export const hits = (lines, res) =>
  lines.filter(l => (Array.isArray(res) ? res : [res]).some(r => r.test(l)))

/** A named seat: own context, dev key injected pre-navigation, FULL console + page errors captured, timestamped. */
export async function seat(browser, { name, key, viewport = { width: 1280, height: 800 } }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const errors = []
  const console_errors = []
  const console_all = []
  const page = await ctx.newPage()
  await page.addInitScript(secret => {
    window.__ARES_DEV_KEY = secret
    window.__TX_TIMINGS = window.__TX_TIMINGS || []
  }, secret_of(key))
  page.on('pageerror', e => {
    const line = `${ts().slice(11, 23)} [pageerror] ${e.message}`
    errors.push(line)
    console_all.push(line)
  })
  page.on('console', m => {
    const line = `${ts().slice(11, 23)} ${m.type()}: ${m.text().slice(0, 600)}`
    console_all.push(line)
    if (m.type() === 'error') console_errors.push(line)
  })
  return {
    name,
    key,
    address: address_of(key),
    ctx,
    page,
    errors,
    console_errors,
    console_all,
    shot: async label => {
      const path = `${SHOTS}/${name}_${label}.png`
      await page.screenshot({ path })
      return path
    },
    digests: async () => page.evaluate(() => (window.__TX_TIMINGS || []).map(r => r.digest).filter(Boolean)),
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function until(fn, { timeout = 60000, interval = 1000, label = 'condition' } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return true
    } catch {
      /* transient */
    }
    await sleep(interval)
  }
  console.log(`  [timeout] ${label} after ${timeout}ms`)
  return false
}

export const ts = () => new Date().toISOString()
export const log = (...a) => console.log(`[${ts().slice(11, 23)}]`, ...a)

/** /v1 fights (chain projection through the keyless read layer). */
export const fights_of_world = async world =>
  (await fetch(`${RPC}/v1/fights?world=${world}`).then(r => r.json())).fights || []
export const fights_of_character = async ch =>
  (await fetch(`${RPC}/v1/fights?character=${ch}`).then(r => r.json())).fights || []

/** RAW chain read of a Fight through the app's own read layer — NO bare specifiers (the browser cannot
 *  resolve '@aresrpg/sdk/fight'; only '/src/...' graph paths and window hooks work in page.evaluate).
 *  Status scalars are the CHAIN namespace per fight_chain_status.js: placement=0, active=1 — NOT the
 *  board_state view namespace where placement=5. */
export const chain_read = (page, fight_id) =>
  page.evaluate(async id => {
    try {
      const [{ read_object }, sdkmod] = await Promise.all([
        import('/src/world-shell/run_reads.js'),
        import('/src/chain/sdk.ts').catch(() => import('/src/chain/sdk')),
      ])
      const raw = await read_object(await sdkmod.get_sdk(), id)
      const j = raw?.json ?? null
      if (!j) return { status: null, gone: true, now: Date.now() }
      const parts = j.participants ?? j.fighters ?? []
      return JSON.parse(
        JSON.stringify({
          status: Number(j.status),
          placement_deadline_ms: Number(j.placement_deadline_ms ?? 0),
          turn_deadline_ms: Number(j.turn_deadline_ms ?? 0),
          now: Date.now(),
          seats: parts.length,
          seat_owners: parts.map(p => (p?.fields ?? p)?.owner ?? null),
          seat_characters: parts.map(p => (p?.fields ?? p)?.character ?? null),
        })
      )
    } catch (e) {
      return { err: String(e?.message || e) }
    }
  }, fight_id)

/** ISO of a possibly-missing epoch-ms (never throws RangeError on an undefined deadline). */
export const iso = ms => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : 'n/a')

/** LIVE-instance store snapshot (window hook — a Playwright-side /src import gets a DEAD 2nd Vite instance). */
export const dev_state = page => page.evaluate(() => window.__ARES_DEV_STATE?.() ?? null)
export const board_up = async page => {
  const st = await dev_state(page)
  return !!st && st.status != null
}

/** Visible toast copy in the DOM — the user-facing half of the regression bar. */
export const toasts_of = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('[class*="toast"]')]
      .map(e => (e.innerText || '').replace(/\n+/g, ' ').trim())
      .filter(Boolean)
  )
