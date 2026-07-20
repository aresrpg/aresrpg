import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../../i18n/locales/en.json'

import { fight_store, fight_view } from '@aresrpg/fight'
import { seed_fight_core, reset_fight_core } from '../../../test_helpers/fight_core_harness.js'
import { DungeonSpellReadout } from './DungeonSpellReadout.jsx'
import { fight_spells_data } from './fight-spells.js'
import { SpellSeedTip } from './tooltip-content.jsx'

const EN_I18N = i18next.createInstance()
EN_I18N.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const visible_text = (html) => html.replace(/<[^>]+>/g, '')
const tooltip_t = (key) => (key === 'entity.range_to' ? 'à' : key)

// Drive the REAL fight core through its ONE input door (S2 mirror kill — the readout reads the projected
// view synchronously via use_fight_view; arm/hover flow through the same `input()` production uses).
const clear_fight = reset_fight_core

function hover_spell(spell_id) {
  clear_fight()
  seed_fight_core({ fight_id: '0xrangetest', my: '0xrangetest' })
  fight_store.getState().input({ type: 'hover_spell', spell_id })
}

function arm_spell_on_my_turn(spell_id) {
  clear_fight()
  seed_fight_core({ fight_id: '0xmobiletap', my: '0xmobiletap' })
  fight_store.getState().input({ type: 'arm', spell_id })
}

const unequal_level_one_damage = () => {
  for (const spell of fight_spells_data.spells) {
    const effect = spell.levels?.[0]?.effects?.find(
      (candidate) =>
        candidate.kind === 'DAMAGE' &&
        Number.isFinite(candidate.damageMin) &&
        Number.isFinite(candidate.damageMax) &&
        candidate.damageMin !== candidate.damageMax
    )
    if (effect) return { spell, effect }
  }
  return null
}

afterEach(clear_fight)

