// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1110, the wave's last leg): the engine door for FORMAT-3 (member-roster) groups shipped in the SDK
// (`create_member_fight_ptb`) and the world fold now rides the roster into the claim request — but the shipped
// engage action still composed the mono-spec PTB for every group. A format-3 group was therefore claimable by an
// SDK consumer and INVISIBLE-UNCLAIMABLE in the real client, and it would have stayed that way the moment the
// chain ceremony flips searches to format 3.
//
// This drives the REAL create_world_fight (only its chain edges — kiosk, /v1 fights, the tx choke — are doubled),
// so the composer CHOICE is proven behaviorally, not read off the source. The door leg stays pure: a member-roster
// claim takes NO witness, which is a decision this file pins, not an omission.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as sdk_fight from '@aresrpg/sdk/fight'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

// The engage graph pulls in the browser wallet registration at module load, so every one of its modules is
// imported DYNAMICALLY — after the host surface exists. A static import here would evaluate `../auth` first.
const restore_browser_globals = install_browser_globals()

const rpc_client = await import('../rpc/client')
const kiosk_resolve = await import('./kiosk_resolve.js')
const dungeon_actions = await import('./dungeon_actions.js')
const { create_world_fight, world_group_door } = await import('./dungeon_engage_actions.js')
const { use_auth } = await import('../auth')

afterAll(restore_browser_globals)

const CHICKLET = `0x${'b'.repeat(64)}`
const BOAR = `0x${'c'.repeat(64)}`
const ROSTER = [CHICKLET, BOAR, CHICKLET]
const HANDLE = { kiosk_id: '0xk1', personal_kiosk_cap_id: '0xp1' }
const ENGAGE = {
  world_id: '0x1',
  spawn_id: '23',
  // zx/zy null on purpose: the occupied-zone claim door takes no witness, so this scenario isolates the COMPOSER
  // choice from the proof door — which the member leg is asserted against separately, below.
  zx: null,
  zy: null,
  mob_template_id: CHICKLET,
  character_id: '0xchar',
}

/** @type {any[]} */
let spies = []
/** @type {any} */
let mono
/** @type {any} */
let member
/** The args the CURRIED composer was finally called with (`create_member_fight_ptb(ctx)(args)`). */
let member_args = null
let mono_args = null

/** #123 (cross-file pollution): `bun test src` shares ONE process — this file's auth address must never outlive it. */
let prior_address = null

beforeEach(() => {
  member_args = null
  mono_args = null
  prior_address = use_auth.getState().address ?? null
  use_auth.setState({ address: '0xme' })
  set_expedition_sdk_mock(async () => ({ grpc_client: {} }))
  mono = spyOn(sdk_fight, 'create_fight_ptb').mockReturnValue((args) => {
    mono_args = args
    return { mono: true }
  })
  member = spyOn(sdk_fight, 'create_member_fight_ptb').mockReturnValue((args) => {
    member_args = args
    return { member: true }
  })
  spies = [
    mono,
    member,
    spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(HANDLE),
    spyOn(rpc_client, 'get_fights').mockResolvedValue([]),
    spyOn(dungeon_actions, 'ctx_of').mockReturnValue({}),
    spyOn(dungeon_actions, 'sign').mockResolvedValue({ digest: '0xdeadbeef' }),
    spyOn(dungeon_actions, 'remember_created_fight').mockReturnValue('0xfight'),
  ]
})

afterEach(() => {
  for (const spy of spies) spy.mockRestore()
  reset_expedition_sdk_mock()
  use_auth.setState({ address: prior_address })
})

