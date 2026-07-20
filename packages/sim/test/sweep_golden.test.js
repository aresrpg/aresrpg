// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { sweep_fight } from '../src/fight_sweep.js'

import golden from './vectors/sweep_golden.json' with { type: 'json' }

const state_of = input => ({
  status: input.status,
  placement_deadline_ms: input.placement_deadline_ms,
  ready_seats: input.ready_seats,
  seats: input.hp.map((hp, index) => ({ id: `p${index}`, hp })),
  winner: null,
})

describe('shared sweep vectors', () => {
  for (const vector of golden.cases)
    test(vector.id, () => {
      const initial = state_of(vector.input)
      const result = sweep_fight(initial, vector.input.now_ms)
      expect(result.swept).toBe(vector.expected.swept)
      expect(result.state.status).toBe(vector.expected.status)
      expect(result.state.winner).toBe(vector.expected.winner)
      expect(result.state.seats.map(seat => seat.hp)).toEqual(
        vector.expected.hp,
      )
      expect(result.abandoned_seats).toEqual(vector.expected.abandoned_seats)
      expect(result.released_seats).toEqual(vector.expected.released_seats)
      expect(result.outcomes).toEqual(vector.expected.outcomes)
      expect(result.events.map(event => event.type)).toEqual(
        vector.expected.events,
      )
      if (!result.swept) expect(result.state).toBe(initial)
    })
})
