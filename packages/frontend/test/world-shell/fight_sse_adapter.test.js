// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// SSE CUTOVER GATE — replay the recorded journal-bearing fight capsule through the real EventSource transport
// adapter. Replacing the direct journal delivery with an SSE frame must leave the ONE core fold byte-identical.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { classify_input } from '@aresrpg/fight/classify_input'
import { input_envelope } from '@aresrpg/fight/envelope'
import { empty_core_state, ingest, project_board, replay } from '@aresrpg/fight/core'
import { REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { open_fight_stream } from '../../src/world-shell/fight_sse_adapter.js'

const CAPSULE_ID = '3f6103fb3fb842bac763a3d275f607d3'.concat('3e49fcde787f004229c18e900e95c33a')
const CAPSULE = new URL(
  `../../../fight/test/fixtures/capsules/0x${CAPSULE_ID}-1784752468344.capsule.json`,
  import.meta.url
)

let latest_event_source = null
const fake_event_source = (url) => {
  let ready_state = 0
  let listeners = new Map()
  const source = {
    url,
    get readyState() {
      return ready_state
    },
    open() {
      ready_state = 1
      listeners.get('open')?.()
    },
    emit(data, last_event_id) {
      listeners.get('message')?.({ data: JSON.stringify(data), lastEventId: String(last_event_id) })
    },
    addEventListener(type, listener) {
      listeners = new Map([...listeners, [type, listener]])
    },
    emit_named(type, data, last_event_id = '') {
      listeners.get(type)?.({ data: JSON.stringify(data), lastEventId: String(last_event_id) })
    },
    fail() {
      listeners.get('error')?.()
    },
    close() {
      ready_state = 2
    },
  }
  latest_event_source = source
  return source
}

describe('fight EventSource adapter → the ONE fold door', () => {
  test('a recorded capsule has the same committed fingerprint through direct journal and SSE paths', () => {
    const capsule = JSON.parse(readFileSync(CAPSULE, 'utf8'))
    const direct = replay(capsule)
    // The streamed fold starts from the SAME seed `replay` uses — `ingest` takes a CoreState by contract, so
    // comparing the two paths means comparing them from one seed.
    let streamed = empty_core_state()
    let observed_at = 0
    let input_seq = 0
    let statuses = []

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
      event_source_factory: fake_event_source,
      base_url: 'https://rpc.test',
      now: () => observed_at,
      set_status: (status) => {
        statuses = [...statuses, status]
      },
      install_deadline_belt: false,
    })

    for (const envelope of capsule.capsules) {
      observed_at = envelope.observed_at_ms
      const { payload } = envelope
      if (payload.kind === 'journal_rows_received' && payload.source === 'journal') {
        const { rows } = payload
        const last = rows.events?.at(-1)?.seq ?? rows.head
        latest_event_source.emit(rows, last)
      } else {
        streamed = ingest(streamed, envelope, observed_at)
      }
    }

    expect(project_board(streamed)).toEqual(project_board(direct))
    expect(latest_event_source.url).toContain(`/v1/stream/fight/${capsule.session_id}`)
    expect(statuses).toContain('connected')
    close()
    expect(latest_event_source.readyState).toBe(2)
  })

  test('the reconnect cursor is seeded from the fold and every frame remains a journal-door message', () => {
    let messages = []
    const close = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => '41',
      input: (message) => {
        messages = [...messages, message]
      },
      event_source_factory: fake_event_source,
      base_url: 'https://rpc.test',
      install_deadline_belt: false,
    })
    expect(new URL(latest_event_source.url).searchParams.get('lastEventId')).toBe('41')
    latest_event_source.emit(
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

// THE SERVER WIRE — packages/rpc/indexer/src/stream.rs emits ONE journal row per frame, named `fight`
// (`:276`), `data` = `{ kind, data, digest, version }` (`:267-272`). A named event never reaches `onmessage`,
// and a row with no foldable `seq` is not a journal row at all: both are pinned here so a wire change is a
// test failure instead of a silently empty fight.
describe('the #1382 fight wire → one journal row per frame', () => {
  test('a named `fight` frame becomes one journal batch through the same door', () => {
    let messages = []
    const close = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => null,
      input: (message) => {
        messages = [...messages, message]
      },
      event_source_factory: fake_event_source,
      base_url: 'https://rpc.test',
      install_deadline_belt: false,
    })
    latest_event_source.emit_named(
      'fight',
      { seq: '42', kind: 'TurnEnded', data: { turn: '3' }, digest: 'abc', version: '9' },
      '4200:19'
    )
    expect(messages).toHaveLength(1)
    expect(messages[0].batch).toMatchObject({ fight_id: '0xfight', source: 'journal', head: '42' })
    expect(messages[0].batch.events[0]).toMatchObject({ seq: '42', kind: 'TurnEnded', digest: 'abc', version: '9' })
    close()
  })

  test('a row with no foldable seq is refused — never folded under an invented ordinal', () => {
    let messages = []
    const close = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => null,
      input: (message) => {
        messages = [...messages, message]
      },
      event_source_factory: fake_event_source,
      base_url: 'https://rpc.test',
      install_deadline_belt: false,
    })
    latest_event_source.emit_named('fight', { kind: 'TurnEnded', data: {}, version: '9' }, '4200:19')
    expect(messages).toEqual([])
    close()
  })

  test('the retry budget is finite: the source is CLOSED and the failure surfaced, never an immortal loop', () => {
    let statuses = []
    const close = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => null,
      input: () => {},
      event_source_factory: fake_event_source,
      base_url: 'https://rpc.test',
      set_status: (status, error) => {
        statuses = [...statuses, [status, error]]
      },
      install_deadline_belt: false,
    })
    for (let attempt = 0; attempt <= REJOIN_MAX_ATTEMPTS; attempt++) latest_event_source.fail()
    expect(latest_event_source.readyState).toBe(2)
    expect(statuses.at(-1)[0]).toBe('failed')
    expect(statuses.at(-1)[1]).toContain(String(REJOIN_MAX_ATTEMPTS + 1))
    close()
  })
})

describe('#1381 deadline-proximity read belt', () => {
  test('schedules one direct read at deadline −5s, dedupes the same anchor, and has no interval cadence', async () => {
    let deadline = 20_000
    let now = 1_000
    let subscriber = null
    let scheduled = []
    let reads = 0
    const source = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => null,
      input: () => {},
      event_source_factory: fake_event_source,
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
        scheduled = [...scheduled, handle]
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
