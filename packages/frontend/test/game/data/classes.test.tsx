// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2182 — THE TWELVE, DRIVEN. game/data/classes.js used to carry a FOUR-row roster of its own, so the other
// eight classes resolved `undefined` on every surface that asked and the player read a lowercase `ikari`
// where the UI owed him "Berserker". The fix is the deletion: the roster is @aresrpg/sdk classes.json and
// the labels are the i18n `simulator.classes.<ID>` maps, so this file only derives.
//
// This test COUNTS, it never samples: every case iterates the FULL sdk enumeration and asserts the population
// is twelve, so a class that stops resolving cannot hide behind a passing sibling. Both DoD surfaces are
// RENDERED (renderToStaticMarkup, real i18n resources), not merely queried:
//
//   · the sidebar switcher row  — the class glyph + its aria-label must be that class' own identity
//   · the simulator roster row  — the class line must be that class' own localized display name
//
// The sprite half stays honest: only some classes ship the 2D directional art, so `class_sprite_base` is
// pinned against the DIRECTORY ON DISK (positive control included) rather than against itself — art that
// lands without its row, or a row without art, goes red here.

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import sdk_classes from '../../../../sdk/src/classes.json'
import { CharacterRow as SwitcherRow } from '../../../src/components/CharacterSwitcherRow'
import { CharacterRow as SimulatorRow } from '../../../src/simulator/CharacterRow'
import {
  PLACEHOLDER_SPRITES,
  class_display,
  class_sprite_base,
  class_title,
  get_class,
} from '../../../src/game/data/classes.js'
import en from '../../../src/i18n/locales/en.json'
import fr from '../../../src/i18n/locales/fr.json'

const CLASS_IDS = Object.keys(sdk_classes)

const instance = (lng: 'en' | 'fr') => {
  const i18n = i18next.createInstance()
  void i18n.init({
    lng,
    resources: { en: { translation: en }, fr: { translation: fr } },
    interpolation: { escapeValue: false },
  })
  return i18n
}

const en_i18n = instance('en')
const fr_i18n = instance('fr')

const render = (node: React.ReactNode, i18n = en_i18n) =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)

const character = (class_id: string) => ({
  id: `c_${class_id}`,
  name: `Hero_${class_id}`,
  class_id,
  classe: class_id,
  male: true,
  level: 7,
  experience: 0,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  stat_alloc: {},
  spell_levels: {},
  loadout: {},
})

describe('#2182 — the class roster is derived, so all twelve resolve', () => {
  test('the enumeration is the SDK roster, twelve strong (the count, not a sample)', () => {
    expect(CLASS_IDS).toHaveLength(12)
    // positive control: the census reads a real enumeration, not an empty object that would pass every loop
    expect(CLASS_IDS).toContain('iyashi')
  })

  test('every class resolves an identity — zero undefined rows', () => {
    const resolved = CLASS_IDS.filter((id) => get_class(id) !== null)
    expect(resolved).toEqual(CLASS_IDS)
    for (const id of CLASS_IDS) {
      const cls = get_class(id)
      expect(cls?.id, id).toBe(id)
      expect(cls?.name, id).toBe((sdk_classes as Record<string, { name: string }>)[id]!.name)
      expect(cls?.title, id).toBe((sdk_classes as Record<string, { title: string }>)[id]!.title)
    }
    // the chain hands the field back as it was stored — an unknown id is null, never a silent Senshi
    expect(get_class('SENSHI')?.id).toBe('senshi')
    expect(get_class('not_a_class')).toBeNull()
    expect(get_class(null)).toBeNull()
  })

  test('every class carries a localized label in both a Latin and a translated locale', () => {
    const en_titles = CLASS_IDS.map((id) => class_title(en_i18n.t, id))
    const fr_titles = CLASS_IDS.map((id) => class_title(fr_i18n.t, id))
    expect(en_titles.filter(Boolean)).toHaveLength(12)
    expect(fr_titles.filter(Boolean)).toHaveLength(12)
    // no label may leak the raw chain id, and none may fall through to another class' key
    for (const [i, id] of CLASS_IDS.entries()) {
      expect(en_titles[i], id).not.toBe(id)
      expect(en_titles[i], id).not.toContain('simulator.classes')
      expect(fr_titles[i], id).not.toContain('simulator.classes')
      expect(class_display(en_i18n.t, id), id).toBe((sdk_classes as Record<string, { name: string }>)[id]!.name)
    }
    // the locales genuinely translate the title (the fr file is loaded, not silently falling back to en)
    expect(class_title(fr_i18n.t, 'senshi')).toBe('Guerrier')
    expect(class_title(en_i18n.t, 'senshi')).toBe('Warrior')
  })

  test('sprite bases are pinned to the art ON DISK — never invented per class', () => {
    const sprites_dir = path.resolve(import.meta.dir, '../../../public/sprites')
    const on_disk = new Set(
      readdirSync(sprites_dir).filter((entry) => statSync(path.join(sprites_dir, entry)).isDirectory())
    )
    expect(on_disk.size, 'positive control: public/sprites must not be empty').toBeGreaterThan(0)

    const sprited = CLASS_IDS.filter((id) => class_sprite_base(id) !== null)
    expect(new Set(sprited)).toEqual(new Set(CLASS_IDS.filter((id) => on_disk.has(id))))
    for (const id of sprited) expect(class_sprite_base(id), id).toBe(`/sprites/${id}`)
    // an unsprited class substitutes NOTHING of its own — the caller opts into the placeholder explicitly
    for (const id of CLASS_IDS.filter((id) => !on_disk.has(id))) expect(class_sprite_base(id), id).toBeNull()
    expect(on_disk.has(PLACEHOLDER_SPRITES.split('/').pop()!)).toBe(true)
  })
})

