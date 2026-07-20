// Pivot proof — the deck / level-up card / build planner now derive their spell lists from the fight-spells.json
// SSOT (resolve_class_spells / class_spells via the pure spell-unlock-select selectors), NOT the legacy
// classes.json `{ level -> ONE id }` map. That map could hold a single spell per level; the SSOT filter
// (unlock_level <= level) has NO per-level cap, so the ceremony's THREE starters at unlock_level 1 all surface at
// L1 (slots 0/1/2). The shipped testnet seed still has senshi 1/5/10 (one per tier), so the 3-at-unlock-1 claim
// is proven against a synthetic fixture in the exact corpus shape; the real seed proves the filter drives the
// list end to end.

import { describe, it, expect } from 'bun:test'

import { resolve_class_spells, class_spells } from './fight-spells.js'
import { newly_unlocked, roster_from_rows } from './spell-unlock-select.js'
import SENSHI_CORPUS from '../../../../../../seed/mainnet/spells/senshi.json' with { type: 'json' }

const to_name_key = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

// The ceremony corpus shape (seed/mainnet/spells/senshi.json slots 0/1/2 — Earthen Cleave / Ember Strike /
// Charge): THREE starters at unlock_level 1. resolve_class_spells returns rows unlock-ascending, so a filtered
// list is this array verbatim.
const three_at_l1 = [
  { class: 'senshi', unlock_level: 1, name: 'Earthen Cleave', name_key: 'earthen_cleave', levels: [{ ap: 3 }] },
  { class: 'senshi', unlock_level: 1, name: 'Ember Strike', name_key: 'ember_strike', levels: [{ ap: 4 }] },
  { class: 'senshi', unlock_level: 1, name: 'Charge', name_key: 'charge', levels: [{ ap: 2 }] },
]

describe('three starters at unlock_level 1 render as three L1 spells (no per-level cap)', () => {
  it('planner roster: three entries, all unlock 1, none locked at char level 1', () => {
    const roster = roster_from_rows(three_at_l1)
    expect(roster).toHaveLength(3)
    expect(roster.every(r => r.unlock === 1)).toBe(true)
    expect(roster.filter(r => 1 < r.unlock)).toHaveLength(0) // locked = level < unlock → none at L1
    expect(roster.map(r => r.id)).toEqual(['earthen_cleave', 'ember_strike', 'charge'])
  })
})

describe('the real testnet seed drives the list through the SSOT filter', () => {
  it('senshi deck: L1 → the 3 seeded starters; the class book is every seeded senshi spell, unlock-ascending', () => {
    const starters_at_1 = SENSHI_CORPUS.filter(s => s.unlock === 1).map(s => to_name_key(s.name))
    expect(resolve_class_spells('senshi', 1).map(s => s.name_key)).toEqual(starters_at_1)
    const all_unlocks = SENSHI_CORPUS.map(s => s.unlock).sort((a, b) => a - b)
    expect(class_spells('senshi').map(s => s.unlock_level)).toEqual(all_unlocks)
  })

  it('level-up unlock: crossing into L3 surfaces war_bellow; nothing crosses into L2; freshest slot wins', () => {
    // real ladder (kits_data.mjs LADDER): 3 starters @1, next tier @3 — L5 no longer lands on a tier.
    expect(newly_unlocked(resolve_class_spells('senshi', 3), 2)?.name_key).toBe('war_bellow')
    expect(newly_unlocked(resolve_class_spells('senshi', 2), 1)).toBeNull()
    expect(newly_unlocked(three_at_l1, 0)?.name_key).toBe('charge')
  })
})
