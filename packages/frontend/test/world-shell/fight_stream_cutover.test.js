// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE SSE CUTOVER (#1384) — the client half exists (fight_sse_adapter.js) and the server half is live
// (packages/rpc/indexer/src/stream.rs), but nothing wired the two: a live fight still learned every canonical
// edge from the 4s REST poll. These specs drive the REAL `refresh()` poll with a REAL `EventSource` global (the
// production default seam — no test-only injection point exists in the store) and pin the three properties the
// cutover has to hold:
//
//  ① THE STREAM FEEDS THE FOLD — a frame folds the event through the SAME journal door with NO page fetched.
//  ② THE FALLBACK HOLDS — a 404 stream (today's production shape: /v1/stream/* is not deployed yet) and a
//    runtime with no EventSource at all both leave the fight on REST paging, still following the chain edge.
//  ③ TRANSPORT PARITY (the class gate against divergence) — ONE captured wire row, ingested through the stream
//    and through the REST pager, produces byte-identical events. Neither transport shapes an event: both hand
//    the same bytes to the ONE normalizer, and the fold's own accepted head is the ONE resume cursor.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { normalize_journal_page } from '@aresrpg/fight/journal_normalize'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'
import { fight_stream_message } from '../../src/world-shell/fight_sse_adapter.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xme'
const CHARACTER_ID = '0xhero'
const FIGHT_ID = '0xstreamfight'
const GROUP = '0xgroup'
const FUTURE = () => Date.now() + 1_000_000

const ENGINE_PLACEMENT = 0
const ENGINE_ACTIVE = 1

// The raw `json:true` Fight object the poll reads — a CHECKPOINT after bootstrap (its status never re-adopts), so
// any status flip below PROVES a folded journal event drove it, not the object read.
const raw_fight = ({ status, ready = false }) => ({
  id: FIGHT_ID,
  world: null,
  spawn_id: 1,
  world_seed: 1,
  anchor_x: 0,
  anchor_z: 0,
  public_fight: true,
  party_id: null,
  aged_bp: 0,
  turn_ms: 30000,
  placement_ms: 30000,
  team_bound: 3,
  status,
  participants: [
    {
      owner: OWNER,
      character: CHARACTER_ID,
      class: 'senshi',
      team: 0,
      hp: 40,
      max_hp: 40,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 20,
      ready,
      casts_this_turn: 0,
    },
  ],
  mobs: [{ level: 1, hp: 20, max_hp: 20, cell: 100, ap: 4, mp: 3 }],
  board: { width: 20, height: 19, shape_mask: [], obstacles: [], holes: [], start_cells_a: [20], start_cells_b: [25] },
  group: { template: GROUP, xp: 0, kit: { base_ap: 4, base_mp: 3 } },
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: status === ENGINE_ACTIVE ? FUTURE() : 0,
  last_action_ms: 0,
  placement_deadline_ms: status === ENGINE_PLACEMENT ? FUTURE() : 0,
})

let object_read = raw_fight({ status: ENGINE_PLACEMENT })
const get_object = mock(async ({ objectId }) => {
  if (objectId === FIGHT_ID) return { object: { json: object_read, version: '1' } }
  throw new Error(`unexpected object read: ${objectId}`)
})
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

// The /v1 REST journal (`GET /v1/fights/{id}/events?from&limit`) — the pager the cutover demotes to catch-up.
let journal = /** @type {{ seq: string, kind: string, version: string, digest: string, data: any }[]} */ ([])
let journal_reads = 0
const json_response = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