describe('#2182 — both render surfaces seat all twelve', () => {
  test('the sidebar switcher row renders every class identity, none undefined', () => {
    const rendered = CLASS_IDS.map((id) => ({
      id,
      html: render(
        <SwitcherRow
          character={character(id)}
          active={false}
          switching={false}
          dot={false}
          exploring={false}
          on_click={() => {}}
        />
      ),
    }))
    expect(rendered).toHaveLength(12)
    for (const { id, html } of rendered) {
      const label = class_display(en_i18n.t, id)!
      expect(html, id).toContain(`aria-label="${label}"`)
      expect(html, id).toContain(`>${label.charAt(0).toUpperCase()}<`)
      expect(html, id).toContain(`Hero_${id}`)
      expect(html, id).not.toContain('undefined')
      // the raw lowercase chain id must never be what the player reads
      expect(html, id).not.toContain(`aria-label="${id}"`)
    }
  })

  test('the simulator roster row renders every class identity, localized, none undefined', () => {
    for (const lng of [en_i18n, fr_i18n]) {
      const rendered = CLASS_IDS.map((id) => ({
        id,
        html: render(<SimulatorRow character={character(id) as never} t={lng.t} />, lng),
      }))
      expect(rendered).toHaveLength(12)
      for (const { id, html } of rendered) {
        expect(html, id).toContain(class_display(lng.t, id)!)
        expect(html, id).not.toContain('undefined')
        expect(html, id).not.toContain('simulator.classes')
      }
    }
  })

  test('an unsprited class gets its INITIAL cell, never a substituted body (the page seats all twelve)', () => {
    // CharacterPortrait paints the sprite sheet into a <canvas>, so the canvas IS the "a body renders here"
    // signal in static markup and its absence is the honest "no art yet" cell.
    const unsprited = CLASS_IDS.filter((id) => class_sprite_base(id) === null)
    const sprited = CLASS_IDS.filter((id) => class_sprite_base(id) !== null)
    expect(unsprited.length, 'positive control: some classes still ship no 2D art').toBeGreaterThan(0)
    expect(sprited.length, 'positive control: some classes DO ship 2D art').toBeGreaterThan(0)
    expect(unsprited.length + sprited.length).toBe(12)

    for (const id of unsprited) {
      const html = render(<SimulatorRow character={character(id) as never} t={en_i18n.t} />)
      expect(html, id).not.toContain('<canvas')
      expect(html, id).toContain('>H<') // the character name's initial stands in — never another class' body
    }
    for (const id of sprited) {
      const html = render(<SimulatorRow character={character(id) as never} t={en_i18n.t} />)
      expect(html, id).toContain('<canvas')
    }
  })
})
