// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import {
  create_fight_ptb,
  create_member_fight_ptb,
  join_fight_ptb,
  place_ptb,
  force_start_ptb,
  crank_ptb,
  act_move_ptb,
  act_weapon_ptb,
  act_cast_ptb,
  act_pass_ptb,
  commit_turn_ptb,
  abandon_fight_ptb,
  settle_fight_ptb,
  open_result_ptb,
  settle_and_take_ptb,
  open_taken_ptb,
  settle_run_taken_ptb,
  settle_open_world_ptb,
  mint_rolled_ptb,
  burn_result_ptb,
  decode_fight,
  decode_fight_result,
  decode_fight_event,
  fight_event_type,
  fight_status_label,
  compose_mob_group_proof,
  mob_group_leaf_bytes,
} from '../src/fight.js'

import {
  EMPTY_IDS,
  IDS,
  id,
  move_calls,
  targets,
  find_call,
} from './_onchain_fixtures.js'
import { fight_shard_index } from '../src/deployment/aresrpg.js'

/** DEPLOYED context — the ONE merged `aresrpg` id block injected (the offline override seam). */
const ctx = { network: 'testnet', ids: IDS }
/** UNDEPLOYED — no ids → builders resolve empty deployment ids and refuse loudly. */
const undeployed = { network: 'testnet', ids: EMPTY_IDS }

// Common call arguments.
const A = {
  world_id: id('w0'),
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
  spawn_id: 42,
  mob_template_id: id('mt0'),
  fight_id: id('fi0'),
  run_pass_id: id('rp0'), // RunPass (settle_run_taken)
  result_id: id('re0'), // FightResult (mint_rolled / burn_result)
  outcome_id: id('re0'), // FightOutcome (open — the ENGINE settlement artifact)
  item_template_id: id('it0'),
  spell_template_id: id('sp0'),
  cell: 118,
  target_cell: 205,
}

const GROUP_PROOF = {
  index: 1,
  facts: {
    spawn_id: A.spawn_id,
    template_id: A.mob_template_id,
    x: 123,
    z: 456,
    group_size: 2,
    group_seed: '9007199254740999',
  },
  proof: Array.from({ length: 64 }, (_, i) => i),
}

const hex_bytes = hex => Array.from(Uint8Array.fromHex(hex))

// Canonical Move/BCS vector: zone_group_proof_tests.move::fixed_merkle_vector_matches_js.
const MOVE_GROUP_VECTOR = {
  world_id: '0x1',
  zx: 7,
  zy: 9,
  zone_seed: '11',
  discovered_at_ms: '13',
  group_count: 3,
  group_root: hex_bytes(
    '34aa456447c6815ec68a56bed6363cb42d714f8ab605dfddb35d6aa29dd213db',
  ),
  groups: [
    {
      index: 0,
      spawn_id: '21',
      template_id: '0x1f',
      x: 41,
      z: 51,
      size: 2,
      group_seed: '61',
    },
    {
      index: 1,
      spawn_id: '22',
      template_id: '0x20',
      x: 42,
      z: 52,
      size: 3,
      group_seed: '62',
    },
    {
      index: 2,
      spawn_id: '23',
      template_id: '0x21',
      x: 43,
      z: 53,
      size: 4,
      group_seed: '63',
    },
  ],
}

describe('mob-group proof producer — Move BCS/duplicate-last parity', () => {
  test('byte-matches the fixed Move leaf/root vector and selects only the verified proof door', () => {
    expect(
      Array.from(
        mob_group_leaf_bytes({
          ...MOVE_GROUP_VECTOR,
          ...MOVE_GROUP_VECTOR.groups[2],
          group_size: MOVE_GROUP_VECTOR.groups[2].size,
        }),
      ),
    ).toEqual(
      hex_bytes(
        '0000000000000000000000000000000000000000000000000000000000000001' +
          '07000000090000000b000000000000000d000000000000000200000000000000' +
          '1700000000000000000000000000000000000000000000000000000000000000' +
          '00000000000000212b0000003500000004003f00000000000000',
      ),
    )

    const witness = compose_mob_group_proof({ ...MOVE_GROUP_VECTOR, index: 2 })
    expect(witness).toEqual({
      index: 2,
      facts: {
        spawn_id: '23',
        template_id: '0x21',
        x: 43,
        z: 53,
        group_size: 4,
        group_seed: '63',
      },
      proof: hex_bytes(
        'c75b70b9207525ec6dc3baca7219cad412e62ee0ce9516e034a49d576a045d21' +
          'ca47040173b19e32ec5c387f00afbf58b30a69b7e95011cf875ce6772d5f4da2',
      ),
    })
    expect(
      targets(
        create_fight_ptb(ctx)({
          ...A,
          spawn_id: 23,
          zx: 7,
          zy: 9,
          group_proof: witness,
        }),
      ),
    ).toEqual(['zones::claim_mob_group_in_zone_with_proof', 'fight::create'])

    const bad_root = [...MOVE_GROUP_VECTOR.group_root]
    bad_root[0] ^= 1
    const fallback = compose_mob_group_proof({
      ...MOVE_GROUP_VECTOR,
      group_root: bad_root,
      index: 2,
    })
    expect(fallback).toBeNull()
    expect(
      targets(
        create_fight_ptb(ctx)({
          ...A,
          spawn_id: 23,
          zx: 7,
          zy: 9,
          group_proof: fallback,
        }),
      ),
    ).toEqual(['zones::claim_mob_group_in_zone', 'fight::create'])
  })
})

