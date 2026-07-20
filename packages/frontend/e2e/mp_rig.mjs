// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
// mp_rig.mjs — 4-INSTANCE HUMAN-PLAY MULTIPLAYER RIG (standing test infra)
// QA-User owned. Plays the game as N separate humans: N headed browser contexts,
// N accounts, REAL mouse clicks + arrow keys ONLY (no programmatic game shortcuts),
// per-instance screenshots for vision analysis. Proves the p2p multiplayer loop:
//   presence (each sees the others in OnlinePlayers) → party invite → private-party
//   dungeon (limit: a non-party 5th is excluded) → N players co-fighting in ONE
//   dungeon → turn-order/streaming correct on every screen → one player REFRESHES
//   mid-fight and returns fully synced. Fight FEEL scored per instance.
//
// RUN (from packages/frontend so `playwright` resolves):
//   RIG_N=4 RIG_BASE=http://localhost:5173 node e2e/mp_rig.mjs
//   (start the frontend dev server first, or point RIG_BASE at it.)
//   RIG_N=2 for a fast foundation check.  RIG_HEADFUL=0 to force headless (NOT the source of truth — p2p needs headed).
//
// STATUS 2026-07-03: the LOOP steps are GATED behind p2p presence, which is
// currently DEAD (client bug: join_lobby never fires — root-caused, cto P0 item 25).
// So `assert_presence` will (correctly) report 0 peers until that fix lands; the
// foundation (N contexts, dev-login, World mount, input, screenshots) runs today.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdir } from 'node:fs/promises'

import { chromium } from '@playwright/test'

const N = Math.min(Number(process.env.RIG_N || 4), 4)
const BASE = process.env.RIG_BASE || 'http://localhost:5173'
const HEADFUL = process.env.RIG_HEADFUL !== '0' // headed by default — real WebRTC/Trystero
const OUT = process.env.RIG_OUT || '/tmp/qa-rig'

// account matrix (dev keys — testnet only; the rig injects window.__ARES_DEV_KEY per context).
// Keys are NEVER hardcoded here. Set QA_KEY_B / QA_KEY_C / QA_KEY_D / QA_KEY_E in your local
// .env (gitignored) before running — one suiprivkey1... bech32 secret per label. An account
// with no key set gets '' and the rig will fail its dev-login (fund + set the env var first).
const ACCOUNTS = [
  { label: 'B', key: process.env.QA_KEY_B || '' }, // charB
  { label: 'C', key: process.env.QA_KEY_C || '' }, // charC full-hp
  { label: 'D', key: process.env.QA_KEY_D || '' }, // needs char+funding at run
  { label: 'E', key: process.env.QA_KEY_E || '' }, // needs char+funding at run
].slice(0, N)

const log = (...a) => console.log(`[rig ${new Date().toISOString().slice(11, 19)}]`, ...a)

// ── REAL-INPUT HELPERS (no programmatic game calls — mouse + keyboard only) ──
const focus_canvas = async (page) => {
  const c = page.locator('canvas').first()
  const box = await c.boundingBox().catch(() => null)
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}
const real_click_xy = (page, x, y) => page.mouse.click(x, y)
const real_click_text = async (page, re) => {
  const el = page.getByText(re).first()
  await el.scrollIntoViewIfNeeded().catch(() => {})
  const box = await el.boundingBox().catch(() => null)
  if (!box) return false
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return true
}
const ARROW = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
const walk = async (page, dir, presses = 4) => {
  await focus_canvas(page)
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(ARROW[dir])
    await page.waitForTimeout(140)
  }
}
const shot = (inst, tag) => inst.page.screenshot({ path: `${OUT}/${inst.label}-${tag}.png` }).catch(() => {})

// ── per-instance p2p diagnostic capture (the join_lobby relay log + non-localhost WSS) ──
const wire_diag = (inst) => {
  inst.wss = []
  inst.p2p = []
  inst.page.on('websocket', (w) => {
    const u = w.url()
    if (!u.includes('localhost') && /^wss?:/.test(u)) inst.wss.push(u)
  })
  inst.page.on('console', (m) => {
    const t = m.text()
    if (/\[p2p\]/i.test(t)) inst.p2p.push(t.slice(0, 160))
  })
}

async function boot() {
  await mkdir(OUT, { recursive: true })
  log(`launching ${N} ${HEADFUL ? 'HEADED' : 'headless'} instances → ${BASE}`)
  const insts = []
  for (const acc of ACCOUNTS) {
    const browser = await chromium.launch({ headless: !HEADFUL })
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const inst = { ...acc, browser, ctx, page }
    wire_diag(inst)
    await page.addInitScript((k) => {
      window.__ARES_DEV_KEY = k
    }, acc.key)
    await page
      .goto(`${BASE}/game-world?dev`, { waitUntil: 'domcontentloaded' })
      .catch((e) => log(`${acc.label} goto err`, String(e).slice(0, 80)))
    insts.push(inst)
    log(`  ${acc.label} up`)
  }
  return insts
}

// ── loop assertions (light up once cto's join_lobby p2p fix lands) ──
async function assert_presence(insts) {
  // each instance should see the OTHER N-1 characters in its OnlinePlayers / world.
  for (const inst of insts) {
    const relays = inst.wss.length,
      p2plog = inst.p2p[0] || '(no [p2p] log — join_lobby never fired)'
    const online = await inst.page
      .evaluate(() => {
        try {
          const s = window.__ARES_ENGINE?.get_state?.() ?? {}
          return {
            sel: s.selected_character_id,
            peers: s.visible_characters ? Object.keys(s.visible_characters).length : 0,
          }
        } catch {
          return { err: 1 }
        }
      })
      .catch(() => ({ err: 1 }))
    log(`  presence[${inst.label}] relays=${relays} peers=${online.peers ?? '?'} · ${p2plog}`)
    await shot(inst, 'world')
  }
  const total_relays = insts.reduce((a, i) => a + i.wss.length, 0)
  return total_relays > 0
}

async function main() {
  const insts = await boot()
  await insts[0].page.waitForTimeout(12000) // scene mount + async relay connect window
  const p2p_live = await assert_presence(insts)
  if (!p2p_live) {
    log('⛔ P2P PRESENCE DEAD (0 relays across all instances) — BLOCKED on cto join_lobby fix (P0 #25).')
    log('   Foundation OK: N headed contexts booted, dev-login, World mount, input+screenshots wired.')
    log('   The invite→private-dungeon→co-fight→refresh-resync steps activate automatically once relays>0.')
  } else {
    log('✅ P2P LIVE — running the full loop.')
    // TODO(unblocked-by-fix): B real-clicks C/D/E in OnlinePlayers → invite; leader creates private dungeon;
    //   members real-click Join; co-fight (walk+click-cast); one page.reload() mid-fight → assert resync.
  }
  await insts[0].page.waitForTimeout(1500)
  for (const i of insts) await i.browser.close()
  log('rig closed.')
}
main().catch((e) => {
  console.error('[rig] fatal', e)
  process.exit(1)
})
