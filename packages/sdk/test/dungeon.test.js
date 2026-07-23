// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  activate_ptb,
  activate_many_ptb,
  next_fight_ptb,
  join_fight_ptb,
  settle_run_ptb,
  abandon_ptb,
  get_run_pass,
} from '../src/dungeon.js'

import {
  EMPTY_IDS,
  IDS,
  id,
  stub_kiosk_client,
  targets,
  find_call,
} from './_onchain_fixtures.js'

const ctx = {
  network: 'testnet',
  kiosk_client: stub_kiosk_client,
  ids: IDS,
}
const undeployed = {
  network: 'testnet',
  kiosk_client: stub_kiosk_client,
  ids: EMPTY_IDS,
}

const A = {
  world_id: id('w0'),
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
  key_item_id: id('key0'),
  run_pass_id: id('r0'),
  mob_template_id: id('mt0'),
  fight_id: id('fi0'),
  creator_pass_id: id('cp0'),
  outcome_id: id('re0'), // FightOutcome (settle_run — the ENGINE settlement artifact, borrowed)
}

// ── offline Random-PTB oracle: no dungeon door draws &Random (verifier law) ──
function has_no_random(tx) {
  const RANDOM =
    '0x0000000000000000000000000000000000000000000000000000000000000008'
  return !tx
    .getData()
    .inputs.some(
      i =>
        i.UnresolvedObject?.objectId === RANDOM ||
        i.Object?.SharedObject?.objectId === RANDOM,
    )
}

/** Every resolved input object id in a built tx (UnresolvedObject / shared / immOrOwned). */
function input_ids(tx) {
  return tx
    .getData()
    .inputs.map(
      i =>
        i.UnresolvedObject?.objectId ??
        i.Object?.SharedObject?.objectId ??
        i.Object?.ImmOrOwnedObject?.objectId,
    )
    .filter(Boolean)
}

/** Resolve a single built-tx MoveCall argument (Input only — NestedResult has no static object id) to its
 *  underlying object id, or null. Mirrors fight.test.js's `input_object_id` convention. */
function arg_object_id(tx, arg) {
  if (arg?.$kind !== 'Input') return null
  const inp = tx.getData().inputs[arg.Input]
  return (
    inp?.UnresolvedObject?.objectId ??
    inp?.Object?.SharedObject?.objectId ??
    inp?.Object?.ImmOrOwnedObject?.objectId ??
    null
  )
}

describe('dungeon lifecycle builders — refuse loudly when undeployed', () => {
  test('activate/next_fight/join_fight/settle_run refuse', () => {
    expect(() => activate_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => activate_many_ptb(undeployed)({ members: [A] })).toThrow(
      /not deployed/,
    )
    expect(() => next_fight_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => join_fight_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => settle_run_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => abandon_ptb(undeployed)(A)).toThrow(/not deployed/)
  })
})

describe('dungeon activate — split exactly one then enter with an internal mutable character borrow', () => {
  test('is a literal 2-call composite with the frozen 5/9-argument ABI', () => {
    const tx = activate_ptb(ctx)(A)
    expect(targets(tx)).toEqual([
      'header::aresrpg',
      'extract::extract_one_for_burn',
      'dungeon::activate',
    ])
    expect(find_call(tx, 'extract::extract_one_for_burn').args).toBe(5)
    const activate = find_call(tx, 'dungeon::activate')
    expect(activate.args).toBe(9)
    expect(activate.package).toBe(IDS.aresrpg.DUNGEON_PACKAGE_ID)
    expect(has_no_random(tx)).toBe(true)
    expect(typeof tx.serialize()).toBe('string')
  })

  test('keeps key-kiosk and character-kiosk ownership proofs distinct', () => {
    const key_kiosk_id = id('key-kiosk')
    const key_kiosk_cap_id = id('key-cap')
    const tx = activate_ptb(ctx)({
      ...A,
      key_kiosk_id,
      key_kiosk_cap_id,
    })
    // commands[0] is the header::aresrpg no-op — skip it.
    const [, extract, activate] = tx.getData().commands
    expect(arg_object_id(tx, extract.MoveCall.arguments[0])).toBe(key_kiosk_id)
    expect(arg_object_id(tx, extract.MoveCall.arguments[1])).toBe(
      key_kiosk_cap_id,
    )
    expect(arg_object_id(tx, activate.MoveCall.arguments[2])).toBe(A.kiosk_id)
    expect(arg_object_id(tx, activate.MoveCall.arguments[3])).toBe(
      A.personal_kiosk_cap_id,
    )
  })

  test('refuses while EXTRACT_POLICY is unstamped', () => {
    const no_xpolicy = {
      ...ctx,
      ids: { aresrpg: { ...IDS.aresrpg, EXTRACT_POLICY: '' } },
    }
    expect(() => activate_ptb(no_xpolicy)(A)).toThrow(/EXTRACT_POLICY/)
  })

  test('many composer validates its member collection', () => {
    expect(() => activate_many_ptb(ctx)({ members: null })).toThrow(
      /members must be an array/,
    )
  })
})

describe('dungeon next_fight / join_fight / settle_run — targets, arg shapes, Random discipline', () => {
  test('next_fight → dungeon::next_fight, 13 args, deterministic; fight_version = ENGINE_VERSION', () => {
    const tx = next_fight_ptb(ctx)(A)
    const call = find_call(tx, 'dungeon::next_fight')
    expect(call.package).toBe(IDS.aresrpg.DUNGEON_PACKAGE_ID)
    expect(call.args).toBe(13)
    expect(has_no_random(tx)).toBe(true)
    // the S-57 type-split fix: fight_version (FightVersion) is the ENGINE's Version, NOT core VERSION
    expect(input_ids(tx)).toContain(IDS.aresrpg.ENGINE_VERSION)
  })
  test('join_fight → dungeon::join_fight, 13 args (clock appended LAST), deterministic; fight_version = ENGINE_VERSION', () => {
    const tx = join_fight_ptb(ctx)(A)
    expect(find_call(tx, 'dungeon::join_fight').args).toBe(13)
    expect(targets(tx)).toEqual(['header::aresrpg', 'dungeon::join_fight'])
    expect(input_ids(tx)).toContain(IDS.aresrpg.ENGINE_VERSION)
  })
  test('settle_run → dungeon::settle_run, 7 args with character-restore proofs', () => {
    expect(find_call(settle_run_ptb(ctx)(A), 'dungeon::settle_run').args).toBe(
      7,
    )
  })
})

describe('dungeon re-exports — abandon + run read', () => {
  test('abandon_ptb builds dungeon::abandon; get_run_pass is re-exported', () => {
    const tx = abandon_ptb(ctx)(A)
    expect(find_call(tx, 'dungeon::abandon').args).toBe(5)
    expect(typeof get_run_pass).toBe('function')
  })
})
