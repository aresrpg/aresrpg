// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WORLD→FIGHT HANDOFF SEAM — the composition-root integration test the two headless scenarios stop short
// of: @aresrpg/world's W4 journey ENDS at `claim_receipt → fight_entry {fight_id}` and @aresrpg/fight's solo
// scenario STARTS from an opened door — nothing crossed the seam between them. Five composite driven-gate
// attempts (2026-07-18) died in that blind spot: the press fired the real claim+create tx and the chain fight
// existed, while the observer read nothing (the gold rig's snapshot imported the M1a-deleted /src/fight path —
// its own trace shows GET /src/fight/index.js → 404, swallowed by the poll's catch). This test drives the REAL
// frontend ferry across the seam headlessly so a break in the PIPELINE (as opposed to the observer) can never
// hide again:
//
//   world core claim_intent → the claim tx_request engage() executes (payload contract pinned)
//   → claim_receipt → row tombstoned + the fight_entry seam output
//   → enter_world_fight (the receipt ferry) → use_dungeon session + init through @aresrpg/fight's ONE door
//   → the receipt-first hold (first object read NOT FOUND — the exact +33ms read-after-write wrinkle the
//     attempt-5 trace recorded) → backoff retry → snapshot fold → `fight_view()` shows the fight
//
// `fight_view()` is asserted LAST because it is byte-for-byte the read the gold rig's snapshot performs — one
// atom, one door: if the ferry ever writes a different store instance than consumers read (the duplicate-atom
// class), this goes red. Test seams: the house idiom only (auth mock, expedition SDK mock, fetch stub) — no
// module mocks beyond the sanctioned helpers.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xworldfight'
const WORLD_ID = '0xworld'
const TEMPLATE_ID = '0xmobtemplate'
const STATUS_PLACEMENT = 5
// A 100×100-zone world, bounds 1000 → offset 500: chain (520, 540) = world (20, 40) — the W4 journey's own doc.
const WORLD_DOC = { zone_size: 100, bounds_x: 1000, bounds_z: 1000, zone_ttl_ms: 60_000 }
const SPAWN_KEY = '5:5:mob:7'

let read_response = /** @type {(object_id: string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => read_response(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../auth')
const { _reset_rpc_client_for_test } = await import('../rpc/client')
const { use_dungeon } = await import('./dungeon_store.js')
const { fight_store, fight_view, board_view } = await import('@aresrpg/fight')
const { spawns_store, spawns_input } = await import('./spawns_adapter.js')
const { enter_world_fight } = await import('./world_fight.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

/** A `json:true`-flattened `fight::Fight` read, minimal but decode_fight-complete — including the REAL
 *  `board: BoardGeom` a whole chain read always carries (13×12, ≠ the 20×19 fallback frame, so a degraded
 *  present is distinguishable from the true one by dimensions alone). */
const fight_object = () => ({
  object: {
    json: {
      id: FIGHT_ID,
      world: WORLD_ID,
      status: STATUS_PLACEMENT,
      placement_deadline_ms: String(Date.now() + 25_000),
      turn_deadline_ms: '0',
      last_action_ms: '0',
      participants: [{ addr: OWNER, character: CHARACTER_ID, cell: 0, ready: false, hp: 30, alive: true }],
      mobs: [],
      queue: [],
      turn_ptr: 0,
      board: {
        width: 13,
        height: 12,
        shape_mask: [],
        obstacles: [],
        holes: [],
        start_cells_a: [5, 6, 7],
        start_cells_b: [230, 231],
      },
      group: {},
    },
    version: '9',
  },
})

/** The TORN read of the adaptive-run record: the object json served WITHOUT its BoardGeom (`board: {}` —
 *  decode_fight maps it to width/height 0, empty start cells). The read-after-write hole can serve this
 *  between the receipt and the settled object — it must HOLD, never present. */
const degraded_fight_object = () => {
  const read = fight_object()
  read.object.json.board = {}
  return read
}

