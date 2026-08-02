// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1890 — the dev world-fight scan was FORMAT-3 BLIND. `__dev_start_world_fight` builds its candidate list from
// `zone_rows_v1` rows — which carry the pack's seated roster on `.members` (format 3, #1110) — but pushed only
// `{spawn_id, template_id, zx, zy}`, so its `create_world_fight` call named no roster. `world_group_door` then
// cross-checks the request roster against the freshly derived one and refuses `stale_stream` on EVERY format-3
// group (`errors.group_proof_unavailable`, pre-sign, zero gas): every headless world-fight drive on a format-3
// zone died with the tally `{character:0, zone:0, spawn:N}`.
//
// The door itself is CORRECT and already pinned (engage_member_roster.test.js: a roster-less request against a
// format-3 stream IS `blocked stale_stream`, a roster-ful one IS `derivation member_roster_door`). Re-asserting
// that here would be a born-green duplicate of a fact that already has a home. The UNPINNED fact — the one that
// was red — is the dev seam's REQUEST: this drives the real `__dev_start_world_fight` over a real format-3 row
// and reads what it actually asked `create_world_fight` for. Only the seam's chain/read edges are doubled.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

// The dev rig reaches the whole app module graph (store, world-shell, the fight adapter) at import time, so the
// host surface must exist FIRST — every module below is imported dynamically, after the globals are installed.
const restore_browser_globals = install_browser_globals()

const rpc_client = await import('../../src/rpc/client')
const zone_rows = await import('../../src/game/zone_rows.js')
const session_gate = await import('../../src/world-shell/session_gate.js')
const engage_actions = await import('../../src/world-shell/dungeon_engage_actions.js')
const world_fight = await import('../../src/world-shell/world_fight.js')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
// `game/store.js` is the module the rig itself reads the seated character through, and FOUR other suites
// replace it with a process-global `mock.module` stub — so the real engine context is not reachable from a
// shared test process at all. Holding the SAME binding the rig holds is what makes this drive order-proof:
// whichever object `store.context` is, doubling `get_state` on it is what the rig sees.
const game_store = await import('../../src/game/store.js')
const { install_dev_rig } = await import('../../src/game/embed_voxel_dev.js')

afterAll(restore_browser_globals)

const WORLD = `0x${'1'.repeat(64)}`
const CHICKLET = `0x${'b'.repeat(64)}`
const BOAR = `0x${'c'.repeat(64)}`
/** The pack exactly as `derive_zone` seats it on a format-3 row — trimmed, ordered, the door's own truth. */
const ROSTER = [CHICKLET, BOAR, CHICKLET]
const CHARACTER_ID = `0x${'a'.repeat(64)}`

/** A format-3 mob row (carries `.members`) and a format-1/2 one (does not) — the same stream serves both. */
const MEMBER_ROW = { kind: 'mob', spawn_id: '23', template_id: CHICKLET, index: 2, members: ROSTER }
const MONO_ROW = { kind: 'mob', spawn_id: '21', template_id: BOAR, index: 0 }

/** @type {any[]} */
let spies = []
/** Every `create_world_fight` request the scan composed, in order. */
let requests = []
/** What the doubled claim does with the request this test is driving — ONE spy, re-aimed per test. */
let claim = async (/** @type {any} */ _request) => ({ receipt: {}, fight_id: '0xfight', group: null })
/** #123 (cross-file pollution): `bun test` shares ONE process — nothing this file touches may outlive it. */
let prior_refresh = null

/** Install the rig over inert stubs: this suite drives ONE window hook, and it touches none of the 3D handles. */
const mount_rig = () =>
  install_dev_rig({
    engine: {},
    board: {},
    ctl: {},
    cam: {},
    canvas: /** @type {any} */ ({}),
    get_avatar: () => null,
    trigger_zoom_punch: () => {},
    trigger_fight_entry: () => {},
    cue_shake: () => {},
  })

beforeEach(() => {
  requests = []
  claim = async () => ({ receipt: {}, fight_id: '0xfight', group: null })
  // The mount log folds the post-claim store; the real refresh would hit the chain. Borrowed, then given back.
  prior_refresh = use_dungeon.getState().refresh
  use_dungeon.setState({ refresh: async () => {} })
  spies = [
    // The ONE fact the rig needs from the engine: who is seated. Doubled at the exact binding it reads, so
    // this drive neither dispatches into the shared reducer nor cares which store stub won the process.
    spyOn(game_store.context, 'get_state').mockReturnValue(
      /** @type {any} */ ({ selected_character_id: CHARACTER_ID })
    ),
    spyOn(session_gate, 'fetch_world_binding').mockResolvedValue(WORLD),
    spyOn(rpc_client, 'get_zones').mockResolvedValue({ zones: [{ zx: 7, zy: 9, discovered: true }] }),
    spyOn(zone_rows, 'zone_rows_v1').mockResolvedValue([MEMBER_ROW, MONO_ROW]),
    spyOn(world_fight, 'enter_world_fight').mockReturnValue(undefined),
    spyOn(engage_actions, 'create_world_fight').mockImplementation(async (request) => {
      requests.push(request)
      return claim(request)
    }),
  ]
})

afterEach(() => {
  for (const spy of spies) spy.mockRestore()
  use_dungeon.setState({ refresh: prior_refresh })
})

describe('__dev_start_world_fight composes the SAME claim request the production engage composes (#1890)', () => {
  test('a format-3 candidate carries its derived roster into the claim — the door is fed, not starved', async () => {
    mount_rig()
    const fight_id = await window.__dev_start_world_fight()

    expect(fight_id).toBe('0xfight')
    expect(requests).toHaveLength(1)
    // THE DEFECT: the roster was dropped at the candidate push, so this arrived undefined and every format-3
    // group refused `stale_stream` before signing.
    expect(requests[0].member_template_ids).toEqual(ROSTER)
    // and the rest of the request is unchanged — the roster is the ONLY thing that was missing
    expect(requests[0].world_id).toBe(WORLD)
    expect(requests[0].spawn_id).toBe('23')
    expect(requests[0].mob_template_id).toBe(CHICKLET)
    expect(requests[0].zx).toBe(7)
    expect(requests[0].zy).toBe(9)
    expect(requests[0].character_id).toBe(CHARACTER_ID)
  })

  test('a mono-spec row still names NO roster — absence is the format signal, never an invented empty pack', async () => {
    // The format-3 row refuses (exactly as a rerolled zone would), so the scan walks on to the mono-spec one.
    claim = async (request) => {
      if (request.spawn_id === '23') throw new Error('group proof unavailable')
      return { receipt: {}, fight_id: '0xmono', group: null }
    }
    mount_rig()
    const fight_id = await window.__dev_start_world_fight()

    expect(fight_id).toBe('0xmono')
    expect(requests).toHaveLength(2)
    expect(requests[0].member_template_ids).toEqual(ROSTER)
    // a row with no `.members` must hand the mono-spec door an EMPTY roster — the same fact production's
    // request row states (`Array.isArray(row.members) ? row.members : []`, spawns_zones.js)
    expect(requests[1].member_template_ids).toEqual([])
    expect(requests[1].spawn_id).toBe('21')
  })
})
