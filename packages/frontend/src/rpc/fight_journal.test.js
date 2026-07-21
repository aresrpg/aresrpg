// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE JOURNAL INGRESS EDGE (M2a, #291) — the fetch executor + paginator, relocated here (the frontend rpc
// layer) OUT of the promise-free `@aresrpg/fight` core. The page-fetch is INJECTED, so the walk is driven
// with a fake fetcher — no global fetch stub, no rpc client cache to reset.

import { describe, expect, test } from 'bun:test'

import { RpcError } from './client'
import { paginate_fight_journal } from './fight_journal'

const FIGHT = '0xf1647' // synthetic id (house fixture convention) — never a live 0x…64 id (chain-id gate)
const CHAR = '0xchar_a'

const hit = (remaining_hp = '10') => ({
  kind: 'Hit',
  data: { fight: FIGHT, victim_is_mob: true, victim_idx: '0', amount: '7', remaining_hp },
})
const moved = (to_cell = '64') => ({ kind: 'Moved', data: { fight: FIGHT, character: CHAR, to_cell } })

/** An M1 page body of `{kind,data}` events at contiguous seqs from `from`. */
const page = (from, events, head = from + events.length) => ({
  fight: FIGHT,
  journal_head: String(head),
  events: events.map((e, i) => ({
    seq: from + i,
    ...e,
    digest: `tx-${from + i}`,
    version: String(348_000_000 + from + i),
  })),
})

/** A fake page-fetcher routing on the `from` cursor to a fixed page set (unmapped → the pre-deploy 404). */
const router =
  (pages) =>
  async (_fight_id, { from }) => {
    const p = pages[String(from)]
    if (!p) throw new RpcError('RPC_UNAVAILABLE', 404)
    return p
  }

describe('fight journal — paginate', () => {
  test('walks contiguous pages to journal_head, normalizing each into an ingress batch', async () => {
    const fetch_page = router({
      0: page(0, [moved(), hit(), moved('65')], 5),
      3: page(3, [hit('8'), moved('66')], 5),
    })
    const r = await paginate_fight_journal(FIGHT, { fetch_page })
    expect(r.ok).toBe(true)
    expect(r.head).toBe('5')
    expect(r.batches.length).toBe(2) // from=0 (3 events) then from=3 (2 events) → cursor 5 == head, stop
    expect(r.batches.flatMap((b) => b.events.map((e) => e.seq))).toEqual(['0', '1', '2', '3', '4'])
    expect(r.batches[0].source).toBe('journal') // consumed the pure @aresrpg/fight normalizer
  })

  test('a pre-deploy 404 (RpcError) degrades to unavailable as data — never throws', async () => {
    const r = await paginate_fight_journal(FIGHT, {
      fetch_page: async () => {
        throw new RpcError('RPC_UNAVAILABLE', 404)
      },
    })
    expect(r).toEqual({ ok: false, unavailable: true, status: 404, head: null, batches: [] })
  })

  test('an empty journal (head 0) yields one batch and stops without spinning', async () => {
    const fetch_page = router({ 0: { fight: FIGHT, journal_head: '0', events: [] } })
    const r = await paginate_fight_journal(FIGHT, { fetch_page })
    expect(r.ok).toBe(true)
    expect(r.head).toBe('0')
    expect(r.batches[0].events).toEqual([])
  })

  test('a non-RpcError is a real bug and propagates (never swallowed)', async () => {
    await expect(
      paginate_fight_journal(FIGHT, {
        fetch_page: async () => {
          throw new Error('kaboom')
        },
      })
    ).rejects.toThrow('kaboom')
  })
})
