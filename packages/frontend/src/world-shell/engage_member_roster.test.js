// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#2227): the format-4 proof door was gated SHUT in the client. `world_group_door` short-circuited
// EVERY member-roster group to the whole-zone derivation door on a comment claiming `create_member_fight_ptb`
// "has no `group_proof` parameter" and that composing a witness "would also be impossible" because the
// commitment binds the RAW rolled roster while a `derive_zone` row carries the trimmed one. Both halves are
// false: the SDK composer takes a witness (packages/sdk/src/fight.js `create_member_fight_ptb`), and
// `derive_zone` trims the roster to `size` exactly as the commitment does — the member-tree witness composes
// byte-for-byte against the shared Move-pinned fixture.
//
// THE LAW THIS FILE PINS: the claim door is FORMAT-DISCRIMINATED off the SERVED root's leading byte — a
// format-4 (member TREE) commitment composes the inclusion witness, a format-3 (member LIST) commitment keeps
// the derivation door unchanged. No flag, no setting: the zone's own commitment byte is the whole decision.
//
// This drives the REAL create_world_fight (only its chain edges — kiosk, /v1 fights, the zone reads, the tx
// choke — are doubled), so the composer CHOICE is proven behaviorally, not read off the source.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as sdk_fight from '@aresrpg/sdk/fight'
import * as sdk_game from '@aresrpg/sdk/game'

import { member_tree_rows, member_tree_witness } from '../../../sim/test/fixtures/zone_members_format4_witness.js'
import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

// The engage graph pulls in the browser wallet registration at module load, so every one of its modules is
// imported DYNAMICALLY — after the host surface exists. A static import here would evaluate `../auth` first.
const restore_browser_globals = install_browser_globals()

const rpc_client = await import('../rpc/client')
const zone_rows = await import('../game/zone_rows.js')
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
  // zx/zy null on purpose: the occupied-zone claim door takes no witness whatever the zone's format, so this
  // scenario isolates the COMPOSER choice from the door choice (asserted on its own seam, below).
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
    // the witness is THREADED to the member door now (#2227) — null here because the occupied-zone door takes
    // none, never because the parameter is missing. `member_template_ids[0]` IS the primary, so no template arg.
    expect(member_args).toHaveProperty('group_proof', null)
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

const hex = (bytes) => Buffer.from(Uint8Array.from(bytes)).toString('hex')
const MEMBER_TREE_ROOT = Array.from(Buffer.from(member_tree_witness.root_hex, 'hex'))
// The SAME stream under the format-3 (member LIST) tag — a whole-set digest with no per-group leaf to prove.
const MEMBER_LIST_ROOT = [3, ...MEMBER_TREE_ROOT.slice(1)]

const [TREE_TARGET] = member_tree_rows()
const tree_door = (overrides = {}) =>
  world_group_door({
    world_id: member_tree_witness.world_id,
    spawn_id: TREE_TARGET.spawn_id,
    mob_template_id: TREE_TARGET.template_id,
    member_template_ids: TREE_TARGET.members,
    zx: member_tree_witness.zx,
    zy: member_tree_witness.zy,
    zone: {
      seed: member_tree_witness.zone_seed,
      discovered_at_ms: member_tree_witness.discovered_at_ms,
      mob_bitmap: [],
    },
    commitment: { count: member_tree_rows().length, root: MEMBER_TREE_ROOT },
    groups: member_tree_rows(),
    ...overrides,
  })

