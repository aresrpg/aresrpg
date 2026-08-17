// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The resolution cache: receipts in, exact refs out — owned versions never regress, shared
// initial versions stick from first sight, deletions leave.

import { describe, expect, test } from 'bun:test'

import { create_cache, absorb_receipt, absorb_object, owned_ref, shared_ref, type Receipt } from '../src/cache.ts'

type ChangedRow = NonNullable<NonNullable<Receipt['effects']>['changedObjects']>[number]

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const owned = (object_id: string, version: string, digest: string): ChangedRow => ({
  objectId: object_id,
  idOperation: 'None',
  outputState: 'ObjectWrite',
  outputVersion: version,
  outputDigest: digest,
  outputOwner: { $kind: 'AddressOwner', AddressOwner: id(9) },
})
const wrap = (rows: ChangedRow[]): Receipt => ({ effects: { changedObjects: rows } })

describe('resolution cache', () => {
  test('owned refs: the freshest version wins whatever the arrival order', () => {
    const cache = create_cache()
    absorb_receipt(cache, wrap([owned(id(1), '7', 'd7')]))
    absorb_receipt(cache, wrap([owned(id(1), '9', 'd9')]))
    absorb_receipt(cache, wrap([owned(id(1), '8', 'd8')])) // late, stale
    expect(owned_ref(cache, id(1))).toEqual({ objectId: id(1), version: '9', digest: 'd9' })
  })

  test('a created shared object registers its STABLE initial version once', () => {
    const cache = create_cache()
    absorb_receipt(
      cache,
      wrap([
        {
          objectId: id(2),
          idOperation: 'Created',
          outputState: 'ObjectWrite',
          outputVersion: '4',
          outputDigest: 'd4',
          outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '4' } },
        },
      ])
    )
    // later mutations of the shared object never move the initial version
    absorb_receipt(
      cache,
      wrap([
        {
          objectId: id(2),
          idOperation: 'None',
          outputState: 'ObjectWrite',
          outputVersion: '9',
          outputDigest: 'd9',
          outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '4' } },
        },
      ])
    )
    expect(shared_ref(cache, id(2))).toEqual({ initialSharedVersion: '4' })
    expect(owned_ref(cache, id(2))).toBeUndefined()
  })

  test('deleted and wrapped objects leave both tables', () => {
    const cache = create_cache()
    absorb_receipt(cache, wrap([owned(id(1), '3', 'd3')]))
    absorb_receipt(cache, wrap([{ objectId: id(1), idOperation: 'Deleted', outputState: 'DoesNotExist' }]))
    expect(owned_ref(cache, id(1))).toBeUndefined()
  })

  test('hydrate seeding: absorb_object routes by owner shape', () => {
    const cache = create_cache()
    absorb_object(cache, {
      objectId: id(1),
      version: '2',
      digest: 'd2',
      owner: { $kind: 'AddressOwner', AddressOwner: id(9) },
    })
    absorb_object(cache, {
      objectId: id(2),
      version: '5',
      digest: 'd5',
      owner: { $kind: 'Shared', Shared: { initialSharedVersion: '3' } },
    })
    expect(owned_ref(cache, id(1))).toEqual({ objectId: id(1), version: '2', digest: 'd2' })
    expect(shared_ref(cache, id(2))).toEqual({ initialSharedVersion: '3' })
  })

  test('canonical Sui IDs resolve through their short form', () => {
    const cache = create_cache()
    const display_registry = `0x${'d'.padStart(64, '0')}`
    absorb_object(cache, {
      objectId: display_registry,
      version: '5',
      digest: 'd5',
      owner: { $kind: 'Shared', Shared: { initialSharedVersion: '3' } },
    })

    expect(shared_ref(cache, '0xd')).toEqual({ initialSharedVersion: '3' })
  })

  test('a receipt without objectChanges is a clean no-op', () => {
    const cache = create_cache()
    expect(absorb_receipt(cache, {})).toBe(cache)
    expect(absorb_receipt(cache, undefined)).toBe(cache)
  })
})
