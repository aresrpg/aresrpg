// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import {
  active_controlled_character_id,
  can_select_controlled_character,
  controlled_character_ids,
  mob_entity_id,
  mob_entity_index,
  participant_entity_id,
  selected_controlled_character_id,
  set_character_cast_key,
  should_auto_select_active,
  take_character_cast_key,
  transaction_character_id,
} from '../src/fight_control.js'

const ME = '0xme'
const OTHER = '0xother'

const row = (character, addr = ME) => ({ character, addr })

describe('fight character control', () => {
  it('round-trips mob entity ids through the one convention door', () => {
    expect(mob_entity_id(7)).toBe('mob-7')
    expect(mob_entity_index('mob-7')).toBe(7)
    expect(mob_entity_index('mob-seven')).toBeNull()
    expect(mob_entity_index('player-7')).toBeNull()
  })

  it('keeps same-wallet participants as distinct character identities in seat order', () => {
    const participants = [row('char-a'), row('friend', OTHER), row('char-b'), row('char-a')]
    expect(controlled_character_ids(participants, ME)).toEqual(['char-a', 'char-b'])
  })

  it('never admits a non-owned participant into the controlled set', () => {
    const controlled = controlled_character_ids([row('mine'), row('friend', OTHER)], ME)
    expect(controlled).toEqual(['mine'])
    expect(active_controlled_character_id('friend', controlled)).toBeNull()
    expect(can_select_controlled_character('friend', controlled)).toBe(false)
  })

  it('auto-switches to an owned active actor and otherwise retains a valid manual pick', () => {
    const controlled_ids = ['char-a', 'char-b']
    expect(selected_controlled_character_id({ active_entity_id: 'char-b', current_id: 'char-a', controlled_ids })).toBe(
      'char-b'
    )
    expect(selected_controlled_character_id({ active_entity_id: 'friend', current_id: 'char-a', controlled_ids })).toBe(
      'char-a'
    )
  })

  it('rejects a stale/non-owned manual pick and falls back only to an owned seat', () => {
    expect(
      selected_controlled_character_id({
        active_entity_id: 'friend',
        current_id: 'friend',
        controlled_ids: ['char-a'],
      })
    ).toBe('char-a')
    expect(selected_controlled_character_id({ controlled_ids: [] })).toBeNull()
  })

  it('uses the character id as entity identity with an address fallback only for legacy rows', () => {
    expect(participant_entity_id({ character: 'char-a', addr: ME })).toBe('char-a')
    expect(participant_entity_id({ character_id: 'char-b', addr: ME })).toBe('char-b')
    expect(participant_entity_id({ addr: ME })).toBe(ME)
  })

  it('routes a transaction only through a chain-derived controlled character', () => {
    expect(
      transaction_character_id({ my_entity_id: 'char-b', controlled_entity_ids: ['char-a', 'char-b'] }, 'leader')
    ).toBe('char-b')
    expect(transaction_character_id({ my_entity_id: 'friend', controlled_entity_ids: ['char-a'] }, 'leader')).toBe(
      'leader'
    )
  })

  it('auto-selects at a turn boundary but preserves manual selection on an unchanged poll', () => {
    const stable = {
      current_fight_id: 'fight',
      next_fight_id: 'fight',
      current_active_id: 'char-b',
      next_active_id: 'char-b',
      current_deadline_ms: 10,
      next_deadline_ms: 10,
    }
    expect(should_auto_select_active(stable)).toBe(false)
    expect(should_auto_select_active({ ...stable, next_deadline_ms: 20 })).toBe(true)
    expect(should_auto_select_active({ ...stable, next_active_id: 'char-a' })).toBe(true)
  })

  it('stores and consumes pending cast labels by acting character', () => {
    let keys = set_character_cast_key(new Map(), 'char-a', 'fire_spell')
    keys = set_character_cast_key(keys, 'char-b', 'earth_spell')

    const first = take_character_cast_key(keys, 'char-a')
    expect(first.name_key).toBe('fire_spell')
    expect(first.keys.get('char-b')).toBe('earth_spell')
    const consumed = take_character_cast_key(first.keys, 'char-a')
    expect(consumed.name_key).toBeNull()
    expect(take_character_cast_key(consumed.keys, 'char-b').name_key).toBe('earth_spell')
  })
})