describe('the member claim door is FORMAT-DISCRIMINATED — the served root byte is the whole decision', () => {
  test('a format-4 (member TREE) zone composes the inclusion witness the chain accepts', () => {
    const door = tree_door()
    expect(door.door).toBe('proof')
    expect(door.index).toBe(0)
    // byte-identical to the Move-pinned path: 4 levels × 32B over an 11-group tree
    expect(hex(door.proof.proof)).toBe(member_tree_witness.proof_hex)
    // the leaf binds the roster and the zone's progress — the two facts only the member door takes
    expect(door.proof.facts.member_template_ids).toEqual(TREE_TARGET.members)
    expect(door.proof.facts.progress).toBe(member_tree_witness.progress)
    expect(door.proof.facts.spawn_id).toBe(TREE_TARGET.spawn_id)
  })

  test('a format-3 (member LIST) zone keeps the derivation door — its digest covers the whole set, untouched', () => {
    expect(tree_door({ commitment: { count: member_tree_rows().length, root: MEMBER_LIST_ROOT } })).toEqual({
      door: 'derivation',
      reason: 'member_roster_door',
      index: 0,
    })
  })

  test('a format-4 root the local stream cannot reproduce fails SHUT — never a quieter door', () => {
    const wrong_root = [4, ...Array(32).fill(0)]
    expect(tree_door({ commitment: { count: member_tree_rows().length, root: wrong_root } })).toEqual({
      door: 'blocked',
      reason: 'commitment_mismatch',
    })
  })

  test('the pre-sign liveness refusals still bite on a format-4 row — a consumed group never composes', () => {
    expect(
      tree_door({
        zone: {
          seed: member_tree_witness.zone_seed,
          discovered_at_ms: member_tree_witness.discovered_at_ms,
          mob_bitmap: [0b1],
        },
      })
    ).toEqual({ door: 'blocked', reason: 'consumed' })
    expect(tree_door({ spawn_id: '999' })).toEqual({ door: 'blocked', reason: 'stale_stream' })
  })

  test('a roster the fresh stream disagrees with is a STALE STREAM refusal, at either format', () => {
    // same length, one substituted member — exactly what a re-derived zone hands back after a reroll
    const swapped = [member_tree_witness.templates[1], ...TREE_TARGET.members.slice(1)]
    expect(tree_door({ member_template_ids: swapped })).toEqual({ door: 'blocked', reason: 'stale_stream' })
    // a truncated roster is the same class of disagreement
    expect(tree_door({ member_template_ids: TREE_TARGET.members.slice(0, 1) })).toEqual({
      door: 'blocked',
      reason: 'stale_stream',
    })
    // and the inverse: a mono-spec claim against a stream that says this pack is a roster
    expect(tree_door({ member_template_ids: [] })).toEqual({ door: 'blocked', reason: 'stale_stream' })
  })

  test('an uncommitted zone still takes the derivation door — nothing to prove against', () => {
    expect(tree_door({ commitment: null })).toEqual({ door: 'derivation', reason: 'uncommitted_zone' })
  })
})

// ── END TO END: the composed witness must actually REACH the member composer, or the door is theatre. ──
describe('a format-4 engage hands the composed witness to the member claim door', () => {
  const zone_doc = {
    seed: member_tree_witness.zone_seed,
    discovered_at_ms: Number(member_tree_witness.discovered_at_ms),
    mob_bitmap: [],
    res_bitmap: [],
  }

  beforeEach(() => {
    spies.push(
      spyOn(sdk_game, 'get_zone_state').mockReturnValue(async () => zone_doc),
      spyOn(sdk_fight, 'get_zone_group_commitment').mockReturnValue(async () => ({
        root: MEMBER_TREE_ROOT,
        count: member_tree_rows().length,
      })),
      spyOn(zone_rows, 'zone_world_doc').mockResolvedValue({ id: member_tree_witness.world_id }),
      spyOn(zone_rows, 'rows_from_state').mockReturnValue(member_tree_rows()),
      spyOn(rpc_client, 'get_config').mockResolvedValue({ dials: { team_size_bound: 6 } })
    )
  })

  test('the witness rides into create_member_fight_ptb, roster and index intact', async () => {
    await create_world_fight({
      world_id: member_tree_witness.world_id,
      spawn_id: TREE_TARGET.spawn_id,
      zx: member_tree_witness.zx,
      zy: member_tree_witness.zy,
      mob_template_id: TREE_TARGET.template_id,
      member_template_ids: TREE_TARGET.members,
      character_id: '0xchar',
    })
    expect(member).toHaveBeenCalledTimes(1)
    expect(mono).not.toHaveBeenCalled()
    expect(member_args?.group_proof).not.toBeNull()
    expect(hex(member_args.group_proof.proof)).toBe(member_tree_witness.proof_hex)
    expect(member_args.group_proof.facts.member_template_ids).toEqual(TREE_TARGET.members)
    expect(member_args?.member_template_ids).toEqual(TREE_TARGET.members)
  })
})
