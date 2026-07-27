// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// SSE CUTOVER GATE — replay the recorded journal-bearing fight capsule through the real EventSource transport
// adapter. Replacing the direct journal delivery with an SSE frame must leave the ONE core fold byte-identical.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { classify_input } from '@aresrpg/fight/classify_input'
import { input_envelope } from '@aresrpg/fight/envelope'
import { ingest, project_board, replay } from '@aresrpg/fight/core'

import { open_fight_stream } from './fight_sse_adapter.js'

const CAPSULE = new URL(
  '../../../fight/test/fixtures/capsules/0x3f6103fb3fb842bac763a3d275f607d33e49fcde787f004229c18e900e95c33a-1784752468344.capsule.json',
  import.meta.url
)

class FakeEventSource {
  static latest = null

  constructor(url) {
    this.url = url
    this.readyState = 0
    FakeEventSource.latest = this
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  emit(data, lastEventId) {
    this.onmessage?.({ data: JSON.stringify(data), lastEventId: String(lastEventId) })
  }

  close() {
    this.readyState = 2
  }
}

describe('fight EventSource adapter → the ONE fold door', () => {
  test('a recorded capsule has the same committed fingerprint through direct journal and SSE paths', () => {
    const capsule = JSON.parse(readFileSync(CAPSULE, 'utf8'))
    const direct = replay(capsule)
    let streamed = undefined
    let observed_at = 0
    let input_seq = 0
    const statuses = []

    const close = open_fight_stream({
      fight_id: capsule.session_id,
      cursor: () => (streamed?.inbox?.delivered_seq >= 0 ? String(streamed.inbox.delivered_seq) : null),
      input(message, now) {
        const envelope = input_envelope({
          session_id: capsule.session_id,
          input_seq: input_seq++,
          observed_at_ms: now,
          payload: classify_input(message),
        })
        streamed = ingest(streamed, envelope, now)
      },
      event_source_factory: (url) => new FakeEventSource(url),
      base_url: 'https://rpc.test',
      now: () => observed_at,
      set_status: (status) => statuses.push(status),
      install_deadline_belt: false,
    })

    for (const envelope of capsule.capsules) {
      observed_at = envelope.observed_at_ms
      const payload = envelope.payload
      if (payload.kind === 'journal_rows_received' && payload.source === 'journal') {
        const rows = payload.rows
        const last = rows.events?.at(-1)?.seq ?? rows.head
        FakeEventSource.latest.emit(rows, last)
      } else {
        streamed = ingest(streamed, envelope, observed_at)
      }
    }

    expect(project_board(streamed)).toEqual(project_board(direct))
    expect(FakeEventSource.latest.url).toContain(`/v1/stream/fight/${capsule.session_id}`)
    expect(statuses).toContain('connected')
    close()
    expect(FakeEventSource.latest.readyState).toBe(2)
  })

  test('the reconnect cursor is seeded from the fold and every frame remains a journal-door message', () => {
    const messages = []
    const close = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => '41',
      input: (message) => messages.push(message),
      event_source_factory: (url) => new FakeEventSource(url),
      base_url: 'https://rpc.test',
      install_deadline_belt: false,
    })
    expect(new URL(FakeEventSource.latest.url).searchParams.get('lastEventId')).toBe('41')
    FakeEventSource.latest.emit(
      {
        fight_id: '0xfight',
        source: 'journal',
        head: '43',
        events: [{ fight_id: '0xfight', seq: '42', kind: 'TurnEnded', data: {}, version: '9' }],
      },
      '42'
    )
    expect(messages).toEqual([
      {
        type: 'journal',
        fight_id: '0xfight',
        batch: {
          fight_id: '0xfight',
          source: 'journal',
          head: '43',
          events: [{ fight_id: '0xfight', seq: '42', kind: 'TurnEnded', data: {}, version: '9' }],
        },
      },
    ])
    close()
  })
})

describe('#1381 deadline-proximity read belt', () => {
  test('schedules one direct read at deadline −5s, dedupes the same anchor, and has no interval cadence', async () => {
    let deadline = 20_000
    let now = 1_000
    let subscriber = null
    const scheduled = []
    let reads = 0
    const source = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => null,
      input: () => {},
      event_source_factory: (url) => new FakeEventSource(url),
      base_url: 'https://rpc.test',
      deadline: () => deadline,
      direct_read: async () => {
        reads += 1
      },
      subscribe: (fn) => {
        subscriber = fn
        return () => {}
      },
      now: () => now,
      set_timeout: (fn, delay) => {
        const handle = { fn, delay, cleared: false }
        scheduled.push(handle)
        return handle
      },
      clear_timeout: (handle) => {
        handle.cleared = true
      },
    })

    expect(scheduled.at(-1).delay).toBe(14_000)
    await scheduled.at(-1).fn()
    expect(reads).toBe(1)
    subscriber()
    expect(scheduled).toHaveLength(1)

    deadline = 30_000
    now = 21_000
    subscriber()
    expect(scheduled.at(-1).delay).toBe(4_000)
    await scheduled.at(-1).fn()
    expect(reads).toBe(2)
    source()
  })
})