describe('create_member_fight_ptb — the mixed-pack door (#1110)', () => {
  const roster = [id('mt0'), id('mt1'), id('mt0')] // a repeat is normal: two of one species, one of another

  test('composes claim → open → one add per committed member → create', () => {
    const tx = create_member_fight_ptb(ctx)({ ...A, member_template_ids: roster })
    expect(targets(tx)).toEqual([
      'zones::claim_mob_group_members',
      'fight::open_group',
      'fight::add_member',
      'fight::add_member',
      'fight::add_member',
      'fight::create_members',
    ])
    // the adds are ORDERED — the chain checks each template against the committed slot, so a composer that
    // deduped or reordered them would abort on chain rather than merely lose a member
    const adds = move_calls(tx).filter(c => c.target.endsWith('::add_member'))
    expect(adds).toHaveLength(roster.length)
  })

  test('the global-search door swaps in when a zone is named', () => {
    const tx = create_member_fight_ptb(ctx)({
      ...A,
      zx: 7,
      zy: 9,
      member_template_ids: roster,
    })
    expect(targets(tx)[0]).toBe('zones::claim_mob_group_in_zone_members')
  })

  test('an empty roster refuses to compose — the chain would abort on the close anyway', () => {
    expect(() =>
      create_member_fight_ptb(ctx)({ ...A, member_template_ids: [] }),
    ).toThrow(/member roster/)
  })

  test('an undeployed network refuses loudly rather than inventing ids', () => {
    expect(() =>
      create_member_fight_ptb(undeployed)({ ...A, member_template_ids: roster }),
    ).toThrow()
  })
})

// ── offline "random is LAST" oracle (Random-PTB compliance) ──────────────────
const RANDOM_OBJECT = 8n // 0x8

function input_object_id(inp) {
  const oid =
    inp?.UnresolvedObject?.objectId ??
    inp?.Object?.SharedObject?.objectId ??
    inp?.Object?.ImmOrOwnedObject?.objectId
  return oid ?? null
}

/** True iff the LAST argument of the LAST command is the 0x8 Random object (⇒ no command can follow it). */
function random_is_last(tx) {
  const data = tx.getData()
  const cmds = data.commands
  const last = cmds[cmds.length - 1]
  if (!last || last.$kind !== 'MoveCall') return false
  const args = last.MoveCall.arguments
  const last_arg = args[args.length - 1]
  if (!last_arg || last_arg.$kind !== 'Input') return false
  const oid = input_object_id(data.inputs[last_arg.Input])
  return oid != null && BigInt(oid) === RANDOM_OBJECT
}

/** True iff NO command's argument references the 0x8 Random object (deterministic builders). */
function has_no_random(tx) {
  const data = tx.getData()
  return !data.inputs.some(inp => {
    const oid = input_object_id(inp)
    return oid != null && BigInt(oid) === RANDOM_OBJECT
  })
}

// Every builder + its expected single target, arg count, and whether it draws &Random.
const SINGLE_CALL_BUILDERS = [
  [
    'join',
    join_fight_ptb,
    { ...A },
    'fight::join', // fresh lineage: clean name (Clock settles lazy regen)
    11, // + clock appended LAST (before auto-injected ctx)
    false,
    IDS.aresrpg.LATEST_PACKAGE_ID,
  ],
  [
    'place',
    place_ptb,
    { ...A },
    'turns::place',
    6, // fight, character_id, cell, ENGINE_VERSION, clock, random (no GameConfig)
    true,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'force_start',
    force_start_ptb,
    { ...A },
    'turns::force_start',
    4, // fight, ENGINE_VERSION, clock, random
    true,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'crank',
    crank_ptb,
    { ...A },
    'turns::crank',
    4, // fight, ENGINE_VERSION, clock, random
    true,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'act_move',
    act_move_ptb,
    { ...A },
    'actions::act_move',
    5, // fight, character_id, cell, ENGINE_VERSION, clock — &Random-FREE (single-PTB turn law)
    false,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'act_weapon',
    act_weapon_ptb,
    { ...A },
    'actions::act_weapon',
    5, // fight, character_id, target_cell, ENGINE_VERSION, clock — &Random-FREE (turn-seed crit)
    false,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'act_cast',
    act_cast_ptb,
    { ...A },
    'actions::act_cast',
    6, // fight, character_id, spell, target_cell, ENGINE_VERSION, clock — &Random-FREE (deterministic resolver)
    false,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'act_pass',
    act_pass_ptb,
    { ...A },
    'actions::act_pass',
    5, // fight, character_id, ENGINE_VERSION, clock, random
    true,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'abandon_fight',
    abandon_fight_ptb,
    { ...A },
    'actions::abandon',
    5, // fight, character_id, ENGINE_VERSION, clock, random (no GameConfig — byte-identical shape to act_pass)
    true,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'settle',
    settle_fight_ptb,
    { ...A },
    'settlement::settle_and_destroy', // ENGINE package, module `settlement` (not core `results`)
    2, // fight (by value), ENGINE_VERSION — latch release belongs to each result-open
    false,
    IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID, // S-68: engine doors target the CALL TARGET, not the type origin
  ],
  [
    'open',
    open_result_ptb,
    { ...A },
    'results::open',
    8, // outcome, FIGHT_LATCH, kiosk, pkcap, config, version, clock, random
    true,
    IDS.aresrpg.LATEST_PACKAGE_ID,
  ],
  [
    'mint_rolled',
    mint_rolled_ptb,
    { ...A },
    'results::mint_rolled',
    6, // result, template, version, kiosk, pkcap, policy — exactly ONE version
    false,
    IDS.aresrpg.LATEST_PACKAGE_ID,
  ],
  [
    'burn_result',
    burn_result_ptb,
    { ...A },
    'results::burn_result',
    1,
    false,
    IDS.aresrpg.LATEST_PACKAGE_ID,
  ],
]