// ── THE FAKE WIRE. `EventSource` is a GLOBAL in production (fight_sse_adapter's default factory constructs it),
// so stubbing the global drives the exact production seam.
let sources = /** @type {any[]} */ ([])
const scripted_event_source = ({ fail_on_construct = false } = {}) =>
  function FakeEventSource(/** @type {string} */ url) {
    let ready_state = 0
    let listeners = new Map()
    const source = {
      url,
      get readyState() {
        return ready_state
      },
      addEventListener(/** @type {string} */ type, /** @type {Function} */ listener) {
        listeners = new Map([...listeners, [type, listener]])
      },
      close() {
        ready_state = 2
      },
      open() {
        ready_state = 1
        listeners.get('open')?.()
      },
      // ONE `fight` frame, exactly as stream.rs emits it (named event + the chain cursor as the SSE id).
      emit_fight(/** @type {any} */ payload, /** @type {string} */ id) {
        listeners.get('fight')?.({ data: JSON.stringify(payload), lastEventId: id })
      },
      // A 404 is a FATAL EventSource error: the browser fails the connection and parks readyState at CLOSED.
      not_found() {
        ready_state = 2
        listeners.get('error')?.()
      },
    }
    sources = [...sources, source]
    if (fail_on_construct) queueMicrotask(() => source.not_found())
    return source
  }

