// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE REPLAY-IDEMPOTENCE PROPERTY (issue #281) — the mechanical death of the double-death family.
//
// A presentation beat must be a function of an OBSERVED STATE DELTA, never of an EVENT ARRIVAL. On-chain
// truth reaches this client redundantly — one authoritative fact carried by a receipt, the 4s poll, and a
// p2p relay — so the observe discipline (project a slice, compare, fire only on a real change) is what keeps
// a kill's death beat, a mob's slide, a peer's cast from re-playing when the SAME fact is delivered again.
//
// This is that discipline as a PROPERTY, generated over the whole scenario corpus: for each scenario, running
// it with every authoritative input duplicated 2-3× interleaved must produce a BYTE-IDENTICAL presentation
// trace (the ordered wave/beat list) to the single-delivery run. A new scenario is gated the day it lands; a
// regression that makes any beat fire off arrival reds here.
//
// KNOWN-RED debt is honest and visible: a scenario the discipline does NOT yet hold for lives in RED_PENDING
// with its tracking issue, asserted to STILL diverge. When the fix lands, its `.not` assertion flips red and
// forces promotion (delete the row) — the list only shrinks, and nothing is ever skip-silent.

import { describe, expect, test } from 'bun:test'

import { replay_idempotent } from '../harness/replay_idempotence.js'
import { SCENARIOS } from '../harness/scenarios.js'

import { create_fight_store } from './store.js'

/**
 * KNOWN-RED registry — scenario name → `#issue: one-line why`. A row here asserts duplicate delivery STILL
 * changes the presentation (the re-beat bug is live); remove the row the moment its lane lands the fix.
 * @type {Map<string, string>}
 */
const RED_PENDING = new Map([
  // e.g. ['some_scenario', '#274: a re-read replays the death a second time'] — none at this HEAD.
])

// M2b · ONE INGRESS (#291): the COOP peer-turn presentation these scenarios exercise rides the deleted
// snapshot-diff replay; peer-turn pacing via the journal is the peer lane's. Fold-level delivery idempotence (the
// #290 property extended to the full ingress) is proven in one_ingress.test.js. Re-enable per scenario when the
// peer lane lands. (Solo scenarios' receipt pacing is unchanged and covered by the scenario_solo suite.)
describe.skip('replay-idempotence — duplicate authoritative delivery never changes the presentation (#281)', () => {
  for (const scenario of SCENARIOS) {
    const red = RED_PENDING.get(scenario.name)
    test(`${scenario.name} — ${red ? `RED-PENDING (${red})` : 'presentation is delivery-idempotent'}`, () => {
      const { single, duplicated } = replay_idempotent(create_fight_store, scenario.log)
      // A scenario that emits nothing proves nothing — every corpus entry must exercise real presentation.
      expect(
        JSON.parse(single).length,
        `${scenario.name} emitted no wave turns — not a presentation scenario`
      ).toBeGreaterThan(0)
      if (red)
        expect(
          duplicated,
          `${scenario.name} is now delivery-idempotent — remove it from RED_PENDING (${red} is fixed)`
        ).not.toBe(single)
      else
        expect(
          duplicated,
          `${scenario.name}: a duplicated authoritative delivery changed the presentation — a beat fired off an arrival, not a delta (#281)`
        ).toBe(single)
    })
  }

  test('the corpus is non-empty (the generator actually ran)', () => {
    expect(SCENARIOS.length).toBeGreaterThan(0)
  })
})