describe('fight single-call builders — target, arg count, package, Random discipline', () => {
  for (const [
    name,
    builder,
    args,
    target,
    arg_count,
    draws_random,
    pkg,
  ] of SINGLE_CALL_BUILDERS) {
    test(`${name} → ${target}`, () => {
      const tx = builder(ctx)(args)
      expect(targets(tx)).toEqual([target])
      const call = find_call(tx, target)
      expect(call.args).toBe(arg_count)
      expect(call.package).toBe(pkg)
      if (draws_random) expect(random_is_last(tx)).toBe(true)
      else expect(has_no_random(tx)).toBe(true)
      // serializable offline (no network): round-trips through JSON
      expect(typeof tx.serialize()).toBe('string')
    })
  }
})

describe('commit_turn — the WHOLE TURN in ONE PTB', () => {
  const batch_args = {
    fight_id: A.fight_id,
    character_id: A.character_id,
    actions: [
      { kind: 'move', cell: A.cell },
      { kind: 'weapon', target_cell: A.target_cell },
      {
        kind: 'cast',
        spell_template_id: A.spell_template_id,
        target_cell: A.target_cell,
      },
    ],
  }

  test('N actions + terminal act_pass: 4 commands in order, &Random ONLY in the last', () => {
    const tx = commit_turn_ptb(ctx)(batch_args)
    expect(targets(tx)).toEqual([
      'actions::act_move',
      'actions::act_weapon',
      'actions::act_cast',
      'actions::act_pass',
    ])
    // arities ride the SAME single builders (one home per moveCall shape — no drift possible).
    const calls = move_calls(tx)
    expect(calls.map(c => c.args)).toEqual([5, 5, 6, 5])
    // Random-PTB compliance: 0x8 is the LAST argument of the LAST command, and appears in NO other command.
    expect(random_is_last(tx)).toBe(true)
    const data = tx.getData()
    for (const c of data.commands.slice(0, -1)) {
      for (const arg of c.MoveCall.arguments) {
        if (arg.$kind !== 'Input') continue
        const inp = data.inputs[arg.Input]
        const oid =
          inp?.UnresolvedObject?.objectId ??
          inp?.Object?.SharedObject?.objectId ??
          inp?.Object?.ImmOrOwnedObject?.objectId
        if (oid != null) expect(BigInt(oid)).not.toBe(RANDOM_OBJECT)
      }
    }
    expect(typeof tx.serialize()).toBe('string')
  })

  test('empty actions = the skip: exactly ONE act_pass', () => {
    const tx = commit_turn_ptb(ctx)({
      fight_id: A.fight_id,
      character_id: A.character_id,
    })
    expect(targets(tx)).toEqual(['actions::act_pass'])
    expect(random_is_last(tx)).toBe(true)
  })

  test('unknown action kind throws (staging bug surfaces at build, never on-chain)', () => {
    expect(() =>
      commit_turn_ptb(ctx)({
        fight_id: A.fight_id,
        character_id: A.character_id,
        actions: [{ kind: 'teleport', cell: 1 }],
      }),
    ).toThrow(/unknown action kind/)
  })
})

