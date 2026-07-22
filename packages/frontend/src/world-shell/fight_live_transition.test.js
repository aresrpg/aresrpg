// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// P0 — the LIVE fight-state transition observer. A .49 client that bootstrapped a fight (placement OR an active
// turn) STOPPED following the chain's next canonical edge: the placement→ACTIVE force_start left the client on a
// dead "POSITION YOUR TEAM 0:00" screen, and a passive turn-advance never moved. A manual refresh (a fresh
// bootstrap) always landed correct — proving the BOOTSTRAP path works and the LIVE observer does not.
//
// ROOT: M2b (#291) demoted the Fight OBJECT read to a checkpoint-only snapshot — the fold's status/turn advance
// ONLY on canonical JOURNAL events now. The 4s poll is the passive-observer live feed (a force_start / a peer or
// mob turn advances the journal with NO receipt of OURS to fold), but the poll only walked the journal when
// `journal_gap` was set, and the checkpoint that was meant to set it reads `msg.journal_head` — which the gRPC
// object read never carries (journal_head is a /v1-derived ZCARD, not an on-chain field), so the poll NEVER
// walked for a passive observer. These specs drive the REAL `refresh()` poll (a mocked object read + a mocked
// /v1 journal page) and assert the phase projection / turn actor follow on the LIVE path.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xme'
const CHARACTER_ID = '0xhero'
const FIGHT_ID = '0xlivefight'
const GROUP = '0xgroup'
const FUTURE = () => Date.now() + 1_000_000 // far-future deadlines — never trip the liquidation crank/force_start

// The ENGINE `fight.status` scalars (fight.move — the raw on-chain value `decode_fight` reads), NOT the legacy
// projected STATUS_* codes: board_state maps 0→PLACEMENT, 1→ACTIVE.
const ENGINE_PLACEMENT = 0
const ENGINE_ACTIVE = 1

// The RAW `json:true`-flattened Fight object the poll reads (`decode_fight` consumes it — board geometry NESTED
// under `board`, group content under `group.kit`); `status` is the ENGINE scalar. The object read is a CHECKPOINT
// after bootstrap — its status never re-adopts, so the live flip can only come from the folded journal (that is
// exactly what these specs prove).
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

// The gRPC object read the poll makes (read_object → sdk.grpc_client.core.getObject → { object:{ json, version } }).
let object_read = raw_fight({ status: ENGINE_PLACEMENT })
const OBJECT_VERSION = '1'
const get_object = mock(async ({ objectId }) => {
  if (objectId === FIGHT_ID) return { object: { json: object_read, version: OBJECT_VERSION } }
  throw new Error(`unexpected object read: ${objectId}`)
})
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

// The /v1 journal the walker pages (`GET /v1/fights/{id}/events?from&limit`). `journal` is the growing ordered
// log; the page serves the tail from `from` and reports `journal_head` = the event COUNT (the ZCARD semantics
// seed_accept_state reads). Everything else is unmocked → RpcError → the walker degrades to a no-op.
let journal = /** @type {{ seq: string, kind: string, version: string, digest: string, data: any }[]} */ ([])
const json_response = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const { use_auth } = await import('../auth')
const { _reset_rpc_client_for_test } = await import('../rpc/client')
const { use_dungeon } = await import('./dungeon_store.js')
const { fight_store } = await import('@aresrpg/fight/store')
const project = await import('@aresrpg/fight/project')
const { derive_phase, PHASE, STATUS_ACTIVE, STATUS_PLACEMENT } = await import('../fight-engine/phase.js')
const { reset_liquidation } = await import('./fight-liquidation.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

// The exact phase source the placement screen reads (use_fight_phase.js), reproduced over the live projections.
const live_phase = () => {
  const { dungeon } = use_dungeon.getState()
  const fight = project.fight_view()
  const character_id = fight?.my_entity_id ?? null
  const my_seat = character_id
    ? (dungeon?.escrow?.find((p) => (p.character ?? p.character_id) === character_id) ?? null)
    : null
  return derive_phase(dungeon, fight, my_seat)
}

const seat_a_fight_in = (status) => {
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
    // pre-seed the group identity so refresh's mob-identity resolve is a no-op (no extra sdk read)
    mob_names: { [GROUP]: 'Mob' },
    mob_levels: { [GROUP]: 1 },
    mob_elements: { [GROUP]: 255 },
  })
}

// One poll tick: bust the 3s rpc cache (the real poll cadence is 4s > TTL, so every tick reaches the network) and
// run the real refresh.
const poll = async () => {
  _reset_rpc_client_for_test()
  await use_dungeon.getState().refresh()
}

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  reset_liquidation()
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  globalThis.fetch = mock(async (input) => {
    const url = new URL(String(input), 'http://rpc.test')
    if (url.pathname.endsWith(`/v1/fights/${FIGHT_ID}/events`)) {
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
  _reset_rpc_client_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('the LIVE fight-state transition observer follows the chain edge on the poll (not only on bootstrap)', () => {
  test('symptom ①: a force_start (placement→ACTIVE) folded from the journal flips the phase on the next poll', async () => {
    seat_a_fight_in(ENGINE_PLACEMENT)

    // bootstrap poll — the placement window is genuinely live.
    await poll()
    expect(project.board_view(fight_store.getState()).status).toBe(STATUS_PLACEMENT)
    expect(live_phase().phase).toBe(PHASE.PLACEMENT)

    // the chain force_start fired: the journal now carries the first TurnStarted (my seat). The object read stays
    // PLACEMENT on purpose (a checkpoint never re-adopts) — so any flip PROVES the journal drove it.
    journal = [
      {
        seq: '0',
        kind: 'TurnStarted',
        version: '2',
        digest: '0xforce',
        data: { fight: FIGHT_ID, is_mob: false, idx: 0, deadline_ms: FUTURE() },
      },
    ]

    await poll()

    // the observer FOLLOWED the edge — the dead placement screen becomes the live board.
    expect(project.board_view(fight_store.getState()).status).toBe(STATUS_ACTIVE)
    expect(live_phase().phase).toBe(PHASE.ACTIVE)
  })

  test('symptom ③: a passive turn-advance (my turn → mob turn) folded from the journal moves the active actor on the next poll', async () => {
    seat_a_fight_in(ENGINE_ACTIVE)

    await poll()
    // bootstrapped mid-fight on MY turn.
    expect(project.fight_view().active_entity_id).toBe(CHARACTER_ID)

    // the turn advanced on-chain with no receipt of mine: my TurnEnded + the mob's TurnStarted land in the journal.
    journal = [
      {
        seq: '0',
        kind: 'TurnEnded',
        version: '2',
        digest: '0xadv',
        data: { fight: FIGHT_ID, is_mob: false, idx: 0 },
      },
      {
        seq: '1',
        kind: 'TurnStarted',
        version: '2',
        digest: '0xadv',
        data: { fight: FIGHT_ID, is_mob: true, idx: 0, deadline_ms: FUTURE() },
      },
    ]

    await poll()

    // the active actor followed the edge to the mob — the turn advanced on the LIVE path.
    expect(project.fight_view().active_entity_id).toBe('mob-0')
  })
})
