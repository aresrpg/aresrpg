// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Frontend adapter pin for the settled character↔world binding core. Creation has no join scheduler here:
// its receipt publishes the membership committed by the same PTB.

import { beforeEach, describe, expect, it } from 'bun:test'

import {
  bound_world_of,
  observe_roster_bindings,
  publish_world_binding,
  rebind_world_character,
  reset_world_binding,
  use_world_binding,
  world_rows_of,
} from './session_gate.js'

const CHAR = `0x${'3'.repeat(64)}`
const WORLD = `0x${'7'.repeat(64)}`

beforeEach(() => reset_world_binding())

describe('the session-gate adapter', () => {
  it('publishes settled membership and discards an indexer-lagged poll', () => {
    publish_world_binding(CHAR, WORLD, 'manual')
    expect(use_world_binding.getState()).toMatchObject({ character_id: CHAR, world: WORLD })
    publish_world_binding(CHAR, null, 'poll')
    expect(use_world_binding.getState().world).toBe(WORLD)
  })

  it('keeps the unconfirmed chain-truth row in the book and exposes discarded polls as data', () => {
    publish_world_binding(CHAR, WORLD, 'manual')
    publish_world_binding(CHAR, null, 'poll')
    const { character_world_by_id, stale_poll } = use_world_binding.getState()
    expect(character_world_by_id.get(CHAR)).toEqual({ world: WORLD, source: 'manual', confirmed: false })
    expect(stale_poll).toMatchObject({ character_id: CHAR, target: WORLD })
  })

  it('answers every character from the one book, the cached roster feed floored behind chain truth', () => {
    const ALT = `0x${'4'.repeat(64)}`
    const ALT_WORLD = `0x${'8'.repeat(64)}`
    publish_world_binding(CHAR, WORLD, 'manual')
    observe_roster_bindings([
      { id: CHAR, world_id: null }, // the pre-travel snapshot the indexer still serves
      { id: ALT, world_id: ALT_WORLD },
      { id: 'optimistic' }, // an un-indexed row is UNKNOWN, never confirmed-unbound
    ])
    expect(bound_world_of(CHAR)).toBe(WORLD)
    expect(bound_world_of('optimistic')).toBeUndefined()
    expect(world_rows_of([CHAR, ALT, 'optimistic'])).toEqual([
      { character_id: CHAR, world_id: WORLD },
      { character_id: ALT, world_id: ALT_WORLD },
      { character_id: 'optimistic', world_id: null },
    ])
    // the alt's own binding never re-keys the live session
    expect(use_world_binding.getState().character_id).toBe(CHAR)
  })

  it('rebinds an explicit selection and rejects an unknown card binding', () => {
    rebind_world_character(CHAR, WORLD)
    expect(use_world_binding.getState()).toMatchObject({ character_id: CHAR, world: WORLD })
    expect(() => rebind_world_character(CHAR, undefined)).toThrow('has no indexed world binding')
    expect(() => rebind_world_character('', WORLD)).toThrow('without a character id')
  })

  it('resets a wallet session to unknown membership', () => {
    publish_world_binding(CHAR, WORLD)
    reset_world_binding()
    expect(use_world_binding.getState()).toMatchObject({ character_id: null, world: undefined })
  })
})
