// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2030 — THE DISCOVERED-THEN-EMPTY ZONE. A live session threw
// `[discovery/finality-reconcile/empty-zone] chain-direct zone 489:487 stayed empty`, read as proof that a
// discovery act minted no content. It was not: world 0xc64b1f59…a1c4's zone 489:487 carries a seed, a
// format-3 commitment and 58 mob groups / 34 resource nodes on chain (verified chain-direct + through this
// repo's own `derive_zone`), and the indexer projects the same counts. The chain never dropped a leg.
//
// What dropped was the READ. `run_tx` takes the execute-cert fast path (tx.js: `submit_result.effects_result`
// short-circuits `waitForTransaction`), so the leg NAMED "finality reconcile" fires microseconds after the
// optimistic one — inside the very ~570ms fullnode ledger-availability window that fast path documents — and
// it was handed a ladder of `[0]`: ONE read, zero retries, then a loud "stayed empty". The optimistic leg it
// exists to correct got three. A lagging read therefore printed a false void over a full zone.
//
// The DoD: ONE read ladder, wide enough to cover that window, for both legs — and the instrument still
// throws when every attempt comes back null (genuine emptiness stays loud).
import { EventEmitter } from 'node:events'

import { afterAll, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { context } from '../../src/game/core/game.js'

afterAll(install_browser_globals())

// bun's `mock.module` is PROCESS-global, and three component suites replace `game/store.js` with a PARTIAL
// `context` (`{ get_state }` — no `events`) that reaches this handle in a whole-suite run. The fold announces
// its rows on the real bus; hand it one when the ambient handle arrived stubbed, so this file measures the
// read ladder rather than another suite's mock ordering.
if (!context.events) context.events = new EventEmitter()

const { fold_zone_rows_after_write, ZONE_READ_DELAYS_MS } = await import('../../src/world-shell/discovery_actions.js')

const ROWS = [{ kind: 'mob', spawn_id: '2030' }]
const ZONE = { world_id: `0x${'2030'.padStart(64, '0')}`, zx: 489, zy: 487 }

/** A chain-direct reader that lags: `nulls` reads come back null, then the rows land. */
const lagging_reader = (nulls, rows = ROWS) => {
  let calls = 0
  const read = async () => (++calls <= nulls ? null : rows)
  read.calls = () => calls
  return read
}

test('the finality-reconcile leg survives the post-cert read lag instead of printing a false empty zone', async () => {
  const read_rows = lagging_reader(1)
  const folded = await fold_zone_rows_after_write({
    ...ZONE,
    at_executed: performance.now(),
    reconcile: true,
    read_rows,
  })
  expect(folded).toEqual(ROWS)
  expect(read_rows.calls()).toBe(2)
})

test('both legs read on the SAME ladder — the reconcile leg is never the less patient one', async () => {
  expect(ZONE_READ_DELAYS_MS.length).toBeGreaterThan(1)
  const optimistic = lagging_reader(2)
  const reconcile = lagging_reader(2)
  await fold_zone_rows_after_write({ ...ZONE, at_executed: performance.now(), read_rows: optimistic })
  await fold_zone_rows_after_write({ ...ZONE, at_executed: performance.now(), reconcile: true, read_rows: reconcile })
  expect(reconcile.calls()).toBe(optimistic.calls())
})

test('a zone that is null on EVERY attempt still throws — the instrument is not softened', async () => {
  const read_rows = lagging_reader(Infinity)
  await expect(
    fold_zone_rows_after_write({ ...ZONE, at_executed: performance.now(), reconcile: true, read_rows })
  ).rejects.toThrow('[discovery/finality-reconcile/empty-zone] chain-direct zone 489:487 stayed empty')
  expect(read_rows.calls()).toBe(ZONE_READ_DELAYS_MS.length)
})

test('a failing read is reported as a failed read, never as an empty zone', async () => {
  const read_rows = async () => {
    throw new Error('grpc unavailable')
  }
  await expect(
    fold_zone_rows_after_write({ ...ZONE, at_executed: performance.now(), reconcile: true, read_rows })
  ).rejects.toThrow('[discovery/finality-reconcile/failed-read] chain-direct zone 489:487 read failed')
})
