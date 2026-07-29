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
import { create_fight_store } from '@aresrpg/fight/store'
import { MOB_TURN_MS } from '@aresrpg/fight/present'
import { REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { open_fight_stream } from '../../src/world-shell/fight_sse_adapter.js'

// A solo board for the end-to-end coalescing proof: one seat, one mob, one mob turn split across frames.
const FIGHT = '0xc0a1'
const ME = '0xchar_me'
const T0 = 2_000_000
const solo_fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xme',
      character: ME,
      class: 'warrior',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 12,
      mp: 3,
      base_ap: 12,
      base_mp: 3,
      cell: 21,
      ready: true,
      casts_this_turn: 0,
      weapon: null,
    },
  ],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  turn_entropy: T0 + 30_000,
  turn_ordinal: 1,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})
const MOB_TURN_ROWS = [
  ['TurnStarted', { is_mob: true, idx: 0 }],
  ['MobMoved', { idx: 0, to_cell: 44 }],
  ['Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }],
  ['Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }],
  ['TurnEnded', { is_mob: true, idx: 0 }],
]

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
      coalesce_ms: 0,
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

// THE COALESCING WINDOW (#1649). The chain emits ONE event batch per transaction; the #1382 wire cuts it into
// one row per frame. Presentation is paced PER BATCH (a peer turn = one 3s slot), so a transport that delivers
// its rows one at a time buys a 3s slot per ROW — a peer's five-row turn would take fifteen seconds to watch.
// The transport reassembles what the wire fragmented: rows are held for one short window and handed to the door
// as ONE batch. A page-shaped frame (the walker's own wire) is not fragmented and never enters the buffer.
describe('#1649 journal coalescing — the wire fragments a batch, the transport reassembles it', () => {
  const stream_with_clock = (options = {}) => {
    const now = 1_000
    let scheduled = []
    const close = open_fight_stream({
      fight_id: '0xfight',
      cursor: () => null,
      event_source_factory: fake_event_source,
      base_url: 'https://rpc.test',
      install_deadline_belt: false,
      now: () => now,
      set_timeout: (fn, delay) => {
        const handle = { fn, delay, cleared: false }
        scheduled = [...scheduled, handle]
        return handle
      },
      clear_timeout: (handle) => {
        handle.cleared = true
      },
      ...options,
    })
    return { close, fire: () => scheduled.filter((h) => !h.cleared).forEach((h) => h.fn()), scheduled: () => scheduled }
  }

  const row = (seq, kind, data, version = '9') => ({ seq: String(seq), kind, data, digest: 'abc', version })

  test('rows arriving one per frame reach the door as ONE batch, in order', () => {
    let messages = []
    const { close, fire } = stream_with_clock({
      input: (message) => {
        messages = [...messages, message]
      },
    })
    latest_event_source.emit_named('fight', row(42, 'Cast', { fight: '0xfight' }))
    latest_event_source.emit_named('fight', row(43, 'Hit', { fight: '0xfight' }))
    latest_event_source.emit_named('fight', row(44, 'TurnEnded', { fight: '0xfight' }))
    expect(messages, 'the window holds the burst').toEqual([])
    fire()
    expect(messages).toHaveLength(1)
    expect(messages[0].batch.events.map((event) => [event.seq, event.kind])).toEqual([
      ['42', 'Cast'],
      ['43', 'Hit'],
      ['44', 'TurnEnded'],
    ])
    expect(messages[0].batch.head).toBe('44')
    close()
  })

  test('a page-shaped frame is never buffered: it flushes the held rows and rides through untouched', () => {
    let messages = []
    const { close } = stream_with_clock({
      input: (message) => {
        messages = [...messages, message]
      },
    })
    latest_event_source.emit_named('fight', row(42, 'Cast', { fight: '0xfight' }))
    latest_event_source.emit({
      fight_id: '0xfight',
      source: 'journal',
      head: '50',
      events: [{ fight_id: '0xfight', seq: '50', kind: 'TurnEnded', data: {}, version: '9' }],
    })
    expect(messages.map((message) => message.batch.head)).toEqual(['42', '50'])
    close()
  })

  test('closing the stream flushes what it still holds — a row is never dropped on the floor', () => {
    let messages = []
    const { close } = stream_with_clock({
      input: (message) => {
        messages = [...messages, message]
      },
    })
    latest_event_source.emit_named('fight', row(42, 'Cast', { fight: '0xfight' }))
    close()
    expect(messages).toHaveLength(1)
  })

  test('PRODUCT TRUTH: a mob turn split across frames presents as ONE 3s slot, never one per row', () => {
    const store = create_fight_store()
    store
      .getState()
      .input(
        { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xme', beat_ctx: { grid_width: 20 } } },
        T0
      )
    store.getState().input({ type: 'snapshot', fight: solo_fight_object(), version: 2 }, T0 + 50)

    const { close, fire } = stream_with_clock({
      fight_id: FIGHT,
      input: (message) => store.getState().input(message, T0 + 500),
    })
    for (const [index, [kind, data]] of MOB_TURN_ROWS.entries())
      latest_event_source.emit_named('fight', row(10 + index, kind, { fight: FIGHT, ...data }, '3'))
    fire()
    close()

    const paced = store.getState().wave.filter((turn) => !turn.is_local)
    expect(
      paced.map((turn) => String(turn.source_id)),
      'the mob turn presents — once'
    ).toEqual(['mob-0'])
    expect(paced[0].duration).toBe(MOB_TURN_MS)
    expect(paced[0].beats.map((beat) => beat.kind)).toContain('damage')
    // The whole point: five rows would have been five 3s slots without the window.
    expect(store.getState().wave.reduce((total, turn) => total + turn.duration, 0)).toBe(MOB_TURN_MS)
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
