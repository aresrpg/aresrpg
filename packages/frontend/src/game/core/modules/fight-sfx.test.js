// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test'

import * as sfx from '../audio/sfx.js'

// Headless verdict tests for the fight voices the presented voxel beat pipeline calls. The module owns no event
// subscription: casts, damage and death all sound at their rendered edge in voxel_fight_adapter.

// bun's mock.module persists for the WHOLE test process (no un-mock API): every test file loaded after this
// one that touches sfx.js (directly or transitively) resolves it to THIS object. The mock must therefore mirror
// sfx.js's FULL export surface — a missing export is a hard module-load error in whichever file imports it next
// (proven: this mock exporting play_element_sfx ALONE made the full-suite count flicker 513/0 ↔ 505/2 depending
// on file-enumeration order, bisected 2026-07-10). Keep this object's keys in lockstep with sfx.js's exports.
const play_one = spyOn(sfx, 'play_sfx').mockImplementation(() => {})

const { death_sfx_key, hurt_sfx_key, play_hurt_sfx } = await import('./fight-sfx.js')

afterEach(() => {
  play_one.mockClear()
})

afterAll(() => {
  play_one.mockRestore()
})

describe('fight-sfx — player death sting follows the presented death edge', () => {
  it('voices my player death and leaves peers and mobs to their own impact vocabulary', () => {
    expect(death_sfx_key({ is_player: true }, 'p0', 'p0')).toBe('player_death')
    expect(death_sfx_key({ is_player: true }, 'p1', 'p0')).toBeNull()
    expect(death_sfx_key({ is_player: false }, 'mob-0', 'p0')).toBeNull()
    expect(death_sfx_key(null, 'p0', 'p0')).toBeNull()
  })
})

describe('fight-sfx — gendered hurt cry (a character struck by a mob voices its own hurt sound)', () => {
  const hit = (source_id = 'mob-0', target_id = '0xme', damage = 12) => ({ source_id, target_id, damage })
  const woman = { is_player: true, male: false }
  const man = { is_player: true, male: true }
  const mob = { is_player: false }

  it('a mob hit on a FEMALE character asks for the female cry', () => {
    expect(hurt_sfx_key(hit(), woman)).toBe('fight_hurt_female')
  })

  it('a mob hit on a MALE character asks for the male cry', () => {
    expect(hurt_sfx_key(hit(), man)).toBe('fight_hurt_male')
  })

  it('a MOB victim never cries — the hurt voices belong to characters only', () => {
    expect(hurt_sfx_key(hit('mob-0', 'mob-1'), mob)).toBeNull()
  })

  it('a PLAYER-sourced hit is silent — these are the "hit by a mob" voices', () => {
    expect(hurt_sfx_key(hit('0xpeer'), woman)).toBeNull()
  })

  it('a zero-damage (absorbed) or heal beat is silent — no blow landed', () => {
    expect(hurt_sfx_key(hit('mob-0', '0xme', 0), man)).toBeNull()
    expect(hurt_sfx_key({ source_id: 'mob-0', target_id: '0xme', heal: 9 }, man)).toBeNull()
  })

  it('an unresolved gender stays silent rather than guessing one', () => {
    expect(hurt_sfx_key(hit(), { is_player: true })).toBeNull()
    expect(hurt_sfx_key(hit(), null)).toBeNull()
  })

  it('play_hurt_sfx voices exactly the resolved key, and nothing when there is none', () => {
    play_hurt_sfx(hit(), man)
    expect(play_one).toHaveBeenCalledWith('fight_hurt_male')
    play_one.mockClear()
    play_hurt_sfx(hit('mob-0', 'mob-1'), mob)
    expect(play_one).not.toHaveBeenCalled()
  })
})
