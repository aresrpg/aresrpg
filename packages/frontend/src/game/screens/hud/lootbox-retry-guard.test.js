// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { add_pending_buy, merge_pending_buys, reset_pending_buys } from '@aresrpg/inventory'

import { tx_error } from '../../core/abort_copy.js'

import {
  _reset_box_retry_guard_for_test,
  allow_equip_retry,
  allow_box_retry,
  begin_claim,
  block_box_retry,
  block_equip_retry,
  box_retry_digest,
  end_claim,
  hydrate_claim_latches,
  is_box_retry_blocked,
  is_claim_latched,
  is_equip_retry_blocked,
  is_latch_durable,
  note_open_settled,
  release_settled_box_latches,
  should_block_tx_retry,
  sweep_eligible_claims,
} from './lootbox-retry-guard.js'

afterEach(_reset_box_retry_guard_for_test)

describe('loot-box executed-failure retry guard', () => {
  test('a failed box stays blocked across callers/remounts for the page session', () => {
    block_box_retry('0xbox')

    expect(is_box_retry_blocked('0xbox')).toBe(true)
    expect(is_box_retry_blocked('0xother')).toBe(false)
  })

  test('only an explicit zero-gas verdict re-arms a blocked box', () => {
    block_box_retry('0xbox')
    allow_box_retry('0xbox')

    expect(is_box_retry_blocked('0xbox')).toBe(false)
  })

  test('a digest-carrying executed equip failure arms exactly that character', () => {
    const error = Object.assign(new Error('executed abort'), { digest: '0xburned' })
    expect(block_equip_retry('0xcharacter', error)).toBe(true)

    expect(is_equip_retry_blocked('0xcharacter')).toBe(true)
    expect(is_equip_retry_blocked('0xother')).toBe(false)
  })

  test('pre-flight refusals without a digest never arm the equip latch', () => {
    const gate_refusal = tx_error({ $kind: 'MoveAbort', location: { module: 'equipment' }, abortCode: 110 })
    expect(block_equip_retry('0xcharacter', gate_refusal)).toBe(false)
    expect(block_equip_retry('0xcharacter', new Error('wallet refused before signing'))).toBe(false)
    expect(is_equip_retry_blocked('0xcharacter')).toBe(false)
  })

  test('the successful-refresh action self-heals the equip latch', () => {
    block_equip_retry('0xcharacter', { cause: { digest: '0xburned' } })
    expect(is_equip_retry_blocked('0xcharacter')).toBe(true)
    allow_equip_retry('0xcharacter')
    expect(is_equip_retry_blocked('0xcharacter')).toBe(false)
  })

  test('only a positively identified preflight refusal remains retryable', () => {
    const preflight = new Error('MoveAbort abort code 103 in loot_box::open_box')
    preflight.name = 'SimulationError'

    expect(should_block_tx_retry(preflight)).toBe(false)
    expect(should_block_tx_retry(new Error('executed abort'))).toBe(true)
  })
})

describe('open-latch self-clear (D1 + P3 receipt-grade — never trusts bare /v1 presence)', () => {
  test('a FAILED open (box still sealed) releases when a FRESH read proves the box present', () => {
    block_box_retry('0xbox')
    note_open_settled('0xbox', { at: 100, error: new Error('open aborted pre-consume') })

    const released = release_settled_box_latches({ live_box_ids: new Set(['0xbox']), read_started_at: 200 })

    expect(released).toEqual(['0xbox'])
    expect(is_box_retry_blocked('0xbox')).toBe(false)
  })

  test('P3: a SUCCESSFUL open NEVER releases even if a lagged /v1 read still shows the box present', () => {
    block_box_retry('0xbox')
    note_open_settled('0xbox', { at: 100 }) // no error ⇒ success ⇒ box consumed on-chain

    const released = release_settled_box_latches({ live_box_ids: new Set(['0xbox']), read_started_at: 200 })

    // the projection lags and shows it present, but the receipt says consumed — no phantom re-open, no burn
    expect(released).toEqual([])
    expect(is_box_retry_blocked('0xbox')).toBe(true)
  })

  test('a box ABSENT from the fresh read never releases into a second burn', () => {
    block_box_retry('0xbox')
    note_open_settled('0xbox', { at: 100, error: new Error('open aborted') })

    const released = release_settled_box_latches({ live_box_ids: new Set(['0xother']), read_started_at: 200 })

    expect(released).toEqual([])
    expect(is_box_retry_blocked('0xbox')).toBe(true)
  })

  test('an alive open promise (never settled) never releases regardless of reads', () => {
    block_box_retry('0xbox')

    release_settled_box_latches({ live_box_ids: new Set(['0xbox']), read_started_at: Date.now() + 60_000 })

    expect(is_box_retry_blocked('0xbox')).toBe(true)
  })

  test('a STALE read (started before the promise settled) never releases', () => {
    block_box_retry('0xbox')
    note_open_settled('0xbox', { at: 300, error: new Error('open aborted') })

    release_settled_box_latches({ live_box_ids: new Set(['0xbox']), read_started_at: 200 })

    expect(is_box_retry_blocked('0xbox')).toBe(true)
  })

  test('the executed-failure digest survives on the latch for the cause line', () => {
    block_box_retry('0xbox')
    note_open_settled('0xbox', { at: 100, error: Object.assign(new Error('executed abort'), { digest: '0xburned' }) })

    expect(box_retry_digest('0xbox')).toBe('0xburned')
  })
})

