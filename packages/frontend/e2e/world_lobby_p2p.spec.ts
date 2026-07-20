// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect, chromium, type Page } from '@playwright/test'

// WS-B — serverless p2p lobby contract, proven over REAL Trystero (final-design plan decision #2:
// "P2P = Trystero, genuinely serverless — signaling over public relays, data e2e p2p"). Two independent
// browser contexts drive the ACTUAL src/p2p/lobby-room.js module against live nostr relays + real
// WebRTC, and assert its full contract:
//   1. presence — a peer's broadcast_position re-emits the SAME synthetic packet/characterPosition that
//      presence.js consumes (so roam.js renders foreign avatars with ZERO rendering changes).
//   2. chat — a peer's broadcast_chat re-emits packet/chatMessage (so WorldChat consumes it unchanged).
//   3. CHEATER POLICY (no authoritative server exists) — a teleport/speed-hacked position update is DROPPED.
//   4. despawn — leaving the room emits packet/charactersDespawn.
//
// This tests the p2p module in isolation (no on-chain mint needed) because the scene-mount + movement
// side is already proven by world_lobby_movement.spec.ts. It exercises the risky part — real relay
// discovery + WebRTC data channel between two peers — deterministically.

const APP_ROUTE = '/game-world' // any app route boots the vite module graph; we import modules directly

// Boot the app in a context, then install a capture buffer on the game event bus and join the lobby as
// `charId`. Returns nothing — state lives in the page's window.__P2P.
async function join_as(page: Page, baseURL: string, charId: string) {
  await page.goto(`${baseURL}${APP_ROUTE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500) // let the eager module graph settle
  await page.evaluate(async (id) => {
    const { context } = await import('/src/game/core/game.js')
    const p2p = await import('/src/p2p/lobby-room.js')
    const w = window as any
    w.__P2P = { positions: [], despawns: [], chats: [], mod: p2p, charId: id }
    context.events.on('packet/characterPosition', (e: any) => w.__P2P.positions.push(e))
    context.events.on('packet/charactersDespawn', (e: any) => w.__P2P.despawns.push(e))
    context.events.on('packet/chatMessage', (e: any) => w.__P2P.chats.push(e))
    p2p.join_lobby(id)
  }, charId)
}

const positions = (page: Page) => page.evaluate(() => (window as any).__P2P.positions)
const chats = (page: Page) => page.evaluate(() => (window as any).__P2P.chats)
const despawns = (page: Page) => page.evaluate(() => (window as any).__P2P.despawns)

// poll a page-side predicate over a window until true or the budget runs out (real WebRTC/relay timing).
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 30, gapMs = 2000) {
  let v = await fn()
  for (let i = 0; i < tries && !ok(v); i++) {
    await new Promise((r) => setTimeout(r, gapMs))
    v = await fn()
  }
  return v
}

test('serverless p2p: presence + chat + cheater-drop over real Trystero', async ({ baseURL }) => {
  const browser = await chromium.launch()
  try {
    await run_p2p(browser, baseURL!)
  } finally {
    // ALWAYS close — a mid-test failure must not leak the two browser instances (they would throttle a
    // sibling test's rAF when the suite runs in one process).
    await browser.close()
  }
})

async function run_p2p(browser: import('@playwright/test').Browser, baseURL: string) {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  const errors: string[] = []
  pageA.on('pageerror', (e) => errors.push(`[A] ${e}`))
  pageB.on('pageerror', (e) => errors.push(`[B] ${e}`))

  const ID_A = 'p2p-char-A'
  const ID_B = 'p2p-char-B'
  await join_as(pageA, baseURL!, ID_A)
  await join_as(pageB, baseURL!, ID_B)

  // (1) PRESENCE: B broadcasts its position repeatedly until A's event bus receives it (repeat because
  // the WebRTC data channel may still be mid-handshake on the first sends — real relay discovery).
  const gotB_onA = await until(
    async () => {
      await pageB.evaluate((id) => (window as any).__P2P.mod.broadcast_position(id, 4, 6), ID_B)
      return positions(pageA)
    },
    (list) => list.some((p: any) => p.id === ID_B && p.position.x === 4 && p.position.z === 6)
  )
  expect(
    gotB_onA.some((p: any) => p.id === ID_B),
    "tab A should receive tab B's position via serverless Trystero"
  ).toBe(true)

  // (2) CHAT: B sends a chat line, A should receive packet/chatMessage carrying it.
  const gotChat = await until(
    async () => {
      await pageB.evaluate(
        (id) => (window as any).__P2P.mod.broadcast_chat(id, 'PeerB', 'hi from B', 'CHAT_GENERAL'),
        ID_B
      )
      return chats(pageA)
    },
    (list) => list.some((m: any) => m.message === 'hi from B' && m.name === 'PeerB')
  )
  expect(
    gotChat.some((m: any) => m.message === 'hi from B'),
    "tab A should receive tab B's chat"
  ).toBe(true)

  // (3) CHEATER POLICY: B teleports far in the same instant. The first plausible pos (4,6) is already
  // accepted above; an immediate jump to (900,900) implies an impossible speed and MUST be dropped —
  // A's position buffer must NOT gain that coordinate.
  const beforeCheat = (await positions(pageA)).length
  await pageB.evaluate((id) => (window as any).__P2P.mod.broadcast_position(id, 900, 900), ID_B)
  await pageA.waitForTimeout(3000)
  const afterCheat = await positions(pageA)
  expect(
    afterCheat.some((p: any) => p.id === ID_B && p.position.x === 900),
    'a teleport/speed-hacked peer update must be dropped, never applied'
  ).toBe(false)
  expect(afterCheat.length, 'sanity: buffer only grows with ACCEPTED updates').toBe(beforeCheat)

  // (4) DESPAWN: B leaves the room; A should get a charactersDespawn for B's id.
  await pageB.evaluate(() => (window as any).__P2P.mod.leave_lobby())
  const gotDespawn = await until(
    async () => despawns(pageA),
    (list) => list.some((d: any) => d.ids?.includes(ID_B)),
    15,
    2000
  )
  expect(
    gotDespawn.some((d: any) => d.ids?.includes(ID_B)),
    'tab A should see tab B despawn on leave'
  ).toBe(true)

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
}
