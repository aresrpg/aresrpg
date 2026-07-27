// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  admit_events,
  adopt_snapshot,
  empty_core_state,
  fight_fingerprint,
  project_board,
} from '../src/core.js'

const fight = {
  id: '0xfight',
  width: 12,
  height: 12,
  status: 1,
  participants: [
    { character: '0xa', cell: '5', hp: '70', ap: '6', mp: '3' },
    { character: '0xb', cell: '6', hp: '60', ap: '6', mp: '3' },
  ],
  mobs: [{ cell: '20', hp: '40' }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: false, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: '1000',
}

const action = (kind, fields, version, event_idx = 0) => ({
  kind,
  ...fields,
  version,
  event_idx,
  source: 'receipt',
})

const core_with = (actions) => {
  const inbox = adopt_snapshot(empty_core_state().inbox, fight, 10, {})
  return { ...empty_core_state('0xfight'), inbox: admit_events(inbox, actions, 1).inbox }
}

describe('chain-anchored turn owner', () => {
  test('different delivery orders agree on the latest TurnStarted chain coordinate', () => {
    const mob = action('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }, 11)
    const partner = action('TurnStarted', { is_mob: false, idx: 1, deadline_ms: 9000 }, 12)
    const a = core_with([mob, partner])
    const b = core_with([partner, mob])

    expect(project_board(a).active).toBe('p1')
    expect(project_board(b).active).toBe('p1')
    expect(project_board(a).turn_ordinal).toBe('9000')
    expect(project_board(b).turn_ordinal).toBe('9000')
  })
})

describe('canonical per-turn divergence fingerprint', () => {
  test('same canonical events produce the same hash; one dropped event changes it', () => {
    const started = action('TurnStarted', { is_mob: false, idx: 1, deadline_ms: 9000 }, 12)
    const moved = action('Moved', { character: '0xb', to_cell: 17 }, 13)
    const left = core_with([started, moved])
    const same = core_with([moved, started])
    const dropped = core_with([started])

    expect(fight_fingerprint(left)).toEqual(fight_fingerprint(same))
    expect(fight_fingerprint(left).hash).not.toBe(fight_fingerprint(dropped).hash)
    expect(fight_fingerprint(left).turn_ordinal).toBe('9000')
  })
})