describe('the engage action composes the door the ROSTER decides', () => {
  test('a member roster composes the MEMBER claim door, with the seated roster in order', async () => {
    const { fight_id } = await create_world_fight({ ...ENGAGE, member_template_ids: ROSTER })
    expect(fight_id).toBe('0xfight')
    expect(member).toHaveBeenCalledTimes(1)
    expect(mono).not.toHaveBeenCalled()
    expect(member_args?.member_template_ids).toEqual(ROSTER)
    expect(member_args?.spawn_id).toBe('23')
    expect(member_args?.character_id).toBe('0xchar')
    expect(member_args?.kiosk_id).toBe(HANDLE.kiosk_id)
    expect(member_args?.personal_kiosk_cap_id).toBe(HANDLE.personal_kiosk_cap_id)
    // the member door re-derives on chain: there is no witness parameter to smuggle a proof through, and no
    // primary template either — `member_template_ids[0]` IS the primary
    expect(member_args).not.toHaveProperty('group_proof')
    expect(member_args).not.toHaveProperty('mob_template_id')
  })

  test('no roster keeps the mono-spec door — absence is the signal, and no flag exists to flip', async () => {
    await create_world_fight({ ...ENGAGE, member_template_ids: [] })
    expect(mono).toHaveBeenCalledTimes(1)
    expect(member).not.toHaveBeenCalled()
    expect(mono_args?.mob_template_id).toBe(CHICKLET)
    await create_world_fight(ENGAGE) // an omitted roster is the same fact as an empty one
    expect(mono).toHaveBeenCalledTimes(2)
    expect(member).not.toHaveBeenCalled()
  })
})

// THE DOOR — a format-3 commitment covers the WHOLE derived set, so the chain's own re-derivation is the proof
// and `create_member_fight_ptb` has no witness parameter at all. Composing one here would also be impossible:
// the commitment preimage carries the RAW rolled roster while a `derive_zone` row carries the SEATED (team-bound
// trimmed) one, so the digests could never reproduce. The door names that branch instead of blocking the engage.
describe('the member claim door is witness-free — and still fails closed on a stale stream', () => {
  const groups = [
    { index: 0, spawn_id: '21', template_id: '0x1f', x: 41, z: 51, size: 2, group_seed: '61' },
    { index: 1, spawn_id: '22', template_id: '0x20', x: 42, z: 52, size: 3, group_seed: '62' },
    { index: 2, spawn_id: '23', template_id: CHICKLET, x: 43, z: 53, size: 3, group_seed: '63', members: ROSTER },
  ]
  const base = {
    world_id: '0x1',
    spawn_id: '23',
    mob_template_id: CHICKLET,
    member_template_ids: ROSTER,
    zx: 7,
    zy: 9,
    zone: { seed: '11', discovered_at_ms: 13, mob_bitmap: [] },
    commitment: { count: 3, root: [3, ...Array(32).fill(0)] }, // `0x03 ‖ digest` — the format-3 commitment
    groups,
  }

  test('a member-roster target takes the derivation door EXPLICITLY, never a composed witness', () => {
    expect(world_group_door(base)).toEqual({ door: 'derivation', reason: 'member_roster_door' })
  })

  test('a roster the fresh stream disagrees with is a STALE STREAM refusal, not a quieter door', () => {
    // same length, one substituted member — exactly what a re-derived zone hands back after a reroll
    expect(world_group_door({ ...base, member_template_ids: [CHICKLET, CHICKLET, CHICKLET] })).toEqual({
      door: 'blocked',
      reason: 'stale_stream',
    })
    // a truncated roster is the same class of disagreement
    expect(world_group_door({ ...base, member_template_ids: [CHICKLET] })).toEqual({
      door: 'blocked',
      reason: 'stale_stream',
    })
    // and the inverse: a mono-spec claim against a stream that says this pack is a roster
    expect(world_group_door({ ...base, member_template_ids: [] })).toEqual({
      door: 'blocked',
      reason: 'stale_stream',
    })
  })

  test('the pre-sign liveness refusals still bite on a member row — a consumed group never composes', () => {
    expect(world_group_door({ ...base, zone: { ...base.zone, mob_bitmap: [0b100] } })).toEqual({
      door: 'blocked',
      reason: 'consumed',
    })
    expect(world_group_door({ ...base, spawn_id: '999' })).toEqual({ door: 'blocked', reason: 'stale_stream' })
  })
})
