// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Generated doors compose PRE-RESOLVED Transactions through the SDK's real resolver: pins ride
// sharedObjectRef, owned/shared caller objects come from the receipt-fed cache, an unknown id
// THROWS (the zero-roundtrip law), and hot potatoes chain through returned results.

import { describe, expect, test } from 'bun:test'
import type { Transaction } from '@mysten/sui/transactions'

import { SDK, DOORS, absorb_receipt, type Receipt, type SuiTransport } from '../src/client.ts'

type ChangedRow = NonNullable<NonNullable<Receipt['effects']>['changedObjects']>[number]

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const pin = (n: number) => ({ id: id(n), shared_version: '1' })
const pins = {
  package: id(1),
  math_package: id(2),
  version: pin(3),
  name_registry: pin(4),
  character_policy: pin(5),
  item_policy: pin(6),
  loot_registry: pin(7),
  character_protected_policy: pin(8),
  item_protected_policy: pin(9),
  friend_registry: pin(10),
  board_catalog: pin(20),
}

const owned = (object_id: string, version = '5'): ChangedRow => ({
  objectId: object_id,
  idOperation: 'None',
  outputState: 'ObjectWrite',
  outputVersion: version,
  outputDigest: digest,
  outputOwner: { $kind: 'AddressOwner', AddressOwner: id(99) },
})
const shared = (object_id: string): ChangedRow => ({
  objectId: object_id,
  idOperation: 'Created',
  outputState: 'ObjectWrite',
  outputVersion: '1',
  outputDigest: digest,
  outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
})

const game = () => {
  const sdk = SDK({ client: {} as SuiTransport, pins })
  // the receipt-fed cache: kiosks are SHARED, caps/coins/templates arrive owned
  absorb_receipt(sdk.cache, {
    effects: {
      changedObjects: [shared(id(11)), owned(id(12)), owned(id(13)), owned(id(14)), shared(id(15)), owned(id(16))],
    },
  })
  return sdk
}

const move_calls = (tx: Transaction) =>
  tx
    .getData()
    .commands.filter((c) => c.MoveCall)
    .map((c) => c.MoveCall!)
const inputs_of = (tx: Transaction) => tx.getData().inputs

describe('generated doors through the bound resolver', () => {
  test('every pinned SDK transaction starts with the AresRPG header', () => {
    const [header] = game().tx().getData().commands

    expect(header?.MoveCall).toMatchObject({
      package: pins.math_package,
      module: 'aresrpg',
      function: 'aresrpg',
    })
  })

  test('create_character: right target, 14 args, every object input PRE-RESOLVED', () => {
    const sdk = game()
    const tx = sdk.tx()
    sdk.doors.create_character(tx, {
      payment: id(12),
      kiosk: id(11),
      cap: id(13),
      raw_name: 'nox',
      classe: 'senshi',
      male: true,
      color_1: 1,
      color_2: 2,
      color_3: 3,
      first_world: id(14),
    })
    const [, call] = move_calls(tx)
    expect(call.package).toBe(pins.package)
    expect(call.module).toBe('api')
    expect(call.function).toBe('create_character')
    expect(call.arguments).toHaveLength(14)
    // ZERO unresolved inputs: every object is a SharedObject or ImmOrOwnedObject ref already
    const unresolved = inputs_of(tx).filter((i) => 'UnresolvedObject' in i || 'UnresolvedPure' in i)
    expect(unresolved).toHaveLength(0)
  })

  test('an id the cache does not know THROWS — the SDK never resolves over RPC in a build', () => {
    const sdk = game()
    const tx = sdk.tx()
    expect(() =>
      sdk.doors.raise_stat(tx, { kiosk: id(11), cap: id(13), character_id: id(13), stat: 'strength', points: 5 })
    ).not.toThrow()
    expect(() =>
      sdk.doors.raise_stat(tx, { kiosk: id(77), cap: id(13), character_id: id(13), stat: 'strength', points: 5 })
    ).toThrow(/unresolved object/)
  })

  test('shared vs owned resolution takes the right ref shape', () => {
    const sdk = game()
    const tx = sdk.tx()
    sdk.doors.raise_stat(tx, { kiosk: id(11), cap: id(13), character_id: id(13), stat: 'strength', points: 5 })
    const inputs = inputs_of(tx)
    const kinds = inputs.flatMap((i) => ('Object' in i && i.Object ? [Object.keys(i.Object)[0]] : []))
    expect(kinds).toContain('SharedObject') // the kiosk + the version pin
    expect(kinds).toContain('ImmOrOwnedObject') // the cap
  })

  test('hot potatoes chain: engage_fight result feeds add_fight_mob and launch_fight', () => {
    const sdk = game()
    const tx = sdk.tx()
    const build = sdk.doors.engage_fight(tx, {
      kiosk: id(11),
      cap: id(13),
      character_id: id(13),
      world_object: id(15),
      world_content: { objectId: id(21), initialSharedVersion: '7' },
      catalog: { objectId: id(22), initialSharedVersion: '8' },
      zone_x: 0,
      zone_z: 0,
      group_index: 0,
      access: 0,
    })
    const grown = sdk.doors.add_fight_mob(tx, { build, template: id(16) })
    sdk.doors.launch_fight(tx, { build: grown })
    const calls = move_calls(tx).slice(1)
    expect(calls.map((c) => c.function)).toEqual(['engage_fight', 'add_fight_mob', 'launch_fight'])
    const chained = (argument: (typeof calls)[number]['arguments'][number]) =>
      argument.$kind === 'Result' || argument.$kind === 'NestedResult'
    expect(chained(calls[1]!.arguments[0]!)).toBe(true)
    expect(chained(calls[2]!.arguments[0]!)).toBe(true)
  })

  test('a missing pin throws at the door, loudly and by name', () => {
    const sdk = SDK({ client: {} as SuiTransport, pins: { ...pins, version: { id: null, shared_version: null } } })
    absorb_receipt(sdk.cache, { effects: { changedObjects: [shared(id(11)), owned(id(13))] } })
    const tx = sdk.tx()
    expect(() =>
      sdk.doors.raise_stat(tx, { kiosk: id(11), cap: id(13), character_id: id(13), stat: 'strength', points: 5 })
    ).toThrow(/missing pin "version"/)
  })

  test('terminal doors carry the flag in DOORS metadata', () => {
    const sdk = game()
    expect(sdk.doors.start_fight).toBeDefined()
    expect(DOORS.start_fight.terminal).toBe(true)
    expect(DOORS.raise_stat.terminal).toBe(false)
  })
})
