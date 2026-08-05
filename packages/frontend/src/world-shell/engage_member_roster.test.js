// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#2227): the format-4 proof door was gated SHUT in the client. `world_group_door` short-circuited
// EVERY member-roster group to the whole-zone derivation door on a comment claiming `create_member_fight_ptb`
// "has no `group_proof` parameter" and that composing a witness "would also be impossible" because the
// commitment binds the RAW rolled roster while a `derive_zone` row carries the trimmed one. Both halves are
// false: the SDK composer takes a witness (packages/sdk/src/fight.js `create_member_fight_ptb`), and
// `derive_zone` trims the roster to `size` exactly as the commitment does — the member-tree witness composes,
// byte-for-byte, against the Move-pinned vector below AND against live testnet zone 488:487.
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

// ONE FIXTURE, FOUR CONSUMERS: the sim twin, the SDK witness pin (packages/sdk/test/fight_proof_member_tree.js),
// `aresrpg_foundation::zone_gen_members_tests` (Move) and now the client door all assert the same stream.
import parity from '../../../sim/test/fixtures/zone_members_format3_parity.json' with { type: 'json' }
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

// ── THE MEMBER-TREE VECTOR — the same bytes `aresrpg_foundation::zone_gen_members_tests` and the SDK's
// fight_proof_member_tree suite pin, so a client witness that reproduces them is one the chain accepts. ──
const hex = (bytes) => Buffer.from(Uint8Array.from(bytes)).toString('hex')
const ROOT_HEX = '045f45b05f1c2c39b05a521e67edd816b953bd28f6006cc6969a88bba87ab0ef15'
const PROOF_HEX =
  '2363f31e53651f2a7615011ff6bfee5f24fca9907fec6bd77b901cdfa167ffda7d56bc6f9d7fa809831086aae5063191' +
  'b4d54489f54214bddb0324cd7b5fe0ad3ba5f1affcbd4930f0c221682132603cbcef917128ec55d97234a4d587e3ae500' +
  '2d11e199e560fce3175e16a11b8cddff33a942a15ad94c396f35fa167e63986'
const TREE_WORLD = '0xbe3f'
const TREE_DISCOVERED_AT_MS = '1784980009967'
const TREE_PROGRESS = 613 // the §4 difficulty the leaf binds — the Move suite pins this exact value
const TREE_TEMPLATES = [1, 2, 3, 4, 5].map((n) => `0x${n.toString(16).padStart(64, '0')}`)
const MEMBER_TREE_ROOT = Array.from(Buffer.from(ROOT_HEX, 'hex'))
// The SAME stream under the format-3 (member LIST) tag — a whole-set digest with no per-group leaf to prove.
const MEMBER_LIST_ROOT = [3, ...MEMBER_TREE_ROOT.slice(1)]

/** The parity stream in `derive_zone` ROW shape — what `rows_from_state` hands the door in production. */
const tree_rows = () =>
  parity.groups.map((group, index) => ({
    kind: 'mob',
    index,
    spawn_id: group.spawn_id,
    template_id: TREE_TEMPLATES[group.template_idx],
    x: group.x,
    z: group.z,
    size: group.size,
    group_seed: String(group.group_seed),
    // the SEATING roster: `derive_zone` trims to `size`, exactly as the commitment preimage does
    members: group.members.slice(0, group.size).map((slot) => TREE_TEMPLATES[slot]),
    progress: TREE_PROGRESS,
  }))

const [TREE_TARGET] = tree_rows()
const tree_door = (overrides = {}) =>
  world_group_door({
    world_id: TREE_WORLD,
    spawn_id: TREE_TARGET.spawn_id,
    mob_template_id: TREE_TARGET.template_id,
    member_template_ids: TREE_TARGET.members,
    zx: 487,
    zy: 487,
    zone: { seed: parity.inputs.seed, discovered_at_ms: TREE_DISCOVERED_AT_MS, mob_bitmap: [] },
    commitment: { count: parity.groups.length, root: MEMBER_TREE_ROOT },
    groups: tree_rows(),
    ...overrides,
  })