describe('executed-failed CLAIM latch is DURABLE across a reboot (P1 — no auto-refire burns gas every boot)', () => {
  // The in-memory latch reset on refresh, and the boot sweep re-auto-fired the aborted (rolled-back, still-in-/v1)
  // claim forever. A localStorage stub stands in for the browser's persistent storage; a simulated reboot resets
  // ONLY the module's in-memory state (as a page reload does) — storage survives, and `hydrate_claim_latches`
  // reads it back as the boot INPUT.
  let original_local_storage
  beforeEach(() => {
    original_local_storage = globalThis.localStorage
    const store = new Map()
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    }
  })
  afterEach(() => {
    globalThis.localStorage = original_local_storage
  })

  test('a persisted executed-fail is NOT re-swept after a simulated reboot', () => {
    // session A: the sweep fired X, claim_pet EXECUTED and aborted → latched + persisted to storage
    begin_claim('0xX')
    end_claim('0xX', { error: new Error('executed abort') })
    expect(sweep_eligible_claims(['0xX'])).toEqual([]) // fenced in-session

    // simulate a full page reload: in-memory module state resets, localStorage survives
    _reset_box_retry_guard_for_test()
    hydrate_claim_latches() // boot INPUT: seed the durable latch from storage

    expect(sweep_eligible_claims(['0xX'])).toEqual([]) // STILL fenced — the boot sweep will NOT re-fire it
    expect(is_claim_latched('0xX')).toBe(true)
  })

  test('a preflight-refused claim (no gas burned) stays sweep-eligible after a reboot', () => {
    const preflight = Object.assign(new Error('refused at dry-run'), { name: 'SimulationError' })
    begin_claim('0xfree')
    end_claim('0xfree', { error: preflight })

    _reset_box_retry_guard_for_test()
    hydrate_claim_latches()

    expect(sweep_eligible_claims(['0xfree'])).toEqual(['0xfree']) // never executed → free to auto-retry
  })

  test('a successfully collected claim clears its durable latch (no stale fence after a reboot)', () => {
    begin_claim('0xdone')
    end_claim('0xdone', { error: new Error('executed abort') }) // first attempt aborts → persisted
    begin_claim('0xdone') // human manual-retries…
    end_claim('0xdone', {}) // …and it succeeds → durable latch cleared

    _reset_box_retry_guard_for_test()
    hydrate_claim_latches()

    expect(is_claim_latched('0xdone')).toBe(false)
  })
})

describe('claim auto-fire guard (D3 — auto at opening, sweep at boot, never an auto REFIRE)', () => {
  test('begin_claim admits exactly one flight per claim across surfaces', () => {
    expect(begin_claim('0xclaim')).toBe(true)
    expect(begin_claim('0xclaim')).toBe(false) // reveal + sweep + shop can never double-fire

    end_claim('0xclaim', {})
    expect(begin_claim('0xclaim')).toBe(false) // settled OK → never re-fired this session
  })

  test('an executed/ambiguous claim failure latches the claim against any AUTO refire', () => {
    begin_claim('0xclaim')
    end_claim('0xclaim', { error: new Error('executed abort') })

    expect(is_claim_latched('0xclaim')).toBe(true)
    expect(sweep_eligible_claims(['0xclaim'])).toEqual([])
    expect(begin_claim('0xclaim')).toBe(true) // the MANUAL one-click retry stays open
    end_claim('0xclaim', {})
  })

  test('a zero-gas preflight refusal leaves the claim sweep-eligible (no latch)', () => {
    const preflight = Object.assign(new Error('refused at dry-run'), { name: 'SimulationError' })
    begin_claim('0xclaim')
    end_claim('0xclaim', { error: preflight })

    expect(is_claim_latched('0xclaim')).toBe(false)
    expect(sweep_eligible_claims(['0xclaim'])).toEqual(['0xclaim'])
  })

  test('sweep_eligible_claims filters in-flight, latched, and already-succeeded claims', () => {
    begin_claim('0xflying')
    begin_claim('0xdone')
    end_claim('0xdone', {})
    begin_claim('0xlatched')
    end_claim('0xlatched', { error: new Error('executed abort') })

    expect(sweep_eligible_claims(['0xflying', '0xdone', '0xlatched', '0xfresh'])).toEqual(['0xfresh'])
  })
})