const { use_auth } = await import('../../src/auth')
const { _reset_rpc_client_for_test } = await import('../../src/rpc/client')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { fight_store } = await import('@aresrpg/fight/store')
const project = await import('@aresrpg/fight/project')
const { STATUS_ACTIVE, STATUS_PLACEMENT } = await import('../../src/fight-engine/phase.js')
const { reset_liquidation } = await import('../../src/world-shell/fight-liquidation.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch
const real_event_source = globalThis.EventSource

const seat_a_fight_in = (/** @type {number} */ status) => {
  object_read = raw_fight({ status, ready: status === ENGINE_PLACEMENT })
  journal = []
  fight_store.getState().input({ type: 'init', fight_id: FIGHT_ID })
  use_dungeon.setState({
    fight_id: FIGHT_ID,
    dungeon_id: FIGHT_ID,
    world_id: null,
    character_id: CHARACTER_ID,
    run_pass_id: null,
    run: null,
    rooms: [],
    phase: 'playing',
    fight_syncing: false,
    session_address: OWNER,
    mob_names: { [GROUP]: 'Mob' },
    mob_levels: { [GROUP]: 1 },
    mob_elements: { [GROUP]: 255 },
  })
}

/** One poll tick — bust the 3s rpc cache (the real 4s cadence always reaches the network) and run REAL refresh. */
const poll = async () => {
  _reset_rpc_client_for_test()
  await use_dungeon.getState().refresh()
}

/** Let the stream's own async work (the connect catch-up walk, a folded frame) settle. */
const settle = async () => {
  for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  sources = []
  globalThis.EventSource = scripted_event_source()
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  reset_liquidation()
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  journal_reads = 0
  globalThis.fetch = mock(async (input) => {
    const url = new URL(String(input), 'http://rpc.test')
    if (url.pathname.endsWith(`/v1/fights/${FIGHT_ID}/events`)) {
      journal_reads += 1
      const from = Number(url.searchParams.get('from') ?? 0)
      const events = journal.filter((e) => Number(e.seq) >= from)
      return json_response({ fight: FIGHT_ID, events, journal_head: journal.length })
    }
    throw new Error(`unexpected fetch: ${url.pathname}`)
  })
  _reset_rpc_client_for_test()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  reset_liquidation()
  globalThis.fetch = real_fetch
  globalThis.EventSource = real_event_source
  _reset_rpc_client_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('① the stream is the live event source — the fold advances with no page fetched', () => {
  test('a `fight` frame folds the force_start through the journal door without any REST paging', async () => {
    seat_a_fight_in(ENGINE_PLACEMENT)

    await poll() // bootstrap: the placement window is genuinely live, and the poll binds the stream
    await settle()
    expect(project.board_view(fight_store.getState()).status).toBe(STATUS_PLACEMENT)
    expect(sources).toHaveLength(1)
    expect(sources[0].url).toContain(`/v1/stream/fight/${FIGHT_ID}`)

    sources[0].open() // the stream connects — its catch-up walk pages whatever the fold has not accepted yet
    await settle()

    // From here the REST pager is FROZEN: every read below has to come from the wire.
    const reads_before = journal_reads
    sources[0].emit_fight(
      {
        seq: 0,
        kind: 'TurnStarted',
        data: { fight: FIGHT_ID, is_mob: false, idx: 0, deadline_ms: FUTURE() },
        digest: '0xforce',
        version: '2',
      },
      '90:7'
    )
    await settle()

    expect(project.board_view(fight_store.getState()).status).toBe(STATUS_ACTIVE)
    expect(journal_reads).toBe(reads_before)
  })
})

describe('② the fallback holds — a fight never depends on the stream being deployed', () => {
  test('a 404 stream leaves the fight on REST paging and it still follows the chain edge', async () => {
    globalThis.EventSource = scripted_event_source({ fail_on_construct: true })
    seat_a_fight_in(ENGINE_ACTIVE)

    await poll()
    await settle()
    expect(project.fight_view().active_entity_id).toBe(CHARACTER_ID)
    expect(sources.at(-1).readyState).toBe(2) // the wire is gone, exactly as it is in production today

    journal = [
      { seq: '0', kind: 'TurnEnded', version: '2', digest: '0xadv', data: { fight: FIGHT_ID, is_mob: false, idx: 0 } },
      {
        seq: '1',
        kind: 'TurnStarted',
        version: '2',
        digest: '0xadv',
        data: { fight: FIGHT_ID, is_mob: true, idx: 0, deadline_ms: FUTURE() },
      },
    ]
    const reads_before = journal_reads
    await poll()
    await settle()

    expect(journal_reads).toBeGreaterThan(reads_before)
    expect(project.fight_view().active_entity_id).toBe('mob-0')
  })

  test('a runtime with no EventSource at all polls exactly as before — the bind never throws into refresh', async () => {
    // @ts-expect-error — the pre-EventSource / non-browser runtime shape
    delete globalThis.EventSource
    seat_a_fight_in(ENGINE_ACTIVE)

    await poll()
    journal = [
      { seq: '0', kind: 'TurnEnded', version: '2', digest: '0xadv', data: { fight: FIGHT_ID, is_mob: false, idx: 0 } },
      {
        seq: '1',
        kind: 'TurnStarted',
        version: '2',
        digest: '0xadv',
        data: { fight: FIGHT_ID, is_mob: true, idx: 0, deadline_ms: FUTURE() },
      },
    ]
    await poll()
    await settle()

    expect(use_dungeon.getState().error).toBeNull()
    expect(project.fight_view().active_entity_id).toBe('mob-0')
  })
})

// ③ THE PARITY PIN — captured wire bytes, both transports, one normalizer.
//
// PROVENANCE: the row is the exact frame `packages/rpc/indexer/src/stream.rs` emits, pinned server-side by its
// own `fight_frame_carries_the_journal_sequence` test (`{"seq":12,"kind":"Placed","data":{"cell":"4"},
// "digest":"a","version":"1"}`, SSE id `90:7`), and the REST twin is the entry `handle_fight_events` serves
// (packages/rpc/api/views.js:1201 — the identical `{ seq, kind, data, digest, version }` field set).
describe('③ transport parity — the stream and the pager cannot shape an event differently', () => {
  const WIRE_ROW = { seq: 12, kind: 'Placed', data: { cell: '4' }, digest: 'a', version: '1' }
  const SSE_ID = '90:7'

  test('one captured row folds byte-identically whether it arrives by stream or by page', () => {
    const streamed = fight_stream_message({ data: JSON.stringify(WIRE_ROW), lastEventId: SSE_ID }, FIGHT_ID)
    const paged = normalize_journal_page(
      { fight: FIGHT_ID, events: [WIRE_ROW], journal_head: 13 },
      { fight_id: FIGHT_ID }
    )

    expect(streamed.batch.events).toEqual(paged.events)
    expect(JSON.stringify(streamed.batch.events)).toBe(JSON.stringify(paged.events))
    expect(streamed.batch.source).toBe(paged.source)
  })

  test('the SSE id is a CHAIN cursor and never becomes the fold ordinal', () => {
    // `90:7` is `<checkpoint>:<event-index>` (stream.rs FightCursor) — not a u64 seq. A frame whose row carries
    // no `seq` must be refused rather than folded under the transport's id.
    const seqless = fight_stream_message(
      { data: JSON.stringify({ kind: 'Placed', data: { cell: '4' }, digest: 'a' }), lastEventId: SSE_ID },
      FIGHT_ID
    )
    expect(seqless).toBeNull()
  })
})