describe('the member claim door is FORMAT-DISCRIMINATED — the served root byte is the whole decision', () => {
  test('a format-4 (member TREE) zone composes the inclusion witness the chain accepts', () => {
    const door = tree_door()
    expect(door.door).toBe('proof')
    expect(door.index).toBe(0)
    // byte-identical to the Move-pinned path: 4 levels × 32B over an 11-group tree
    expect(hex(door.proof.proof)).toBe(PROOF_HEX)
    // the leaf binds the roster and the zone's progress — the two facts only the member door takes
    expect(door.proof.facts.member_template_ids).toEqual(TREE_TARGET.members)
    expect(door.proof.facts.progress).toBe(TREE_PROGRESS)
    expect(door.proof.facts.spawn_id).toBe(TREE_TARGET.spawn_id)
  })

  test('a format-3 (member LIST) zone keeps the derivation door — its digest covers the whole set, untouched', () => {
    expect(tree_door({ commitment: { count: parity.groups.length, root: MEMBER_LIST_ROOT } })).toEqual({
      door: 'derivation',
      reason: 'member_roster_door',
      index: 0,
    })
  })

  test('a format-4 root the local stream cannot reproduce fails SHUT — never a quieter door', () => {
    const wrong_root = [4, ...Array(32).fill(0)]
    expect(tree_door({ commitment: { count: parity.groups.length, root: wrong_root } })).toEqual({
      door: 'blocked',
      reason: 'commitment_mismatch',
    })
  })

  test('the pre-sign liveness refusals still bite on a format-4 row — a consumed group never composes', () => {
    expect(
      tree_door({ zone: { seed: parity.inputs.seed, discovered_at_ms: TREE_DISCOVERED_AT_MS, mob_bitmap: [0b1] } })
    ).toEqual({ door: 'blocked', reason: 'consumed' })
    expect(tree_door({ spawn_id: '999' })).toEqual({ door: 'blocked', reason: 'stale_stream' })
  })

  test('a roster the fresh stream disagrees with is a STALE STREAM refusal, at either format', () => {
    // same length, one substituted member — exactly what a re-derived zone hands back after a reroll
    const swapped = [TREE_TEMPLATES[1], ...TREE_TARGET.members.slice(1)]
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
    seed: parity.inputs.seed,
    discovered_at_ms: Number(TREE_DISCOVERED_AT_MS),
    mob_bitmap: [],
    res_bitmap: [],
  }

  beforeEach(() => {
    spies.push(
      spyOn(sdk_game, 'get_zone_state').mockReturnValue(async () => zone_doc),
      spyOn(sdk_fight, 'get_zone_group_commitment').mockReturnValue(async () => ({
        root: MEMBER_TREE_ROOT,
        count: parity.groups.length,
      })),
      spyOn(zone_rows, 'zone_world_doc').mockResolvedValue({ id: TREE_WORLD }),
      spyOn(zone_rows, 'rows_from_state').mockReturnValue(tree_rows()),
      spyOn(rpc_client, 'get_config').mockResolvedValue({ dials: { team_size_bound: 6 } })
    )
  })

  test('the witness rides into create_member_fight_ptb, roster and index intact', async () => {
    await create_world_fight({
      world_id: TREE_WORLD,
      spawn_id: TREE_TARGET.spawn_id,
      zx: 487,
      zy: 487,
      mob_template_id: TREE_TARGET.template_id,
      member_template_ids: TREE_TARGET.members,
      character_id: '0xchar',
    })
    expect(member).toHaveBeenCalledTimes(1)
    expect(mono).not.toHaveBeenCalled()
    expect(member_args?.group_proof).not.toBeNull()
    expect(hex(member_args.group_proof.proof)).toBe(PROOF_HEX)
    expect(member_args.group_proof.facts.member_template_ids).toEqual(TREE_TARGET.members)
    expect(member_args?.member_template_ids).toEqual(TREE_TARGET.members)
  })
})
