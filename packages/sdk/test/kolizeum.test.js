// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  start_ptb,
  seat_ptb,
  settle_ptb,
  open_ptb,
  settle_arena_ptb,
  create_public_ptb,
  get_kolizeum,
  KOLIZEUM_STATUS,
} from '../src/kolizeum.js'

import { EMPTY_IDS, IDS, id, targets, find_call } from './_onchain_fixtures.js'

// PACKAGE-SPLIT 2026-07-11: kolizeum is its OWN `aresrpg_kolizeum` package again — every target resolves to
// KOLIZEUM_PACKAGE_ID (not the core LATEST_PACKAGE_ID). The S-46 KolizeumRegistry stays gone (start/seat call the
// engine's package-internal doors via the private KolizeumBrand witness).
const ctx = { network: 'testnet', ids: IDS }
const undeployed = { network: 'testnet', ids: EMPTY_IDS }

const A = {
  kolizeum_id: id('c0'),
  fight_id: id('fi0'),
  outcome_id: id('re0'), // FightOutcome (settle/open — the ENGINE settlement artifact)
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
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

describe('kolizeum bridge builders — refuse loudly when undeployed', () => {
  test('start/seat/settle/open/settle_arena refuse', () => {
    expect(() => start_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => seat_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => settle_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => open_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => settle_arena_ptb(undeployed)(A)).toThrow(/not deployed/)
  })
})

describe('kolizeum bridge builders — targets + arg shapes (no Random)', () => {
  test('start → kolizeum::start, 10 args, aresrpg_kolizeum package; fight_version = ENGINE_VERSION', () => {
    const tx = start_ptb(ctx)(A)
    const call = find_call(tx, 'kolizeum::start')
    // package-split: the target is the sibling aresrpg_kolizeum package, NOT the core LATEST_PACKAGE_ID
    expect(call.package).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
    expect(call.package).not.toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(10)
    // the type-split: fight_version (FightVersion) is the ENGINE's Version, NOT core VERSION
    expect(input_ids(tx)).toContain(IDS.aresrpg.ENGINE_VERSION)
  })
  test('seat → kolizeum::seat, 11 args (items_version DROPPED in the split; clock LAST); fight_version = ENGINE_VERSION', () => {
    const tx = seat_ptb(ctx)(A)
    const call = find_call(tx, 'kolizeum::seat')
    expect(call.package).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
    // was 12 pre-split (duplicate VERSION for the items_version marker path); the split dropped that arg → 11
    expect(call.args).toBe(11)
    expect(input_ids(tx)).toContain(IDS.aresrpg.ENGINE_VERSION)
  })
  test('settle → kolizeum::settle, 3 args, aresrpg_kolizeum package', () => {
    const tx = settle_ptb(ctx)(A)
    const call = find_call(tx, 'kolizeum::settle')
    expect(call.package).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
    expect(call.args).toBe(3)
    expect(targets(tx)).toEqual(['kolizeum::settle'])
  })
})

describe('kolizeum arena-outcome terminal — open + the one-PTB compose', () => {
  test('open → kolizeum::open, 1 arg (outcome by value), aresrpg_kolizeum package', () => {
    const tx = open_ptb(ctx)(A)
    const call = find_call(tx, 'kolizeum::open')
    expect(call.package).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
    expect(call.args).toBe(1)
    expect(targets(tx)).toEqual(['kolizeum::open'])
  })
  test('settle_arena → settle_and_take (ENGINE) → kolizeum::settle(&o) → kolizeum::open(o)', () => {
    const tx = settle_arena_ptb(ctx)(A)
    // the exact one-PTB terminal chain, in order
    expect(targets(tx)).toEqual([
      'settlement::settle_and_take',
      'kolizeum::settle',
      'kolizeum::open',
    ])
    // settle_and_take rides the ENGINE call target; settle + open ride the sibling aresrpg_kolizeum package
    expect(find_call(tx, 'settlement::settle_and_take').package).toBe(
      IDS.aresrpg.ENGINE_LATEST_PACKAGE_ID,
    )
    expect(find_call(tx, 'kolizeum::settle').package).toBe(
      IDS.aresrpg.KOLIZEUM_PACKAGE_ID,
    )
    expect(find_call(tx, 'kolizeum::open').package).toBe(
      IDS.aresrpg.KOLIZEUM_PACKAGE_ID,
    )
    // settle borrows the handle (3 args) → open consumes it by value (1 arg)
    expect(find_call(tx, 'kolizeum::settle').args).toBe(3)
    expect(find_call(tx, 'kolizeum::open').args).toBe(1)
  })
})

describe('kolizeum re-exports — lobby money core + read', () => {
  test('create_public_ptb + get_kolizeum + KOLIZEUM_STATUS are re-exported', () => {
    expect(typeof create_public_ptb).toBe('function')
    expect(typeof get_kolizeum).toBe('function')
    expect(KOLIZEUM_STATUS.OPEN).toBe(0)
  })
})