describe('create_fight — claim_mob_group → create compose in ONE PTB', () => {
  test('two calls, one merged package, ticket chains as a NestedResult', () => {
    const tx = create_fight_ptb(ctx)(A)
    const calls = move_calls(tx)

    // exactly the two-call compose, in order (same package since the S-46 merge)
    expect(calls.map(c => c.target)).toEqual([
      'zones::claim_mob_group',
      'fight::create',
    ])
    // both calls run on THE merged aresrpg package
    expect(calls[0].package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(calls[1].package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    // arg counts (ctx auto-injected everywhere; the merge dropped claim's link + second version)
    expect(calls[0].args).toBe(8)
    expect(calls[1].args).toBe(14)

    // create is DETERMINISTIC now (verifier law — spawn rolls at place/force_start): no Random in this PTB
    // the GroupTicket hot potato flows claim→create IN-PTB: create's 3rd arg is claim's result (NestedResult 0)
    const create_cmd = tx.getData().commands.at(1)
    const ticket_arg = create_cmd.MoveCall.arguments.at(2)
    expect(ticket_arg.$kind).toBe('NestedResult')
    expect(ticket_arg.NestedResult[0]).toBe(0) // result of command 0 (claim_mob_group)

    // terminal &Random compliance: the action is LAST, so nothing follows the Random MoveCall
    expect(has_no_random(tx)).toBe(true)
    expect(typeof tx.serialize()).toBe('string')
  })

  test('zx/zy → the global-search door claim_mob_group_in_zone (2 extra u32 args; ticket still chains)', () => {
    const tx = create_fight_ptb(ctx)({ ...A, zx: 3, zy: 4 })
    const calls = move_calls(tx)

    // the CLAIM target flips to the global-search door; create is unchanged
    expect(calls.map(c => c.target)).toEqual([
      'zones::claim_mob_group_in_zone',
      'fight::create',
    ])
    expect(calls[0].package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    // arg counts: claim gains zx+zy (8 → 10); create unchanged (ctx auto-injected)
    expect(calls[0].args).toBe(10)
    expect(calls[1].args).toBe(14)

    // the GroupTicket hot potato still flows claim→create IN-PTB (create's 3rd arg = claim's result)
    const create_cmd = tx.getData().commands.at(1)
    const ticket_arg = create_cmd.MoveCall.arguments.at(2)
    expect(ticket_arg.$kind).toBe('NestedResult')
    expect(ticket_arg.NestedResult[0]).toBe(0)

    expect(has_no_random(tx)).toBe(true)
    expect(typeof tx.serialize()).toBe('string')
  })

  test('proof payload → occupied proof door; authenticated ticket still chains to create', () => {
    const tx = create_fight_ptb(ctx)({ ...A, group_proof: GROUP_PROOF })
    const calls = move_calls(tx)
    expect(calls.map(c => c.target)).toEqual([
      'zones::claim_mob_group_with_proof',
      'fight::create',
    ])
    expect(calls[0].args).toBe(15)
    expect(calls[1].args).toBe(14)
    const ticket_arg = tx.getData().commands.at(1).MoveCall.arguments.at(2)
    expect(ticket_arg.$kind).toBe('NestedResult')
    expect(ticket_arg.NestedResult[0]).toBe(0)
    expect(has_no_random(tx)).toBe(true)
    expect(typeof tx.serialize()).toBe('string')
  })

  test('proof payload + zx/zy → searched-zone proof door; old path remains the null fallback', () => {
    const tx = create_fight_ptb(ctx)({
      ...A,
      zx: 3,
      zy: 4,
      group_proof: GROUP_PROOF,
    })
    const calls = move_calls(tx)
    expect(calls.map(c => c.target)).toEqual([
      'zones::claim_mob_group_in_zone_with_proof',
      'fight::create',
    ])
    expect(calls[0].args).toBe(17)
    expect(calls[1].args).toBe(14)
    expect(has_no_random(tx)).toBe(true)
    expect(typeof tx.serialize()).toBe('string')
  })

  test('proof facts must bind the exported API spawn id before composing', () => {
    expect(() =>
      create_fight_ptb(ctx)({
        ...A,
        group_proof: {
          ...GROUP_PROOF,
          facts: { ...GROUP_PROOF.facts, spawn_id: 43 },
        },
      }),
    ).toThrow(/group_proof.*spawn_id/)
  })

  test('proof path rejects one-sided searched-zone coordinates before composing', () => {
    expect(() =>
      create_fight_ptb(ctx)({ ...A, zx: 3, group_proof: GROUP_PROOF }),
    ).toThrow(/group_proof.*zx.*zy/)
  })

  test('proof path rejects unsafe numeric witnesses before composing', () => {
    expect(() =>
      create_fight_ptb(ctx)({
        ...A,
        group_proof: { ...GROUP_PROOF, index: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow(/group_proof index/)
  })

  test('proof path validates searched-zone coordinates before mutating a supplied tx', () => {
    const tx = new Transaction()
    expect(() =>
      create_fight_ptb(ctx)({
        ...A,
        zx: 2 ** 32,
        zy: 4,
        group_proof: GROUP_PROOF,
        tx,
      }),
    ).toThrow(/group_proof zx/)
    expect(tx.getData().inputs).toHaveLength(0)
    expect(tx.getData().commands).toHaveLength(0)
  })

  test('proof path rejects coercible non-numeric witness values', () => {
    expect(() =>
      create_fight_ptb(ctx)({
        ...A,
        group_proof: { ...GROUP_PROOF, index: true },
      }),
    ).toThrow(/group_proof index/)
    expect(() =>
      create_fight_ptb(ctx)({
        ...A,
        group_proof: {
          ...GROUP_PROOF,
          facts: { ...GROUP_PROOF.facts, group_seed: '' },
        },
      }),
    ).toThrow(/group_proof facts\.group_seed/)
  })

  // BCS bytes of create's `party_id: Option<ID>` pure input (create is command 1, party_id is arg 8).
  function party_id_bytes(tx) {
    const data = tx.getData()
    const arg = data.commands.at(1).MoveCall.arguments.at(8)
    return Buffer.from(data.inputs.at(arg.Input).Pure.bytes, 'base64')
  }

  test('party_id defaults to Option::none; a supplied party is Option::some', () => {
    // none: a single 0 byte (BCS Option none)
    const none = party_id_bytes(create_fight_ptb(ctx)(A))
    expect(none[0]).toBe(0)

    // some: leading 1 byte then the 32-byte id
    const some = party_id_bytes(
      create_fight_ptb(ctx)({ ...A, party_id: id('pty') }),
    )
    expect(some[0]).toBe(1)
    expect(some.length).toBe(33)
  })
})

describe('settle_and_take / open_taken — PTB-composed settle+open (no stranded outcome)', () => {
  test('settle_and_take alone: 3 args, ENGINE package, deterministic (no &Random), returns {tx, outcome}', () => {
    const { tx, outcome } = settle_and_take_ptb(ctx)(A)
    expect(targets(tx)).toEqual(['settlement::settle_and_take'])
    const call = find_call(tx, 'settlement::settle_and_take')
    expect(call.args).toBe(3) // fight (by value), character_id, ENGINE_VERSION
    expect(call.package).toBe(IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID)
    expect(has_no_random(tx)).toBe(true)
    expect(outcome).toBeDefined()
    expect(typeof tx.serialize()).toBe('string')
  })

  test('open_taken chained off a REAL settle_and_take result handle — never an object id', () => {
    const { tx, outcome } = settle_and_take_ptb(ctx)(A)
    const chained = open_taken_ptb(ctx)({
      outcome,
      character_id: A.character_id,
      kiosk_id: A.kiosk_id,
      personal_kiosk_cap_id: A.personal_kiosk_cap_id,
      tx,
    })
    const calls = move_calls(chained)
    expect(calls.map(c => c.target)).toEqual([
      'settlement::settle_and_take',
      'results::open_taken',
    ])
    expect(calls[0].package).toBe(IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID)
    expect(calls[1].package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(calls[0].args).toBe(3)
    expect(calls[1].args).toBe(8) // outcome, FIGHT_LATCH, kiosk, pkcap, config, version, clock, random

    // the outcome flows settle_and_take → open_taken IN-PTB: open_taken's 1st arg is settle_and_take's
    // RESULT (a NestedResult), never an object id/ref — as_object_arg is never invoked for this argument.
    const open_cmd = chained.getData().commands.at(1)
    const outcome_arg = open_cmd.MoveCall.arguments.at(0)
    expect(outcome_arg.$kind).toBe('NestedResult')
    expect(outcome_arg.NestedResult[0]).toBe(0) // result of command 0 (settle_and_take)

    // terminal &Random compliance: open_taken is LAST, so nothing follows its Random draw
    expect(random_is_last(chained)).toBe(true)
    expect(typeof chained.serialize()).toBe('string')
  })

  test('dungeon compose: settle_and_take → settle_run(&handle) → open_taken — order pinned, handle borrowed then consumed', () => {
    const { tx, outcome } = settle_and_take_ptb(ctx)(A)
    settle_run_taken_ptb(ctx)({
      run_pass_id: A.run_pass_id,
      outcome,
      world_id: A.world_id,
      kiosk_id: A.kiosk_id,
      personal_kiosk_cap_id: A.personal_kiosk_cap_id,
      tx,
    })
    open_taken_ptb(ctx)({
      outcome,
      character_id: A.character_id,
      kiosk_id: A.kiosk_id,
      personal_kiosk_cap_id: A.personal_kiosk_cap_id,
      tx,
    })
    const calls = move_calls(tx)
    // the pinned order: settle_and_take (ENGINE) → settle_run (CORE) → open_taken (CORE), Random terminal
    expect(calls.map(c => c.target)).toEqual([
      'settlement::settle_and_take',
      'dungeon::settle_run',
      'results::open_taken',
    ])
    expect(calls[0].package).toBe(IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID)
    expect(calls[1].package).toBe(IDS.aresrpg.DUNGEON_PACKAGE_ID) // gifting/dungeon split: dungeon moved out of core
    expect(calls[2].package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(calls[1].args).toBe(7) // pass, outcome, world, kiosk, cap, config, version

    // settle_run BORROWS the outcome handle (arg 1 = command 0's NestedResult, placed AS-IS — never as_object_arg)
    const settle_run_cmd = tx.getData().commands.at(1)
    const borrowed = settle_run_cmd.MoveCall.arguments.at(1)
    expect(borrowed.$kind).toBe('NestedResult')
    expect(borrowed.NestedResult[0]).toBe(0) // result of command 0 (settle_and_take)

    // open_taken then CONSUMES the SAME handle BY VALUE (arg 0 = command 0's NestedResult)
    const open_cmd = tx.getData().commands.at(2)
    const consumed = open_cmd.MoveCall.arguments.at(0)
    expect(consumed.$kind).toBe('NestedResult')
    expect(consumed.NestedResult[0]).toBe(0)

    // terminal &Random compliance: open_taken is LAST, so nothing follows its Random draw
    expect(random_is_last(tx)).toBe(true)
    expect(typeof tx.serialize()).toBe('string')
  })

  test('settle_open_world_ptb composes the identical two-call chain in one call', () => {
    const tx = settle_open_world_ptb(ctx)(A)
    const calls = move_calls(tx)
    expect(calls.map(c => c.target)).toEqual([
      'settlement::settle_and_take',
      'results::open_taken',
    ])
    expect(calls[0].package).toBe(IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID)
    expect(calls[1].package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(calls[0].args).toBe(3)
    expect(calls[1].args).toBe(8)

    const open_cmd = tx.getData().commands.at(1)
    const outcome_arg = open_cmd.MoveCall.arguments.at(0)
    expect(outcome_arg.$kind).toBe('NestedResult')
    expect(outcome_arg.NestedResult[0]).toBe(0)

    expect(random_is_last(tx)).toBe(true)
    expect(typeof tx.serialize()).toBe('string')
  })
})

describe('fight builders refuse loudly when the package is undeployed', () => {
  for (const [name, builder, args] of [
    ['create', create_fight_ptb, A],
    ['join', join_fight_ptb, A],
    ['place', place_ptb, A],
    ['crank', crank_ptb, A],
    ['open', open_result_ptb, A],
    ['settle_and_take', settle_and_take_ptb, A],
    ['open_taken', open_taken_ptb, A],
    ['settle_run_taken', settle_run_taken_ptb, A],
    ['settle_open_world', settle_open_world_ptb, A],
    ['mint_rolled', mint_rolled_ptb, A],
    ['burn_result', burn_result_ptb, A],
  ]) {
    test(`${name} throws /not deployed/`, () => {
      expect(() => builder(undeployed)(args)).toThrow(/not deployed/)
    })
  }
})

// ── decoders (pure, offline) ─────────────────────────────────────────────────

describe('decode_fight — status label, geometry arrays, counts, bigints', () => {
  test('null → null; a live fight decodes', () => {
    expect(decode_fight(null)).toBe(null)
    const f = decode_fight({
      id: id('fi0'),
      world: id('w0'),
      spawn_id: '42',
      world_seed: '99',
      anchor_x: 10,
      anchor_z: 20,
      public_fight: true,
      party_id: { vec: [] },
      aged_bp: 500,
      turn_ms: '30000',
      placement_ms: '60000',
      team_bound: 6,
      status: 1,
      participants: [{}, {}],
      mobs: [{}, {}, {}],
      // S-69: the DEPLOYED struct nests board geometry + the win-content cache (fight.move's 32-field cap split).
      board: {
        width: 15,
        height: 17,
        shape_mask: ['1', '2'],
        obstacles: [],
        holes: ['5'],
        start_cells_a: ['100', '101'],
        start_cells_b: ['200'],
      },
      queue: [
        { is_mob: false, idx: '0' },
        { is_mob: true, idx: '2' },
      ],
      turn_ptr: 0,
      turn_deadline_ms: '123',
      last_action_ms: '456',
      placement_deadline_ms: '789',
      // GroupContent now also carries the group's shared mob kit (mob-kit dedup): AP/MP base decoded, stats/spells not.
      group: {
        template: id('mt0'),
        xp: '1000',
        loot: [],
        kit: { base_ap: '6', base_mp: '3', stats: {}, spells: [] },
      },
    })
    expect(f.status_label).toBe('active')
    expect(f.participant_count).toBe(2)
    expect(f.mob_count).toBe(3)
    expect(f.public_fight).toBe(true)
    expect(f.party_id).toBe(null)
    expect(f.spawn_id).toBe(42n)
    expect(f.group_template).toBe(id('mt0'))
    expect(f.group_xp).toBe(1000n)
    expect(f.group_base_ap).toBe(6) // the shared mob-kit AP base (every FightMob refills from it)
    expect(f.group_base_mp).toBe(3)
    expect(f.width).toBe(15)
    expect(f.height).toBe(17)
    expect(f.shape_mask).toEqual([1n, 2n]) // BigInt words (obstacles/holes/start_cells_* stay Number — see below)
    expect(f.holes).toEqual([5])
    expect(f.start_cells_a).toEqual([100, 101])
    expect(f.start_cells_b).toEqual([200])
    expect(f.queue).toEqual([
      { is_mob: false, idx: 0 },
      { is_mob: true, idx: 2 },
    ])
  })

  test('shape_mask decodes losslessly as BigInt above 2^53 — the OLD Number() path silently drops real board cells (proven against a REAL byte-identical-twin fixture)', () => {
    // Copied (NOT imported — sdk stays import-free of @aresrpg/frontend) from dungeon-grid.js's
    // `board_shape_from_anchor(world_seed=1n, anchor_x=0, anchor_z=0)` → `maskWords(...)`: the byte-identical
    // twin of Move's `board::generate_for_anchor`, a real 13×12 board. 3 of the 6 u64 words exceed 2^53 (real
    // bitset magnitude near 2^64, not a contrived toy) — the exact class dungeon-grid.js:364 and
    // fight_bridge.js:217 already document as dropping real board cells via the old `Number()` decode.
    const words_str = [
      '17302828673139738623',
      '18375249361442374143',
      '18442275654192853023',
      '274342084352',
      '0',
      '0',
    ]
    // The twin's own known-good on-cell set for this exact seed (ground truth — the parity oracle).
    const expected_cells = [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      30, 31, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 60, 61, 62,
      63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 80, 81, 82, 83, 84, 85, 86, 87,
      88, 89, 90, 91, 92, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      111, 112, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132,
      140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 160, 161,
      162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 180, 181, 182, 183,
      184, 185, 186, 187, 188, 189, 190, 191, 200, 201, 202, 203, 204, 205, 206,
      207, 208, 209, 210, 211, 221, 222, 223, 224, 225, 226, 227, 228, 229,
    ]

    const f = decode_fight({
      id: id('fi0'),
      status: 1,
      participants: [],
      mobs: [],
      board: {
        width: 13,
        height: 12,
        shape_mask: words_str,
        obstacles: [],
        holes: [],
        start_cells_a: [],
        start_cells_b: [],
      },
    })

    // NEW path: exact BigInt words, zero precision loss.
    expect(f.shape_mask).toEqual(words_str.map(BigInt))

    // Bit-extract the documented way (bit i of word w = (word >> BigInt(i)) & 1n) — matches the twin EXACTLY.
    const decoded_cells = []
    for (let w = 0; w < f.shape_mask.length; w++)
      for (let i = 0; i < 64; i++)
        if ((f.shape_mask[w] >> BigInt(i)) & 1n) decoded_cells.push(w * 64 + i)
    expect(decoded_cells.sort((a, b) => a - b)).toEqual(expected_cells)

    // OLD path proof: the pre-fix expression was `vec.map(v => Number(v))`. Replayed on the SAME raw strings,
    // the value itself is already wrong (rounded) before any bit ever gets read — never throws, never warns.
    const old_lossy_words = words_str.map(v => BigInt(Number(v)))
    expect(old_lossy_words[0]).not.toBe(BigInt(words_str[0]))
    expect(old_lossy_words[1]).not.toBe(BigInt(words_str[1]))
    expect(old_lossy_words[2]).not.toBe(BigInt(words_str[2]))
    const old_cells = new Set()
    for (let w = 0; w < old_lossy_words.length; w++)
      for (let i = 0; i < 64; i++)
        if ((old_lossy_words[w] >> BigInt(i)) & 1n) old_cells.add(w * 64 + i)
    const true_cells = new Set(expected_cells)
    const dropped = expected_cells.filter(c => !old_cells.has(c))
    const phantom = [...old_cells].filter(c => !true_cells.has(c))
    expect(dropped.length).toBe(25) // real on-cells the OLD Number() path silently lost
    expect(phantom.length).toBe(1) // + 1 fabricated phantom cell that was never on the real board
  })

  test('a board-less/group-less/queue-less json (defensive) decodes zeroed, never throws', () => {
    const f = decode_fight({
      id: id('fi0'),
      status: 0,
      participants: [],
      mobs: [],
    })
    expect(f.width).toBe(0)
    expect(f.height).toBe(0)
    expect(f.shape_mask).toEqual([])
    expect(f.start_cells_a).toEqual([])
    expect(f.queue).toEqual([])
    expect(f.group_template).toBe(undefined)
    expect(f.group_xp).toBe(0n)
    expect(f.group_base_ap).toBe(0) // no group/kit → zeroed, never throws
    expect(f.group_base_mp).toBe(0)
  })
})

describe('decode_fight_result — rolled is a PLAIN vector (abort-105 regression guard)', () => {
  const base = {
    id: id('re0'),
    fight: id('fi0'),
    world: id('w0'),
    character: id('ca0'),
    outcome: 2,
    final_hp: 55,
    xp_share: '1000',
    aged_bp: 500,
    chance: 25,
    mob_count: 3,
    loot: [{ item_template: id('it0') }],
  }
  test('defeat / no-drop victory: rolled = [] decodes to an empty array (never throws)', () => {
    // `json:true` flattens the CURRENT plain `vector<RolledLoot>` (results.move) to a plain array — an empty
    // roll is `[]`, NOT the pre-S-46 `Option::none` `{vec:[]}`.
    const r = decode_fight_result({ ...base, rolled: [] })
    expect(r.outcome_label).toBe('victory')
    expect(r.rolled).toEqual([])
    expect(r.xp_share).toBe(1000n)
  })
  test('victory with loot: rolled maps the REAL chain shape (plain array) to bigint qty', () => {
    // THE regression: the chain sends `rolled: [{ item_template, qty }]` (a plain vector). The old decoder ran it
    // through `option_value`, which returned element[0] (a single object), and `.map` on that object THREW — the
    // caller blanked the result, minted nothing, then burned a full result (abort 105). This shape MUST decode.
    const r = decode_fight_result({
      ...base,
      rolled: [
        { item_template: id('it0'), qty: '2' },
        { item_template: id('it1'), qty: '1' },
      ],
    })
    expect(r.is_opened).toBe(true)
    expect(r.rolled).toEqual([
      { item_template: id('it0'), qty: 2n },
      { item_template: id('it1'), qty: 1n },
    ])
  })
})

describe('event decoders', () => {
  const pkg = IDS.aresrpg.PACKAGE_ID
  test('fight_status_label maps every status + unknown', () => {
    expect(fight_status_label(0)).toBe('placement')
    expect(fight_status_label(1)).toBe('active')
    expect(fight_status_label(2)).toBe('victory')
    expect(fight_status_label(3)).toBe('defeat')
    expect(fight_status_label(9)).toBe('unknown')
  })
  test('fight_event_type builds the ENGINE fight_events filter string', () => {
    const epkg = IDS.aresrpg.ENGINE_PACKAGE_ID
    expect(fight_event_type(epkg, 'Moved')).toBe(`${epkg}::fight_events::Moved`)
  })
  test('decode_fight_event coerces numeric fields, passes ids/bools through', () => {
    expect(decode_fight_event(null)).toBe(null)
    const moved = decode_fight_event({
      type: `${pkg}::events::Moved`,
      parsedJson: { fight: id('fi0'), character: id('ca0'), to_cell: '77' },
    })
    expect(moved).toEqual({
      kind: 'Moved',
      fight: id('fi0'),
      character: id('ca0'),
      to_cell: 77,
    })
    const created = decode_fight_event({
      type: `${pkg}::events::FightCreated`,
      parsedJson: {
        fight: id('fi0'),
        world: id('w0'),
        spawn_id: '42',
        anchor_x: 10,
        anchor_z: 20,
        public_fight: true,
        aged_bp: '500',
        mob_count: '3',
      },
    })
    expect(created.kind).toBe('FightCreated')
    expect(created.spawn_id).toBe(42)
    expect(created.mob_count).toBe(3)
    expect(created.public_fight).toBe(true)
    expect(created.world).toBe(id('w0'))
    const displaced = decode_fight_event({
      type: `${pkg}::events::Displaced`,
      parsedJson: {
        fight: id('fi0'),
        target_is_mob: true,
        target_idx: '2',
        kind: '0',
        from_cell: '105',
        to_cell: '107',
        requested: '2',
        blocked: '0',
      },
    })
    expect(displaced).toEqual({
      kind: 'Displaced',
      fight: id('fi0'),
      target_is_mob: true,
      target_idx: 2,
      effect_kind: 0,
      from_cell: 105,
      to_cell: 107,
      requested: 2,
      blocked: 0,
    })
  })
})

// ── S-51b — the shared-version cache, end to end ─────────────────────────────
// THE representative offline proof: with every runtime object passed as a caller-cached ref (the ref-or-id
// seam) and every deployment singleton resolving through aresrpg_shared_ref (testnet SHARED_VERSIONS are
// ceremony-stamped), the fight-create PTB — the richest builder, 2 calls / 9 object inputs — must BCS-build
// KIND-ONLY with NO client passed at all: zero UnresolvedObject inputs ⇒ zero network requests.
describe('S-51b static refs — kind-only build with ZERO client', () => {
  test('create_fight_ptb: all-ref inputs → no UnresolvedObject; tx.build({onlyTransactionKind}) succeeds clientless', async () => {
    const ZERO_DIGEST = '11111111111111111111111111111111' // base58, 32 zero bytes — a well-formed fake
    const shared_ref = (object_id, mutable) => ({
      objectId: object_id,
      initialSharedVersion: '7',
      mutable,
    })
    const tx = create_fight_ptb(ctx)({
      ...A,
      // RUNTIME refs (the caller's cache): world is &mut in claim_mob_group → mutable:true (the superset).
      world_id: shared_ref(id('w0'), true),
      kiosk_id: shared_ref(id('k0'), true),
      mob_template_id: shared_ref(id('mt0'), false),
      // The soulbound cap is OWNED — its cached ref is {objectId, version, digest}.
      personal_kiosk_cap_id: {
        objectId: id('pk0'),
        version: '11',
        digest: ZERO_DIGEST,
      },
    })

    const { inputs } = tx.getData()
    expect(inputs.some(i => i.$kind === 'UnresolvedObject')).toBe(false)
    // Statics resolved from the ceremony-stamped testnet SHARED_VERSIONS (ids injected through the seam).
    const shared = inputs
      .filter(i => i.Object?.SharedObject)
      .map(i => i.Object.SharedObject)
    const by_id = Object.fromEntries(shared.map(s => [s.objectId, s]))
    // The registry is sharded — the input is the shard the fight's WORLD maps to, not a singleton.
    const shard =
      IDS.aresrpg.FIGHT_REGISTRY_SHARDS[fight_shard_index(A.world_id)]
    expect(by_id[shard.id].mutable).toBe(true) // &mut FightRegistry (this world's shard)
    const latch =
      IDS.aresrpg.FIGHT_LATCH_SHARDS[fight_shard_index(A.character_id)]
    expect(fight_shard_index(A.world_id)).toBe(
      fight_shard_index(A.character_id),
    )
    expect(latch.id).not.toBe(shard.id) // equal indexes still select distinct family objects
    expect(by_id[latch.id].mutable).toBe(true) // &mut FightLatch (this character's shard)
    expect(by_id[IDS.aresrpg.GAME_CONFIG].mutable).toBe(false) // &GameConfig
    expect(by_id[IDS.aresrpg.VERSION].mutable).toBe(false) // &Version
    expect(by_id[IDS.aresrpg.ENGINE_VERSION].mutable).toBe(false) // &EngineVersion

    // The strongest offline oracle: a full kind-only BCS build with NO client — any unresolved input throws.
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes.length).toBeGreaterThan(0)
  })

  test('as_object_arg refuses a malformed ref (never silently degrades to a network resolve)', () => {
    expect(() =>
      create_fight_ptb(ctx)({ ...A, world_id: { objectId: id('w0') } }),
    ).toThrow(/as_object_arg/)
  })

  // S-68 — the engine call-target/type-origin split: an engine upgrade bumps where CALLS go, never what
  // TYPES are named. The two keys must never be conflated (a type string on the upgrade id matches nothing).
  test('S-68: engine calls target ENGINE_LATEST_PACKAGE_ID while event type strings keep ENGINE_PACKAGE_ID', () => {
    expect(IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID).not.toBe(
      IDS.aresrpg.ENGINE_PACKAGE_ID,
    )
    const call = find_call(place_ptb(ctx)(A), 'turns::place')
    expect(call.package).toBe(IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID)
    expect(fight_event_type(IDS.aresrpg.ENGINE_PACKAGE_ID, 'Moved')).toBe(
      `${IDS.aresrpg.ENGINE_PACKAGE_ID}::fight_events::Moved`,
    )
  })
})