describe('storage that cannot CONFIRM a write turns AUTO-sweep OFF (P1 round 3 — no silent re-admit)', () => {
  // Round-2 stubbed a never-throwing storage, so it lied green. Safari private mode / QuotaExceeded / disabled make
  // setItem THROW: the write is swallowed, nothing persists, and the boot sweep would re-admit the executed-fail
  // every login (silent burn). The read-back verify catches the swallow and the durability gate turns AUTO off,
  // degrading every stranded claim to the existing MANUAL one-click path (the shop chip — begin_claim stays open).
  let original_local_storage
  beforeEach(() => {
    original_local_storage = globalThis.localStorage
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded / private mode')
      },
      removeItem: () => {},
    }
  })
  afterEach(() => {
    globalThis.localStorage = original_local_storage
  })

  test('a throwing setItem → reboot → auto-sweep returns [] (no re-admit of 0xX), manual path keeps it', () => {
    // session A: X executes and aborts → the durable persist THROWS (silently swallowed on the round-2 code)
    begin_claim('0xX')
    end_claim('0xX', { error: new Error('executed abort') })

    // simulate reboot: in-memory state resets; storage is (still) broken
    _reset_box_retry_guard_for_test()
    hydrate_claim_latches() // boot probe: read-back after a setItem-throw → latch_durability = 'unconfirmed'

    expect(is_latch_durable()).toBe(false)
    expect(sweep_eligible_claims(['0xX'])).toEqual([]) // AUTO-sweep admits NOTHING — no silent burn every boot
    expect(begin_claim('0xX')).toBe(true) // the MANUAL one-click (shop chip) still collects it
  })
})

describe('a SUCCESSFUL open purges the bought-item optimistic ledger (CONFIRMING… stuck forever otherwise)', () => {
  // Root cause: buy_items_sale paints a JUST-BOUGHT box optimistically (store_patch.hydrate_bought_items →
  // add_pending_buy) BEFORE any chain-truth read has ever confirmed it — that ledger row's ONLY self-drain
  // condition is "a fresh read includes this id" (bought_items_ledger.js). loot_box::open_internal BURNS the
  // exact box_item_id on a successful open (Move: burn_units destroys the passed object outright, re-minting
  // only a NEW id for any stack remainder) — so once a box opens before its OWN buy was ever confirmed, that id
  // can NEVER again appear in a chain-truth read. Without a purge, merge_pending_buys re-injects the phantom
  // row on EVERY future load_roster snapshot forever — and since is_box_retry_blocked keys off that SAME id
  // (P3: a success never releases the latch — by design, relying on the tile vanishing), the resurrected tile
  // stays badged "Confirming…" permanently, with a genuinely different box sitting unbadged beside it.
  afterEach(reset_pending_buys)

  test('a box opened before its own buy ever confirmed never comes back from the dead', () => {
    // buy_items_sale → hydrate_bought_items: optimistic paint, indexer/chain-direct read has not caught up yet
    add_pending_buy({ id: '0xbox', item_type: 'pet_lootbox', item_category: 'consumable', amount: 1 })
    block_box_retry('0xbox') // BoxReveal mounts, on_retry_blocked latches it at submission start

    note_open_settled('0xbox') // SUCCESS — the reveal happened; loot_box::open_internal burned '0xbox' on-chain

    // The FIRST chain-truth read to land after the burn genuinely omits '0xbox' — it can never reappear.
    const fresh_snapshot = merge_pending_buys([{ id: '0xother' }])
    expect(fresh_snapshot.some((row) => row.id === '0xbox')).toBe(false) // no phantom tile resurrected
    expect(is_box_retry_blocked('0xbox')).toBe(true) // the latch itself is untouched (P3 still holds)
  })

  test('a FAILED open (box provably unburned) leaves the pending-buy row alone — it will self-drain normally', () => {
    add_pending_buy({ id: '0xbox', item_type: 'pet_lootbox', item_category: 'consumable', amount: 1 })
    block_box_retry('0xbox')

    note_open_settled('0xbox', { error: new Error('open aborted pre-burn') }) // REFUSALS-FIRST: never burned

    // The box is still real and will eventually show up in a genuine read — the ledger must keep carrying it
    // (this is the SAME box_id from the ledger row, so its presence here is the correct un-drained state).
    const fresh_snapshot = merge_pending_buys([{ id: '0xother' }])
    expect(fresh_snapshot.some((row) => row.id === '0xbox')).toBe(true)
  })
})
