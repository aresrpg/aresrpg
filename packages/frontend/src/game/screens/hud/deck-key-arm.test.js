// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// resolve_key_arm unit tests — the keyboard-arm decision is a PURE function (no dispatch, no DOM), extracted
// from DeckCluster's keydown effect so this exact contract is unit-testable: a key press must arm the SAME
// spell_id a click on the matching socket would (WeaponSocket.onPick / SpellSocket.onPick gate identically).
// Regression this guards (coordinator P1, 07-10): the backtick/weapon key path used to skip the
// `weapon_affordable` check the click path already enforced — an unaffordable weapon strike could be armed
// via keyboard but not by click. `resolve_key_arm` now gates both the same way.

import { describe, it, expect } from 'bun:test'

import { resolve_key_arm, deck_my_turn, is_arm_key } from './deck-key-arm.js'
import { WEAPON_ATTACK_ID } from '../../core/modules/fight.js'
import { SPELLS_SEED_AVAILABLE } from '../../../test_helpers/spells_fixture.js'

// real seeded senshi spells (fight-spells.json kit corpus, unlock_level ≤ 10): warcleave (ap 4), oathblade, war_bellow.
const HAND = ['warcleave', 'oathblade', 'war_bellow']

const key = (k, code = '') => /** @type {KeyboardEvent} */ ({ key: k, code })

describe('resolve_key_arm — weapon (backtick/§/0)', () => {
  it('arms the weapon on backtick when it is my turn and the weapon is affordable', () => {
    expect(resolve_key_arm(key('`'), { my_turn: true, weapon_affordable: true, hand: HAND, ap: 6 })).toBe(
      WEAPON_ATTACK_ID,
    )
  })

  it('§ (AZERTY glyph) and Backquote (e.code, any layout) and the "0" alias all arm the weapon too', () => {
    const state = { my_turn: true, weapon_affordable: true, hand: HAND, ap: 6 }
    expect(resolve_key_arm(key('§'), state)).toBe(WEAPON_ATTACK_ID)
    expect(resolve_key_arm(key('Dead', 'Backquote'), state)).toBe(WEAPON_ATTACK_ID)
    expect(resolve_key_arm(key('0'), state)).toBe(WEAPON_ATTACK_ID)
  })

  it('AP-insufficient (weapon unaffordable) → backtick does nothing (parity with the click gate)', () => {
    expect(resolve_key_arm(key('`'), { my_turn: true, weapon_affordable: false, hand: HAND, ap: 0 })).toBeNull()
  })

  it('off-turn → backtick does nothing even if the weapon would otherwise be affordable', () => {
    expect(resolve_key_arm(key('`'), { my_turn: false, weapon_affordable: true, hand: HAND, ap: 6 })).toBeNull()
  })
})

describe('resolve_key_arm — hand cards (1-9)', () => {
  it('arms the matching hand card when affordable on my turn', () => {
    expect(resolve_key_arm(key('1'), { my_turn: true, weapon_affordable: true, hand: HAND, ap: 6 })).toBe(
      'warcleave',
    )
    expect(resolve_key_arm(key('2'), { my_turn: true, weapon_affordable: true, hand: HAND, ap: 6 })).toBe(
      'oathblade',
    )
  })

  // MISSING-ARTIFACT (#117): warcleave's real AP cost resolves through fight-spells.js's runtime spell
  // corpus, empty in this environment — see test_helpers/spells_fixture.js.
  it.skipIf(!SPELLS_SEED_AVAILABLE)('AP-insufficient for that card → does nothing (warcleave costs 4 ap)', () => {
    expect(resolve_key_arm(key('1'), { my_turn: true, weapon_affordable: true, hand: HAND, ap: 1 })).toBeNull()
  })

  it('an empty slot (index beyond hand.length) does nothing, never throws', () => {
    expect(resolve_key_arm(key('9'), { my_turn: true, weapon_affordable: true, hand: HAND, ap: 99 })).toBeNull()
  })

  it('off-turn → number keys do nothing', () => {
    expect(resolve_key_arm(key('1'), { my_turn: false, weapon_affordable: true, hand: HAND, ap: 6 })).toBeNull()
  })

  it('a non-arm key (e.g. a letter) does nothing', () => {
    expect(resolve_key_arm(key('a'), { my_turn: true, weapon_affordable: true, hand: HAND, ap: 6 })).toBeNull()
  })
})

describe('deck_my_turn — the arm gate IGNORES a stale placement flag (FINDING B: chain-ACTIVE flip race)', () => {
  const ME = '0xme'
  it('my active turn with a STALE placement=true still reads TRUE — the silent turn-start arm no-op regression', () => {
    // the exact divergence window this gate is hardened against: the chain flipped ACTIVE and sync set
    // active_entity_id=me. The `placement` flag now folds in the SAME sync (B6 fix), but this gate stays
    // placement-INDEPENDENT as defence in depth — the OLD gate ANDed `!fight.placement`, forcing my_turn FALSE
    // on any stale-placement frame → the turn-start arm keypress silently no-opped. It must be TRUE.
    expect(deck_my_turn({ my_entity_id: ME, active_entity_id: ME, winner: -1, placement: true })).toBe(true)
  })
  it("another seat's active turn → false (not my turn)", () => {
    expect(deck_my_turn({ my_entity_id: ME, active_entity_id: '0xother', winner: -1, placement: false })).toBe(false)
  })
  it('a resolved fight (winner set) → false — no arming after the fight ends', () => {
    expect(deck_my_turn({ my_entity_id: ME, active_entity_id: ME, winner: 0, placement: false })).toBe(false)
  })
  it('no fight slice → false, never throws', () => {
    expect(deck_my_turn(null)).toBe(false)
  })
  it('PLACEMENT shape (active_entity_id null — no turn resolved yet) → false, regardless of the placement flag: ' +
    'the real pre-fight state on BOTH the dungeon chain read (fight_bridge.active_entity_id returns null pre-ACTIVE) ' +
    'and the WS spawn (active_entity_id: null) — this is why DeckCluster can stay MOUNTED through placement ' +
    '(show the full kit, disabled) without a separate phase gate: my_turn already holds false',
    () => {
      expect(deck_my_turn({ my_entity_id: ME, active_entity_id: null, winner: -1, placement: true })).toBe(false)
      expect(deck_my_turn({ my_entity_id: ME, active_entity_id: null, winner: -1, placement: undefined })).toBe(false)
    })
})

describe('is_arm_key — the union of arm-intent keys (drives the no-silent-failure telemetry)', () => {
  it('weapon keys (backtick / § / Backquote / 0) and 1-9 are arm keys', () => {
    for (const k of ['`', '§', '0', '1', '5', '9']) expect(is_arm_key(key(k))).toBe(true)
    expect(is_arm_key(key('Dead', 'Backquote'))).toBe(true)
  })
  it('an unrelated key (a letter, a nav key) is NOT an arm key — no telemetry noise on those', () => {
    for (const k of ['a', 'w', 'Escape', 'ArrowUp', 'Shift']) expect(is_arm_key(key(k))).toBe(false)
  })
})
