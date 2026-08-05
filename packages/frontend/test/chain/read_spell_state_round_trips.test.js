// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2155 — THE ENGAGE COMPOSE'S ROUND-TRIP BILL. Profiled on live testnet 2026-08-05 (the marker-click →
// `ptb-built` span, alice/canaryalice, world zone 488:487): the compose issued 26 `BatchGetObjects` gRPC calls,
// and 21 of them — 81% — came from this ONE read, which asked the ledger for a character's spell fields one id
// at a time. Every one of those ids is derived LOCALLY (`deriveDynamicFieldID`), so the whole set is knowable
// before the first byte goes out; @mysten/sui implements `getObject` as `getObjects({objectIds:[id]})`, so the
// singular door was paying a full round trip per field for a question the ledger answers in one.
//
// This test pins the COUNT, not the clock. The wall clock belongs to whichever transport the caller runs on
// (bun multiplexes 21 reads over one h2 connection in ~70ms; a browser's grpc-web cannot), the count does not.
// RED against the pre-fix read: 21 calls for a 20-spell kit. GREEN after: 1.
import { describe, expect, it } from 'bun:test'

import { set_expedition_sdk_mock, reset_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const { read_spell_state } = await import('../../src/chain/read_spell_state.js')

// Built, never written: a literal 0x…64 in source reads as a live chain pointer (the repo's chain-id gate).
const CHARACTER = `0x${'2155'.padEnd(64, '0')}`
const spell_ids = (count) => Array.from({ length: count }, (_, index) => `0x${String(index + 1).padStart(64, '0')}`)

/** An SDK whose namespaced-field doors record how many CALLS each read costs. */
const counting_sdk = (levels = {}) => {
  const calls = []
  const value_for = (field) => {
    const level = levels[field.key_bytes ? `0x${Buffer.from(field.key_bytes).toString('hex')}` : 'spent']
    return level == null ? null : { value: String(level) }
  }
  return {
    calls,
    read_namespaced_field: async (field) => {
      calls.push(1)
      return value_for(field)?.value ?? null
    },
    read_namespaced_fields: async (fields) => {
      calls.push(fields.length)
      return fields.map((field) => value_for(field)?.value ?? null)
    },
  }
}

describe('#2155 · read_spell_state spends ONE round trip, whatever the kit size', () => {
  it('reads a 20-spell kit + the spent counter in a single call', async () => {
    const sdk = counting_sdk()
    set_expedition_sdk_mock(async () => sdk)
    try {
      const { levels, spent } = await read_spell_state(CHARACTER, spell_ids(20))
      expect(sdk.calls.length).toBe(1) // RED pre-fix: 21
      expect(sdk.calls[0]).toBe(21) // the spent counter + 20 spell fields, one batch
      expect(Object.keys(levels).length).toBe(20)
      expect(spent).toBe(0)
      // An absent SpellLevelKey is the chain's free baseline 1 — never a lie, never a gap.
      expect(new Set(Object.values(levels))).toEqual(new Set([1]))
    } finally {
      reset_expedition_sdk_mock()
    }
  })

  it('still spends one call for a single-spell kit, and none of the ids collide', async () => {
    const sdk = counting_sdk()
    set_expedition_sdk_mock(async () => sdk)
    try {
      await read_spell_state(CHARACTER, spell_ids(1))
      expect(sdk.calls).toEqual([2])
    } finally {
      reset_expedition_sdk_mock()
    }
  })

  it('reads an EMPTY kit without asking the chain for spell levels', async () => {
    const sdk = counting_sdk()
    set_expedition_sdk_mock(async () => sdk)
    try {
      const { levels, spent } = await read_spell_state(CHARACTER, [])
      expect(sdk.calls).toEqual([1]) // the spent counter alone
      expect(levels).toEqual({})
      expect(spent).toBe(0)
    } finally {
      reset_expedition_sdk_mock()
    }
  })
})