describe('fight-spell range surfaces', () => {
  test('SpellSeedTip renders an unequal locale range instead of life.value', () => {
    const html = renderToStaticMarkup(
      createElement(SpellSeedTip, {
        t: tooltip_t,
        name: 'Tooltip range fixture',
        life: { value: 991, damageMin: 5, damageMax: 14, kind: 'damage' },
      })
    )
    const text = visible_text(html)

    expect(text).toContain('5 à 14')
    expect(text).not.toContain('991')
  })

  test('SpellSeedTip collapses equal bounds to one number', () => {
    const html = renderToStaticMarkup(
      createElement(SpellSeedTip, {
        t: tooltip_t,
        name: 'Tooltip equal fixture',
        life: { value: 991, damageMin: 8, damageMax: 8, kind: 'damage' },
      })
    )
    const text = visible_text(html)

    expect(html).toMatch(/<dd[^>]*>8<\/dd>/)
    expect(text).not.toContain('8 à 8')
    expect(text).not.toContain('991')
  })

  test('DungeonSpellReadout renders a level-1 unequal DAMAGE range from the generated artifact', async () => {
    const witness = unequal_level_one_damage()
    expect(witness).toBeTruthy()
    // ARMED drives the card on every platform (07-17: desktop hover moved to the socket-anchored tooltip)
    arm_spell_on_my_turn(witness.spell.name_key)

    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout))
    )
    const expected = `${witness.effect.damageMin} to ${witness.effect.damageMax}`

    expect(html).toContain('sd__effect-text')
    expect(visible_text(html)).toContain(expected)
  })

  test('mobile spell tap arms for casting and opens only a compact anchored readout', async () => {
    const witness = unequal_level_one_damage()
    expect(witness).toBeTruthy()
    arm_spell_on_my_turn(witness.spell.name_key)

    const desktop_html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout, { mobile: false }))
    )
    const mobile_html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout, { mobile: true }))
    )
    const mobile_css = readFileSync(new URL('./mobile-fight-hud.css', import.meta.url), 'utf8')
    const mobile_rule =
      mobile_css.match(/\.gw-fight-layer--mobile \.fight-readout\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(fight_view()?.armed_spell_id).toBe(witness.spell.name_key)
    expect(desktop_html).toContain('class="fight-readout"')
    expect(desktop_html).not.toContain('fight-readout--mobile')
    expect(mobile_html).toContain('class="fight-readout fight-readout--mobile"')
    expect(mobile_rule).toMatch(/left:\s*auto/)
    expect(mobile_rule).toMatch(/width:\s*min\(240px,/)
  })

  test('[07-20 directive] a DESKTOP hover renders THE BIG readout ANCHORED above the slot — one tooltip for hover AND keypress', async () => {
    const witness = unequal_level_one_damage()
    expect(witness).toBeTruthy()
    hover_spell(witness.spell.name_key)

    // Design ruling 2026-07-19 (only the big tooltip) + 2026-07-20 (the hover card must be a tooltip of the
    // spell itself, not stay on the right): a desktop hover drives the SAME `.sd` big card the armed keypress
    // does — now ANCHORED above the hovered socket (fight-readout--anchored) rather than the right dock. It still
    // carries the hovered spell's chain range, proving it is the big card and not a compact chip. SSR has no
    // document to portal to, so it renders in place with the anchored class (useLayoutEffect never runs here).
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout, { mobile: false }))
    )
    const expected = `${witness.effect.damageMin} to ${witness.effect.damageMax}`

    expect(html).toContain('fight-readout--anchored') // desktop hover anchors to its slot
    expect(html).toContain('sd__head-name') // the big card's header — never the compact hover chip
    expect(visible_text(html)).toContain(expected)
  })

  test('[07-17 directive] a MOBILE hover (the tap flash) still presents the compact card, hint-free', async () => {
    const witness = unequal_level_one_damage()
    expect(witness).toBeTruthy()
    hover_spell(witness.spell.name_key)

    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout, { mobile: true }))
    )

    expect(html).toContain('fight-readout--mobile') // the pre-directive mobile presenter, unregressed…
    expect(html).toContain('sd__head-name')
    expect(html).not.toContain('fight-readout__hint') // …and never an aiming hint on a mere hover
  })

  test('[msg 3254] the ARMED spell on my turn keeps the aiming hint', async () => {
    const witness = unequal_level_one_damage()
    expect(witness).toBeTruthy()
    arm_spell_on_my_turn(witness.spell.name_key)

    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout))
    )

    expect(html).toContain('fight-readout__hint')
  })

  test('[07-19 directive] hover-outranks-armed on BOTH platforms — the one big card previews the hovered spell', async () => {
    // two seeded spells whose name_keys are not substrings of each other (the img-src containment assertions
    // below must never false-fail on an 'ember' ⊂ 'ember_strike' style pair)
    const a = fight_spells_data.spells[0]
    const b = fight_spells_data.spells.find(
      (s) => s.name_key !== a.name_key && !s.name_key.includes(a.name_key) && !a.name_key.includes(s.name_key)
    )
    expect(a?.name_key && b?.name_key).toBeTruthy()
    clear_fight()
    seed_fight_core({ fight_id: '0xhovertest', my: '0xhovertest' })
    fight_store.getState().input({ type: 'arm', spell_id: a.name_key })
    fight_store.getState().input({ type: 'hover_spell', spell_id: b.name_key })

    // MOBILE: the tap's transient hover wins (unchanged) — B's card, no hint.
    const mobile_html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout, { mobile: true }))
    )
    expect(mobile_html).toContain(b.name_key)
    expect(mobile_html).not.toContain(a.name_key)
    expect(mobile_html).not.toContain('fight-readout__hint')

    // DESKTOP (07-19): the ONE big card now previews the HOVERED spell too (B), not the armed A — RED at HEAD
    // (desktop ignored the hover, showed A). The aiming hint drops while previewing a non-armed spell (no lie).
    const desktop_html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DungeonSpellReadout, { mobile: false }))
    )
    expect(desktop_html).toContain(b.name_key)
    expect(desktop_html).not.toContain(a.name_key)
    expect(desktop_html).not.toContain('fight-readout__hint')
  })

  test('Spellbook keeps its effect rows wired directly to seed_effect_parts', () => {
    const source = readFileSync(new URL('./Spellbook.jsx', import.meta.url), 'utf8')

    expect(source).toContain("import { seed_effect_parts, seed_el_label } from './seed-effect-line.js'")
    expect(source).toContain('view={seed_effect_parts(t, fx)}')
  })
})
