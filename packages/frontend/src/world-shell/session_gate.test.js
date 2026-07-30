// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Frontend adapter pin for the settled character↔world binding core. Creation has no join scheduler here:
// its receipt publishes the membership committed by the same PTB.

import { beforeEach, describe, expect, it } from 'bun:test'

import {
  publish_world_binding,
  rebind_world_character,
  reset_world_binding,
  use_world_binding,
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

  it('keeps the pending manual target in the atom and exposes discarded polls as data', () => {
    publish_world_binding(CHAR, WORLD, 'manual')
    publish_world_binding(CHAR, null, 'poll')
    const { pending_manual_target, stale_poll } = use_world_binding.getState()
    expect(pending_manual_target.get(CHAR)).toBe(WORLD)
    expect(stale_poll).toMatchObject({ character_id: CHAR, target: WORLD })
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
