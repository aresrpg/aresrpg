// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// TWIN TRANSPORT HASH PARITY (#1700). One chain event reaches a client by two transports: the ACTING seat reads its
// own tx RECEIPT, the OBSERVING seat reads the same row off the JOURNAL. Both resolve to the same coordinate
// `(version, ordinal)`, so admission hashes their CONTENT to decide "same event, re-delivered" (idempotent) versus
// "two truths at one index" (a `hash_conflict` finding + an authoritative `refetch` request).
//
// That check is only worth anything if it is silent when the transports agree. It was not: `mark_damaging_casts` ran
// on the receipt/poll decode and NOT on the journal decode, so a Cast whose receipt twin carried the derived
// `damaging` flag hashed differently from its journal twin — a false `hash_conflict` + a spurious refetch, on rows
// where the chain bytes were IDENTICAL. A fault channel that cries wolf every turn trains everyone to ignore the
// real protocol fault it exists to surface.
//
// THE LAW THIS SEALS: the admitted log holds PURE CHAIN-EVENT DATA. Client-side derivations (`resolve_seat`, the
// turn-start budget, and now `damaging`) attach at FOLD time — never baked into the log, therefore never hashed as
// if the chain had said them. Both transports feed ONE decode whose output is chain bytes and nothing else, so the
// twins cannot drift again by construction.
//
// THE FIXTURE is the pinned acceptance corpus (`test/fixtures/capsules/`) — REAL captured testnet receipts, the same
// two-week corpus `core_corpus_replay.test.js` replays. Its journal twin is built by re-shaping each captured event
// into the `{ seq, kind, data, version }` envelope the indexer republishes (shape pinned by
// `test/fixtures/journal/page_0.json`), so the two paths see the SAME wire bytes and nothing is round-tripped
// through an encoder.

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import { admit_events, batch_to_actions, journal_to_actions } from '../src/core_inbox.js'
import { empty_inbox } from '../src/core_state.js'

const CAPSULES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'capsules')
const files = readdirSync(CAPSULES_DIR).filter((name) => name.endsWith('.capsule.json'))

/** Every captured chain-read batch in the corpus that carries raw receipt-shaped events. */
const captured_batches = () =>
  files.flatMap((file) =>
    JSON.parse(readFileSync(join(CAPSULES_DIR, file), 'utf8'))
      .capsules.map((envelope) => envelope.payload)
      .filter((payload) => payload?.kind === 'journal_rows_received' && payload.rows?.events?.[0]?.type)
      .map((payload) => ({ file, ...payload }))
  )

/** The JOURNAL twin of a captured receipt batch: the indexer republishes each chain event as
 *  `{ seq, kind, data, version }` — the same bytes the receipt carried, in the other transport's envelope. */
const journal_twin = (rows, version) => ({
  events: rows.events.map((event, seq) => ({
    seq,
    kind: String(event.type).split('::').pop(),
    data: event.parsedJson,
    version,
  })),
})

/** The content fields two twins disagree on at one coordinate — diagnostics for the failure message. */
const field_diff = (a, b) => {
  const strip = ({ source, resolve_seat, version, event_idx, seq, ...content }) => content
  const [left, right] = [strip(a), strip(b)]
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .map((key) => `${key}: receipt=${JSON.stringify(left[key])} journal=${JSON.stringify(right[key])}`)
}

describe('#1700 — a chain row admits identically whichever transport carried it', () => {
  const batches = captured_batches()

  // POSITIVE CONTROL. A corpus that yielded no batches, or no Cast rows, would let every assertion below pass
  // vacuously — the instrument must fail loud rather than report a plausible zero.
  test('the corpus actually exercises the row under test', () => {
    expect(files.length).toBe(8)
    expect(batches.length).toBeGreaterThan(0)
    const casts = batches.reduce(
      (total, { rows }) => total + rows.events.filter((event) => String(event.type).endsWith('::Cast')).length,
      0
    )
    expect(casts).toBeGreaterThan(0)
  })

  test('the receipt twin and the journal twin of the SAME captured rows never conflict', () => {
    const conflicts = []
    for (const { file, rows, version, fight_id } of batches) {
      const receipt = batch_to_actions(rows, { version, source: 'receipt', fight_id })
      const journal = journal_to_actions(journal_twin(rows, version))
      const admitted = admit_events(empty_inbox(), receipt, 0)
      const { failures } = admit_events(admitted.inbox, journal, 0)
      for (const failure of failures.filter((row) => row.kind === 'hash_conflict')) {
        const left = receipt.find((action) => Number(action.event_idx) === failure.coord.ordinal)
        const right = journal.find((action) => Number(action.event_idx) === failure.coord.ordinal)
        conflicts.push(
          `${file.slice(0, 14)} v${failure.coord.version}:${failure.coord.ordinal} ${left?.kind} — ${field_diff(left ?? {}, right ?? {}).join(' · ')}`
        )
      }
    }
    expect(conflicts, `${conflicts.length} twin(s) of one chain row hashed differently`).toEqual([])
  })

  // THE CLASS GATE, not the instance. Cast is the row #1700 caught, but the defect class is "a client-side
  // derivation rides the admitted log", which any row kind could contract. This pins EVERY kind the corpus carries.
  test('no row kind carries a field one transport invented', () => {
    const invented = new Set()
    for (const { rows, version, fight_id } of batches) {
      const journal = journal_to_actions(journal_twin(rows, version))
      for (const action of batch_to_actions(rows, { version, source: 'receipt', fight_id })) {
        const twin = journal.find((row) => Number(row.event_idx) === Number(action.event_idx))
        if (!twin) continue
        for (const field of field_diff(action, twin)) invented.add(`${action.kind}.${field.split(':')[0]}`)
      }
    }
    expect([...invented].sort()).toEqual([])
  })
})
