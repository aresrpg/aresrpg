// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ENGINE-CONSUMPTION HALF of the ruled mob model (#1110/#1111). The chain already derives a per-group member
// ROSTER (`zone_gen::derive_mob_groups_members`) and seats every unit from ITS OWN spec at a level window that
// slides up ITS OWN authored band (`mob::graded_band` × `mob::spawn_seeded_graded`, consumed by
// `fight::create_members`). The client kept composing every group from the PRIMARY template's FLAT band, so the
// map lied twice, exactly as reported in play:
//   (a) a LV 12 mob stood beside a LV 1 character at ring 1 near spawn — a flat `uniform(min, max)` draw over
//       the whole authored band, where the chain draws the band's FLOOR at progress 0;
//   (b) every group rendered as N copies of one species — the roster was derived, transported, and dropped.
// The assertions below are those two symptoms, and the sad paths a format-1/2 zone still has to replay.
// Pure by construction (no DOM, no engine): the card's COMPOSITION is data, the painting is not.

import { describe, expect, test } from 'bun:test'

import { compose_group_card, seated_roster } from '../../src/game/spawn_compose.js'

// Authored bands, as a MobTemplate carries them. The window the engine draws from slides up these with distance.
const CHICKLET = { name: 'Chicklet', min_level: 1, max_level: 12 }
const DRAUGR = { name: 'Draugr', min_level: 8, max_level: 20 }
const SEED = '7719283746501' // a live group_seed — the composition is seeded at discovery, never Math.random

const card_of = (facts) =>
  compose_group_card({
    size: facts.roster.length,
    group_seed: SEED,
    archimob_bp: 0,
    team_bound: 6,
    ...facts,
  })

describe('the graded window — difficulty rides distance (#1111)', () => {
  test('RING 1 (progress 0): every unit draws the FLOOR of its own authored band', () => {
    // The reported symptom's exact shape: a wide-banded species one ring out from spawn. `graded_band(1, 12, 0)`
    // is the single value 1, so a fresh character can only ever meet LV 1 chicklets there.
    const card = card_of({
      roster: [CHICKLET, CHICKLET, CHICKLET],
      graded: true,
      progress: 0,
    })
    expect(card.rows.map((r) => r.level)).toEqual([1, 1, 1])
    expect(card.span_lo).toBe(1)
    expect(card.span_hi).toBe(1)
  })

  test('THE EDGE (progress 1000): the window has climbed to the band top quarter', () => {
    // Without this the ring-1 assertion could pass on a broken derivation that just always returns min_level.
    const card = card_of({
      roster: [CHICKLET, CHICKLET, CHICKLET],
      graded: true,
      progress: 1000,
    })
    for (const row of card.rows) expect(row.level).toBeGreaterThanOrEqual(10) // graded_band(1, 12, 1000) = [10, 12]
    expect(card.span_hi).toBeLessThanOrEqual(12)
  })
})

describe('the member roster — a pack holds several species (#1110)', () => {
  test('a two-species roster composes TWO species, each level from ITS OWN band', () => {
    const card = card_of({
      roster: [CHICKLET, DRAUGR, CHICKLET],
      graded: true,
      progress: 1000,
    })
    expect(card.rows.map((r) => r.name)).toEqual(['Chicklet', 'Draugr', 'Chicklet'])
    expect(card.rows[1].level).toBeGreaterThanOrEqual(17) // graded_band(8, 20, 1000) = [17, 20] — the draugr's own
    expect(card.rows[0].level).toBeLessThanOrEqual(12) // …and never the neighbour's
  })

  test('THE BOSS FENCE survives consumption: a single-spec roster stays single-spec', () => {
    // The kernel spends NO member draws on a boss primary (a zero-weight member row), so the roster arrives as
    // the one row repeated. Consumption must not invent variety the chain never committed.
    const card = card_of({
      roster: [DRAUGR, DRAUGR, DRAUGR],
      graded: true,
      progress: 400,
    })
    expect(new Set(card.rows.map((r) => r.name)).size).toBe(1)
  })
})

describe('seated_roster — the per-unit template list, one home', () => {
  test('a format-3 row seats its committed roster IN ORDER (the rig each unit wears)', () => {
    expect(seated_roster({ template_id: '0xchick', members: ['0xchick', '0xdraugr'], size: 2 }, 6)).toEqual([
      '0xchick',
      '0xdraugr',
    ])
  })

  test('an EMPTY roster degrades to the primary repeated — what a format-1/2 zone commits', () => {
    expect(seated_roster({ template_id: '0xchick', members: [], size: 3 }, 6)).toEqual([
      '0xchick',
      '0xchick',
      '0xchick',
    ])
    expect(seated_roster({ template_id: '0xchick', size: 2 }, 6)).toEqual(['0xchick', '0xchick'])
  })

  test('the LIVE team bound clamps how many seat — the roster derives at the raw rolled size', () => {
    const rolled = ['a', 'b', 'c', 'd', 'e']
    expect(seated_roster({ template_id: 'a', members: rolled, size: 5 }, 3)).toEqual(['a', 'b', 'c'])
    expect(seated_roster({ template_id: 'a', members: [], size: 0 }, 6)).toEqual(['a']) // floor of 1
  })
})

test('a format-1/2 row keeps the FLAT authored band — those zones still replay spawn_seeded', () => {
  // Applying the graded window to a zone the chain never committed under it would paint a pack the fight never
  // seats. The format is the router, here exactly as it is on chain.
  const flat = card_of({ roster: [CHICKLET, CHICKLET], graded: false })
  for (const row of flat.rows) {
    expect(row.level).toBeGreaterThanOrEqual(1)
    expect(row.level).toBeLessThanOrEqual(12)
  }
  expect(flat.rows.map((r) => r.level)).not.toEqual([1, 1]) // …and NOT the graded progress-0 point draw
})

test('a seedless row (stale SDK read) prints the honest band — never a fabricated level', () => {
  const card = card_of({ roster: [CHICKLET, CHICKLET], graded: true, progress: 0, group_seed: null })
  expect(card.rows.map((r) => r.level)).toEqual([null, null])
  expect(card.span_lo).toBe(1)
  expect(card.span_hi).toBe(12)
})
