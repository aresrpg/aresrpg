// MANDATE COOP DRIVE harness — one browser, two seats, real input. Port 5340 @ served tip 8dc6107e.
import fs from 'node:fs'
import { chromium } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

export const BASE = 'http://localhost:5340'
export const SHOTS = '/private/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/mcd_shots'
export const RPC = 'https://rpc.aresrpg.world'
const KEYS = JSON.parse(fs.readFileSync('/Users/sceatstudio/dev/aresrpg/.dev/keys.json', 'utf8'))

fs.mkdirSync(SHOTS, { recursive: true })

export const secret_of = name => (typeof KEYS[name] === 'string' ? KEYS[name] : KEYS[name]?.secret || KEYS[name]?.key)
export const address_of = name =>
  Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secret_of(name)).secretKey).getPublicKey().toSuiAddress()

export const launch = async () =>
  chromium.launch({ headless: false, args: ['--window-size=1280,860', '--enable-unsafe-swiftshader'] })

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
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`))
  page.on('console', m => {
    const line = `${m.type()}: ${m.text().slice(0, 500)}`
    console_all.push(line)
    if (m.type() === 'error') console_errors.push(`[console.error] ${m.text().slice(0, 500)}`)
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

const jget = async url => {
  const r = await fetch(url)
  const t = await r.text()
  if (!t) return {}
  try {
    return JSON.parse(t)
  } catch {
    return {}
  }
}
export const fights_of_world = async world => (await jget(`${RPC}/v1/fights?world=${world}`)).fights || []
export const fights_of_character = async ch => (await jget(`${RPC}/v1/fights?character=${ch}`)).fights || []
export const fight_by_id = async id => ((await jget(`${RPC}/v1/fights?id=${id}`)).fights || [])[0] || null

/** DEV_STATE snapshot of a seat's LIVE stores. */
export const dev_state = page => page.evaluate(() => window.__ARES_DEV_STATE?.() ?? null)

/**
 * CHAIN TRUTH via the keyless read layer (`/v1/fights?id=`) — the same projection the client reads.
 * A page-context `import('@aresrpg/sdk/fight')` cannot resolve a BARE specifier (Vite dev serves the
 * app's own graph, not the importmap), so the SDK decode path is not available to a driver. /v1 is.
 */
export const chain_read = async (_page, fight_id) => {
  const f = await fight_by_id(fight_id)
  if (!f) return { err: 'fight not on /v1', now: Date.now() }
  return {
    status_label: f.status,
    participants: (f.participants || []).length,
    seats: (f.participants || []).map(p => `${p.character.slice(0, 10)}#${p.seat}`),
    characters: (f.participants || []).map(p => p.character),
    current_turn: f.current_turn ?? null,
    mob_count: f.mob_count,
    public_fight: f.public,
    journal_head: f.journal_head,
    now: Date.now(),
  }
}

/** Every visible text node of the page, joined — the Bar-2 address scan surface. */
export const visible_text = page =>
  page.evaluate(() => {
    const out = []
    const walk = el => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          const t = (n.textContent || '').trim()
          const p = n.parentElement
          if (t && p && p.getBoundingClientRect().width > 0 && getComputedStyle(p).visibility !== 'hidden')
            out.push(t)
        } else if (n.nodeType === 1 && getComputedStyle(n).display !== 'none') walk(n)
      }
    }
    walk(document.body)
    return out
  })
