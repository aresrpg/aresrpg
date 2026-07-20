import { describe, expect, it } from 'bun:test'
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import * as team_entry from './team_entry.js'
import {
  derive_team_entry_plan,
  has_team_entry_keys,
  required_team_key_count,
  usable_team_entry_keys,
} from './team_entry.js'

const ME = '0xme'
const row = (character_id, over = {}) => ({
  owner: ME,
  character_id,
  world: 'world-a',
  blocked_reason: null,
  ...over,
})
const key = (id, amount = 1) => ({
  id,
  amount,
  item_category: ITEM_CATEGORY.KEY,
  kiosk_id: `${id}-kiosk`,
  kiosk_cap_id: `${id}-cap`,
})

describe('owned-character group entry', () => {
  it('selects same-wallet same-world unjoined alts without exceeding six party members', () => {
    const owned_characters = [
      row('active'),
      row('joined-alt'),
      row('alt-a'),
      row('alt-b'),
      row('away-alt', { world: 'world-b' }),
      row('locked-alt', { blocked_reason: 'fight' }),
      row('foreign-alt', { owner: '0xfriend' }),
    ]
    const party_members = [
      { character: 'active' },
      { character: 'joined-alt' },
      { character: 'friend-a' },
      { character: 'friend-b' },
      { character: 'friend-c' },
    ]

    expect(
      team_entry.select_owned_party_join_ids({
        owned_characters,
        party_members,
        my_address: ME,
        active_character_id: 'active',
        active_world_id: 'world-a',
      })
    ).toEqual(['alt-a'])
  })
})

// NOTE (multichar lane): the world-fight join DECISION moved into @aresrpg/party's group_loop reducer
// (owned ∧ leader-world ∧ ¬seated ∧ ¬blocked, latched per fight) — select_owned_fight_join_ids and its
// spec died with it; group_loop.test.js + group_wiring.test.js own that coverage now.

describe('dungeon team key derivation', () => {
  it('rebuilds only same-world, same-room owned RunPasses on reload', () => {
    expect(
      team_entry.select_owned_run_pass_ids({
        runs: [
          { pass_id: 'pass-leader', character: 'leader', world: 'world-a', room: 2, fight_id: null },
          { pass_id: 'pass-alt', character: 'alt-a', world: 'world-a', room: 2, fight_id: null },
          { pass_id: 'pass-away', character: 'alt-away', world: 'world-b', room: 2, fight_id: null },
          { pass_id: 'pass-stale', character: 'alt-stale', world: 'world-a', room: 1, fight_id: null },
          { pass_id: 'pass-foreign', character: 'friend', world: 'world-a', room: 2, fight_id: null },
        ],
        owned_character_ids: ['leader', 'alt-a', 'alt-away', 'alt-stale'],
        world_id: 'world-a',
        room: 2,
        fight_id: null,
      })
    ).toEqual({ leader: 'pass-leader', 'alt-a': 'pass-alt' })
  })

  it('matches a pending dungeon outcome to the same character pass, not a sibling pass in the same fight', () => {
    expect(
      team_entry.character_run_pass_id(
        [
          { pass_id: 'pass-a', character: 'alt-a', fight_id: 'fight' },
          { pass_id: 'pass-b', character: 'alt-b', fight_id: 'fight' },
        ],
        'fight',
        'alt-b'
      )
    ).toBe('pass-b')
  })

  it('counts leader plus eligible owned alts only, capped at six total', () => {
    const members = [
      row('leader'),
      row('alt-a'),
      row('friend', { owner: '0xfriend' }),
      row('locked-alt', { blocked_reason: 'fight' }),
      ...Array.from({ length: 6 }, (_, index) => row(`extra-${index}`)),
    ]
    expect(
      required_team_key_count({
        members,
        my_address: ME,
        leader_character_id: 'leader',
        leader_world_id: 'world-a',
      })
    ).toBe(6)
  })

  it('requires an owned leader row and never counts non-owned rows', () => {
    expect(
      required_team_key_count({
        members: [row('friend', { owner: '0xfriend' })],
        my_address: ME,
        leader_character_id: 'leader',
        leader_world_id: 'world-a',
      })
    ).toBe(0)
    expect(required_team_key_count({ members: [], my_address: ME, leader_character_id: null })).toBe(0)
  })

  it('counts stack quantities and assigns one key unit per distinct eligible character', () => {
    const items = [key('stack', 2), key('single'), { ...key('no-cap', 9), kiosk_cap_id: null }]
    const assignments = team_entry.assign_team_entry_keys(['leader', 'alt-a', 'alt-a', 'alt-b'], items)

    expect(usable_team_entry_keys(items).map((item) => item.id)).toEqual(['stack', 'single'])
    expect(has_team_entry_keys(items, 3)).toBe(true)
    expect(has_team_entry_keys(items, 4)).toBe(false)
    expect(assignments).toEqual([
      {
        character_id: 'leader',
        key_item_id: 'stack',
        key_kiosk_id: 'stack-kiosk',
        key_kiosk_cap_id: 'stack-cap',
      },
      {
        character_id: 'alt-a',
        key_item_id: 'stack',
        key_kiosk_id: 'stack-kiosk',
        key_kiosk_cap_id: 'stack-cap',
      },
      {
        character_id: 'alt-b',
        key_item_id: 'single',
        key_kiosk_id: 'single-kiosk',
        key_kiosk_cap_id: 'single-cap',
      },
    ])
  })

  it('deduplicates ids and disables the whole plan for a locked, wrong-world, or unidentified owned alt', () => {
    const members = [
      row('leader'),
      row('alt-a'),
      row('alt-a'),
      row('locked', { blocked_reason: 'fight' }),
      row('away', { world: 'world-b' }),
      row(null),
      row('friend', { owner: '0xfriend' }),
    ]
    const plan = derive_team_entry_plan(
      { members, my_address: ME, leader_character_id: 'leader', leader_world_id: 'world-a' },
      [key('one'), key('two'), key('three'), key('four')]
    )
    expect(plan.eligible_character_ids).toEqual(['leader', 'alt-a'])
    expect(plan.required_keys).toBe(2)
    expect(plan.blocked_owned_members).toHaveLength(3)
    expect(plan.can_enter).toBe(false)
  })
})
