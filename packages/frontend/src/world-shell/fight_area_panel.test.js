// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'
import { section_fight_rows } from '@aresrpg/world/nearby_fights'

import { short_fighter_id } from './character_name_resolve.js'
import { fight_hover_teams, viewer_has_fighter } from './fight_area_panel.js'

describe('fight-area Option A model', () => {
  it('keeps simultaneous sections in D749 order: GROUP FIGHTS, then PUBLIC', () => {
    const rows = [
      { id: 'group-near', public: false },
      { id: 'public-friend', public: true },
      { id: 'public-near', public: true },
    ]
    expect(section_fight_rows(rows)).toEqual([
      { key: 'group', rows: [rows[0]] },
      { key: 'public', rows: [rows[1], rows[2]] },
    ])
  })

  it('builds complete player slots from /v1 docs and preserves every opponent slot', () => {
    const marker = { participant_ids: ['character-a', 'character-b'], mob_count: 3 }
    const teams = fight_hover_teams(marker, new Map([['character-a', { name: 'Ares', level: 42, class: 'Senshi' }]]))
    expect(teams.players).toEqual([
      { id: 'character-a', name: 'Ares', level: 42, class_name: 'Senshi' },
      { id: 'character-b', name: 'character-b', level: null, class_name: null },
    ])
    expect(teams.opponents.map((row) => row.ordinal)).toEqual([1, 2, 3])
  })

  it('names every opponent from the mob-group template via the mob_names catalog', () => {
    // A homogeneous group shares ONE MobTemplate, so every opponent resolves to the same base name;
    // the ordinal distinguishes them. mob_names is the client's ONE catalog home (group_template id → name).
    const marker = { participant_ids: [], mob_count: 2, group_template: '0xtmpl' }
    const teams = fight_hover_teams(marker, new Map(), { '0xtmpl': 'Draugr' })
    expect(teams.opponents).toEqual([
      { id: 'opponent-1', ordinal: 1, name: 'Draugr' },
      { id: 'opponent-2', ordinal: 2, name: 'Draugr' },
    ])
  })

  it('leaves opponent name null when the group template is unresolved or absent (Enemies #N fallback)', () => {
    // unresolved template (not yet in the catalog) → null; a fight with no group_template at all → null.
    const unresolved = fight_hover_teams({ mob_count: 1, group_template: '0xtmpl' }, new Map(), {})
    expect(unresolved.opponents[0].name).toBeNull()
    const no_template = fight_hover_teams({ mob_count: 1 }, new Map(), { '0xtmpl': 'Draugr' })
    expect(no_template.opponents[0].name).toBeNull()
  })

  it('shortens unresolved long ids without losing both ends', () => {
    expect(short_fighter_id('0x1234567890abcdef1234567890')).toBe('0x12345…67890')
  })
})

// #498: spectated public fights labeled the player-side column "Your party" unconditionally. The hover
// card's title now gates on this — true only when a viewer character is genuinely seated.
describe('viewer_has_fighter (#498 — the hover card party-label gate)', () => {
  it("is true when one of the viewer's own characters is seated on the player side", () => {
    const players = [{ id: 'character-a' }, { id: 'character-b' }]
    expect(viewer_has_fighter(players, new Set(['character-b']))).toBe(true)
  })

  it("is false for a fully spectated fight — none of the viewer's characters are seated", () => {
    const players = [{ id: 'character-a' }, { id: 'character-b' }]
    expect(viewer_has_fighter(players, new Set(['character-z']))).toBe(false)
  })

  it('accepts a plain array/iterable, not just a Set, and never throws on an empty roster', () => {
    expect(viewer_has_fighter([{ id: 'character-a' }], ['character-a'])).toBe(true)
    expect(viewer_has_fighter([], new Set())).toBe(false)
    expect(viewer_has_fighter(undefined, undefined)).toBe(false)
  })
})
