// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #861 RED-FIRST — the silent engage door.
//
// Reported shape: the armed [R] ENGAGE pill "composed zero transactions — no toast, no error, no fight" while
// the pill stayed armed. The driven pointer story is formally exonerated (a raw mouse click DOES reach the
// pill and fires its trigger — see the PR's driven leg), which leaves exactly one mechanism that produces that
// observable: engage()'s preconditions used to be three BARE `return`s that neither told the player anything
// nor reached the pill's presentation, so the pill armed gold over a press that could never fire.
//
// Two legs, both red before the fix:
//   1. BEHAVIOUR (this file) — the gate is a real, pure home both sides read, with copy for the player-relevant
//      refusals and deliberate silence only for the internal re-entry latch.
//   2. SOURCE SHAPE (world_spawns.test.js) — engage() and set_attack_target are un-exported closures, so the
//      file's own established convention locks their wiring by shape: both must read THIS gate, and no bare
//      `return` may survive on the refusal paths.

import { describe, expect, test } from 'bun:test'

import en from '../i18n/locales/en.json'
import de from '../i18n/locales/de.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import ja from '../i18n/locales/ja.json'
import uk from '../i18n/locales/uk.json'

import { engage_block, engage_block_copy_key } from './engage_gate.js'

const at = (bundle, key) => key.split('.').reduce((node, part) => node?.[part], bundle)

describe('engage gate (#861) — one home for the [R] pill and engage()', () => {
  test('a clear state refuses nothing', () => {
    expect(engage_block({ engaging: false, fight_session_id: null, character_id: '0xchar' })).toBeNull()
    expect(engage_block_copy_key(null)).toBeNull()
  })

  test('THE REPORTED SHAPE: a live fight session in the dungeon store blocks the press — and says so', () => {
    // The exact state the reporting drive was in: fight-gate rounds had already run, so the dungeon store
    // still held a fight session. engage() returned at that door without a tx, a toast, or a log line, and
    // the pill — which never consulted this fact — stayed armed for another 71 m of terrain.
    expect(engage_block({ fight_session_id: '0xfight', character_id: '0xchar' })).toBe('fight_session')
    // …and it is a PLAYER-relevant refusal, so it carries copy the pill can render and the press can toast.
    expect(engage_block_copy_key('fight_session')).toBe('errors.fight_character_busy')
  })

  test('a run pass with no fight id blocks identically — the caller folds both store ids into one input', () => {
    expect(engage_block({ fight_session_id: '0xrunpass', character_id: '0xchar' })).toBe('fight_session')
  })

  test('a missing character blocks the press and says so', () => {
    expect(engage_block({ fight_session_id: null, character_id: null })).toBe('no_character')
    expect(engage_block_copy_key('no_character')).toBe('errors.engage_no_character')
  })

  test('the in-flight latch blocks FIRST and stays deliberately silent (internal, not a player refusal)', () => {
    // A claim from this renderer is already running: the pill is already cleared by the frame loop, so there is
    // nothing to tell the player. It must still be a NAMED block (a log line), never a bare return.
    expect(engage_block({ engaging: true, fight_session_id: '0xfight', character_id: '0xchar' })).toBe('engaging')
    expect(engage_block_copy_key('engaging')).toBeNull()
  })

  test('an empty call is a block, never an accidental green light', () => {
    expect(engage_block()).toBe('no_character')
  })

  test('every refusal copy key resolves in all six locales (i18n law)', () => {
    const keys = ['fight_session', 'no_character'].map(engage_block_copy_key)
    for (const key of keys) {
      expect(key, 'a player-relevant block must carry copy').toBeTruthy()
      for (const [name, bundle] of Object.entries({ en, de, es, fr, ja, uk })) {
        const copy = at(bundle, key)
        expect(typeof copy, `${key} missing from ${name}.json`).toBe('string')
        expect(copy.length, `${key} is empty in ${name}.json`).toBeGreaterThan(0)
      }
    }
  })
})
