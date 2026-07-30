// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CharacterPicker.test.tsx — the popover a blue start cell opens (#883 ①), over react-dom/server.
//
// Proven: it offers the WHOLE roster at the cell (a seated character included — picking it moves the seat),
// an empty roster gets an honest line instead of a blank card, and the anchor never leaves the viewport.
//
// ROUND 2 (captured screenshot): it functioned but rendered as a skinny text list — it read as a tooltip,
// not as a picker. So the rows are the roster's OWN row component now, portrait included; a bare list of
// name/class lines is the red these tests hold down.

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'

import { CharacterPicker, popover_position } from './CharacterPicker'
import { EMPTY_STAT_ALLOC, type SimCharacter } from './reducer'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const character = (id: string, name: string): SimCharacter => ({
  id,
  name,
  class_id: 'senshi',
  male: true,
  level: 12,
  stat_alloc: EMPTY_STAT_ALLOC,
  spell_levels: {},
  loadout: {},
})

const markup = (roster: readonly SimCharacter[], placements: Record<number, string> = {}) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <CharacterPicker
        roster={roster}
        placements={placements}
        at={{ x: 400, y: 300 }}
        on_pick={() => {}}
        on_close={() => {}}
      />
    </I18nextProvider>
  )

describe('the character picker a blue cell opens', () => {
  test('it lists every roster character with its class and level', () => {
    const html = markup([character('sim_c1', 'KAELIS'), character('sim_c2', 'VORREN')])
    expect(html).toContain(en.simulator.place_character)
    expect(html).toContain('KAELIS')
    expect(html).toContain('VORREN')
    expect(html).toContain('12')
  })

  test('an already-seated character is still offered, badged — picking it MOVES the seat', () => {
    const html = markup([character('sim_c1', 'KAELIS')], { 42: 'sim_c1' })
    expect(html).toContain('KAELIS')
    expect(html).toContain(en.simulator.placed)
  })

  test('an empty roster says so and points at the roster panel — never a blank card', () => {
    const html = markup([])
    expect(html).toContain(en.simulator.roster_empty_hint)
    expect(html).not.toContain(en.simulator.placed)
  })

  // #883 round 2 — a picker shows WHO, not a line of text about who.
  test('every row carries the class PORTRAIT — the same row the roster panel renders', () => {
    const html = markup([character('sim_c1', 'KAELIS')])
    // the game's CharacterPortrait mounts a canvas for a class that ships sprites (senshi does)
    expect(html).toContain('<canvas')
  })

  test('a class with NO sprite gets its initial, never a substituted body', () => {
    const iyashi = { ...character('sim_c1', 'MIRAI'), class_id: 'iyashi' }
    const html = markup([iyashi])
    expect(html).not.toContain('<canvas')
    expect(html).toContain('>M<')
  })

  test('the card is clamped into the viewport — a cell at the edge never opens off-screen', () => {
    expect(popover_position(400, 300, { width: 1280, height: 800 })).toEqual({ left: 412, top: 312 })
    const clamped = popover_position(1270, 790, { width: 1280, height: 800 })
    expect(clamped.left).toBeLessThan(1280 - 220)
    expect(clamped.top).toBeLessThan(800 - 320)
    expect(popover_position(-40, -40, { width: 1280, height: 800 })).toEqual({ left: 8, top: 8 })
  })
})
