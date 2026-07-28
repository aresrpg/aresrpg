// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE CROSS-PROCESS DELIVERY PROOF (#1508) — two independent clients, three real processes.
//
// The suite that shipped the courier was green on a wire no server spoke: every test called the decoder by
// hand, and the one artifact that had ever proven a line CROSSING between two clients was deleted in the same
// series. This restores that proof for the courier era: client B POSTs through the real `api/courier.mjs`
// into a real Redis, and client A — a second, independent SSE connection to the real
// `packages/rpc/indexer` stream — must receive it. Nothing here is mocked; if any hop is missing the script
// fails, which is exactly what it does on the wire as shipped.
//
// It also pins the two properties a one-client test cannot see: the sender's OWN line comes back down the
// same wire (that round trip IS the local echo), and a client joining LATE gets the live poses in its join
// snapshot rather than an empty world.
//
// Boot the stack with the sibling `courier_delivery_e2e.sh`, or point it at any running one:
//   COURIER_URL=http://127.0.0.1:9528 STREAM_URL=http://127.0.0.1:3001 \
//     bun packages/rpc/scripts/courier_delivery_e2e.mjs

import { courier_presence_url, post_courier_chat, post_courier_position } from '../../sdk/src/courier.js'

const COURIER_URL = process.env.COURIER_URL || 'http://127.0.0.1:9528'
const STREAM_URL = process.env.STREAM_URL || 'http://127.0.0.1:3001'
const BUDGET_MS = Number(process.env.COURIER_E2E_BUDGET_MS || 10_000)

const id = (tail) => `0x${tail.repeat(32)}`
const WORLD = id('b2')
const ALICE = id('a1')
const BOB = id('c3')
// The dev bypass accepts the declared sender; the auth path itself is gated by api/courier.test.js.
const auth = (sender) => ({ sender, challenge: `aresrpg-courier:${sender}:${Date.now()}`, signature: 'e2e' })

/** Minimal SSE reader over the real response body — Bun has no EventSource, and the wire is text. */
async function open_link(url, on_frame) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`presence link refused: HTTP ${response.status} ${await response.text()}`)
  const abort = new AbortController()
  void (async () => {
    let buffer = ''
    for await (const chunk of response.body) {
      if (abort.signal.aborted) return
      buffer += new TextDecoder().decode(chunk)
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const type = block.match(/^event: ?(.+)$/m)?.[1]
        const data = block.match(/^data: ?(.*)$/m)?.[1]
        if (type && data) on_frame({ type, body: JSON.parse(data) })
      }
    }
  })().catch(() => {})
  return () => abort.abort()
}

/** One client: an independent SSE connection that records every named frame it is delivered. */
async function client(name, character) {
  const frames = []
  const close = await open_link(courier_presence_url(STREAM_URL, WORLD, { character }), (frame) => frames.push(frame))
  return {
    name,
    character,
    frames,
    close,
    /** Wait for the first frame matching `match`, or give up inside the budget. */
    async await_frame(match) {
      const deadline = Date.now() + BUDGET_MS
      while (Date.now() < deadline) {
        const found = frames.find(match)
        if (found) return found
        await Bun.sleep(50)
      }
      return null
    },
  }
}

const checks = []
const check = (ok, label) => {
  checks.push({ ok: !!ok, label })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`)
}

async function main() {
  const alice = await client('alice', ALICE)
  const bob = await client('bob', BOB)

  check(
    await alice.await_frame(({ type }) => type === 'positions'),
    'a joining client is handed the live-pose snapshot'
  )

  await post_courier_position({
    base_url: COURIER_URL,
    world: WORLD,
    character: BOB,
    x: 4,
    z: 6,
    heading: 1.5,
    ...auth(BOB),
  })
  const crossed = await alice.await_frame(({ type, body }) => type === 'position' && body.character === BOB)
  check(crossed && crossed.body.x === 4 && crossed.body.z === 6, "alice receives bob's pose, coordinates intact")

  await post_courier_chat({
    base_url: COURIER_URL,
    world: WORLD,
    character: BOB,
    text: 'crossing the wire',
    ...auth(BOB),
  })
  const line = await alice.await_frame(({ type, body }) => type === 'chat' && body.text === 'crossing the wire')
  check(line && line.body.character === BOB, "alice receives bob's chat line")
  const echo = await bob.await_frame(({ type, body }) => type === 'chat' && body.text === 'crossing the wire')
  check(echo, 'SENDER ECHO — bob receives his own accepted line down the same wire')

  const late = await client('late', id('d4'))
  const snapshot = await late.await_frame(({ type }) => type === 'positions')
  check(
    snapshot?.body.positions?.some((row) => row.character === BOB && row.x === 4),
    "a client joining LATE sees bob's live pose in its join snapshot, not an empty world"
  )

  for (const open of [alice, bob, late]) open.close()
  const failed = checks.filter(({ ok }) => !ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} delivery checks passed`)
  if (failed.length) process.exit(1)
}

await main()
