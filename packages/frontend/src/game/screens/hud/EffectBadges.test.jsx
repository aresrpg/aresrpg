// RED-FIRST (EFFECT-BADGES lane): a cast effect (e.g. a shield spell) must be visible on the fighter's
// nametag — every persistent effect renders there with its remaining turn count, compact but intuitive.
// RED at HEAD: EffectBadges.jsx does not exist yet.
//
// engine_view.fighters[].effects is a BLOCKED-COORDINATE getter (packages/fight/src/project.js only ever
// projected a boolean `invisible`, never a generic per-fighter effect+duration list — see the lane return for
// the exact proposed shape) — so this component is built + proven against a FIXTURE of the shape it needs; the
// wiring is a one-line prop-pass the moment the getter merges (see FightTimeline.jsx `f.effects`).

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../../i18n/locales/en.json'
import { EffectBadges, effect_badge_view } from './EffectBadges.jsx'

const i18n = i18next.createInstance()
i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = (key, params) => i18n.t(key, params)

const render = (effects) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <EffectBadges effects={effects} />
    </I18nextProvider>
  )

// fixture rows shaped exactly like the proposed engine_view getter: the raw chain FighterStatus + its nested
// Effect fields (spell_board.move FighterStatus{fighter,kind,effect,remaining_turns,source} flattened) — kind
// is the numeric spell_effect.move id (27 = INVISIBILITY, 9 = ALTER_STAT), never pre-decoded to a string.
const invisibility_2t = { id: 'st-1', kind: 27, remaining_turns: 2 }
const vitality_ward_3t = { id: 'st-2', kind: 9, stat: 5, value: 10, remaining_turns: 3 }

describe('EffectBadges — compact persistent-effect chips on the fight nameplate', () => {
  test('a fighter with 2 active effects (invisibility 2t, +vitality 3t) renders exactly 2 chips with the right counts', () => {
    const html = render([invisibility_2t, vitality_ward_3t])
    const chips = [...html.matchAll(/class="hud-effect"/g)]
    expect(chips.length).toBe(2)
    expect(html).toContain('hud-effect__turns')
    expect(html).toMatch(/hud-effect__turns[^>]*>2</) // invisibility remaining turns
    expect(html).toMatch(/hud-effect__turns[^>]*>3</) // ward remaining turns
  })

  test('0 active effects renders NOTHING — no empty container element', () => {
    expect(render([])).toBe('')
  })

  test('a missing effects prop (the getter not merged yet at HEAD) also renders nothing, never crashes', () => {
    expect(render(undefined)).toBe('')
  })

  test('an expired row (remaining_turns 0) is filtered out — never a stale badge', () => {
    expect(render([{ id: 'gone', kind: 27, remaining_turns: 0 }])).toBe('')
  })

  test('more than the visible cap collapses to "+N" overflow, never an unbounded row', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 27, remaining_turns: i + 1 }))
    const html = render(many)
    const chips = [...html.matchAll(/class="hud-effect"/g)]
    expect(chips.length).toBe(4) // MAX_VISIBLE cap
    expect(html).toContain('+2')
  })

  test('effect_badge_view reuses the EXISTING spells.fx_invisibility house grammar — no invented copy', () => {
    const view = effect_badge_view(t, invisibility_2t)
    expect(view.turns).toBe(2)
    expect(view.label).toBe(t('spells.fx_invisibility') + ' · ' + t('spells.fx_turns', { count: 2 }))
  })

  test('effect_badge_view derives a compact mono glyph per kind — no invented art, just text', () => {
    expect(effect_badge_view(t, invisibility_2t).glyph).toBe('INV')
    expect(effect_badge_view(t, vitality_ward_3t).glyph).toBe('ALT')
  })
})