const until = async (predicate, timeout_ms = 3000) => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return predicate()
}

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  globalThis.fetch = mock(
    async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  )
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null }) // reset the core atom
  spawns_input({ type: 'world_bound', world_id: null }) // a world change is a RESET input — the core's own reset door
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  spawns_input({ type: 'world_bound', world_id: null })
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('the world→fight handoff seam (composition root)', () => {
  test('claim intent → receipt → enter → receipt-first hold → the fight core view shows the fight', async () => {
    // ── the WORLD half: a discovered zone with one claimable group, the player standing at it ──
    spawns_input({ type: 'world_bound', world_id: WORLD_ID })
    spawns_input({ type: 'world_doc', doc: WORLD_DOC })
    spawns_input({
      type: 'zone_rows',
      zx: 5,
      zy: 5,
      proven: true,
      rows: [{ spawn_id: '7', kind: 'mob', x: 520, z: 540, template_id: TEMPLATE_ID, size: 3 }],
    })
    spawns_input({ type: 'player_pos', x: 21, z: 41 }) // ~1.4 blocks from the group's world anchor (20, 40)

    // ── CLAIM INTENT through the door: the pending hide + the exact tx request engage() executes ──
    spawns_input({ type: 'claim_intent', key: SPAWN_KEY })
    expect(spawns_store.getState().pending.has(`claim:${SPAWN_KEY}`)).toBe(true)
    const request = spawns_store.getState().tx_request
    // the payload CONTRACT world_spawns.engage destructures — a silent rename here strands the claim PTB
    expect(request).toMatchObject({
      kind: 'claim',
      payload: {
        world_id: WORLD_ID,
        spawn_id: '7',
        zx: 5,
        zy: 5,
        template_id: TEMPLATE_ID,
        is_public: true,
      },
    })

    // ── the CLAIM RECEIPT: row tombstoned + the fight_entry seam output (W4's terminal fact) ──
    spawns_input({ type: 'claim_receipt', key: SPAWN_KEY, fight_id: FIGHT_ID })
    const rows = [...spawns_store.getState().zones.values()].flatMap((zone) => [...zone.rows.keys()])
    expect(rows).toEqual([]) // receipt-proven removal — the claimed group is gone
    expect(spawns_store.getState().fight_entry).toMatchObject({ fight_id: FIGHT_ID })

    // ── the FERRY: the create receipt's fight_id enters the shared session + @aresrpg/fight's one door.
    // The object read throws NOT FOUND on the FIRST attempt (the attempt-5 trace's +33ms read-after-write
    // wrinkle: `fight_adoption_exact_read_missing, definitively_gone: true`) — receipt truth must HOLD the
    // session and retry, never drop it.
    let fight_reads = 0
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`object not found: ${object_id}`) // world read → default offsets
      fight_reads += 1
      if (fight_reads === 1) throw new Error('object not found (read-after-write lag)')
      return fight_object()
    }
    enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: CHARACTER_ID })

    // the session published SYNCHRONOUSLY off the receipt (client-independence: never an empty shell)
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().dungeon_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().run_pass_id).toBeNull()
    expect(use_dungeon.getState().fight_fresh).toBe(true) // a fresh create — the entry cinematic's gate
    // the fight core's ONE atom got the id through its ONE door (init) — pre-read, view still null
    expect(fight_store.getState().fight_id).toBe(FIGHT_ID)

    // ── the receipt-first backoff retries past the missing read and folds the snapshot ──
    expect(await until(() => fight_view()?.fight_id === FIGHT_ID)).toBe(true)
    // fight_view() is THE read the gold rig's snapshot performs: same package atom, same projection —
    // if the ferry wrote a different store instance (the duplicate-atom class), this line is the red.
    const view = fight_view()
    expect(view.fight_id).toBe(FIGHT_ID)
    expect([...view.fighters.keys()]).toContain(CHARACTER_ID) // my seat decoded from the read
    expect(fight_reads).toBeGreaterThanOrEqual(2) // the hold+retry actually happened (never a drop)
    expect(await until(() => use_dungeon.getState().fight_syncing === false)).toBe(true) // hydrated, chip off
  })

  test('the DEGRADED window: a torn read (BoardGeom missing) presents NOTHING and heals to the exact frame', async () => {
    // The adaptive-run mechanism (lane ADOPTION_SEAM): read 1 NOT FOUND (+33ms read-after-write), read 2 the
    // TORN record (json without its board), read 3+ the whole object — gated shut until this test releases it,
    // so the torn window is inspectable deterministically (the retry loop is strictly sequential).
    let release_healed = () => {}
    const healed_gate = new Promise((resolve) => {
      release_healed = resolve
    })
    let fight_reads = 0
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`object not found: ${object_id}`) // world read → default offsets
      fight_reads += 1
      if (fight_reads === 1) throw new Error('object not found (read-after-write lag)')
      if (fight_reads === 2) return degraded_fight_object()
      await healed_gate
      return fight_object()
    }
    enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: CHARACTER_ID })
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID) // receipt truth published synchronously

    // the torn read was served — through its fold and the following backoff, NOTHING may present. The red of
    // record: the fold adopted the torn record and board_view presented the 20×19 fallback frame with ZERO
    // start cells (the recorded composite: board mounted, no placement highlight glowing).
    expect(await until(() => fight_reads >= 2)).toBe(true)
    expect(await until(() => board_view(fight_store.getState()) !== null, 700)).toBe(false)

    // the loop retried PAST the torn read (held it, never adopted it as hydrated)…
    expect(await until(() => fight_reads >= 3)).toBe(true)
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID) // …with the session held…
    expect(use_dungeon.getState().fight_syncing).toBe(true) // …and the syncing chip still honest

    // …and the healed read presents the REAL frame: the fight's own dimensions + glowing start cells.
    release_healed()
    expect(await until(() => board_view(fight_store.getState())?.grid_width === 13)).toBe(true)
    const presented = board_view(fight_store.getState())
    expect(presented.grid_height).toBe(12)
    expect(presented.start_cells_a).toEqual([5, 6, 7]) // placement highlights EXIST on the presented frame
    expect(fight_view()?.fight_id).toBe(FIGHT_ID)
    expect(await until(() => use_dungeon.getState().fight_syncing === false)).toBe(true)
  })
})
