// COMBAT-LOG COLOUR GRAMMAR — i18n RUNTIME proof for the world_chat.log_* templates.
// scripts/i18n_coverage.mjs only checks that a key RESOLVES in all 6 locales; this pins the actual
// INTERPOLATED OUTPUT, because fight.js's segment_template (co-located with emit_cast_log) depends on the
// substituted {{caster}}/{{target}}/{{spell}}/{{amount}} VALUES appearing verbatim inside the resolved string
// to slice it into coloured spans — a locale whose template swallowed or mangled a placeholder would silently
// lose that token's colour (never crash, just render unstyled), so this is the guard that would catch it.
// Standalone i18next instances (no browser LanguageDetector), same recipe as reveal_strings.test.js.
import { test, expect } from 'bun:test'
import { createInstance } from 'i18next'

import en from './locales/en.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import es from './locales/es.json'
import ja from './locales/ja.json'
import uk from './locales/uk.json'

const LOCALES = { en, fr, de, es, ja, uk }
const inst = (lng) => {
  const i = createInstance()
  i.init({
    lng,
    fallbackLng: 'en',
    resources: { [lng]: { translation: LOCALES[lng] } },
    interpolation: { escapeValue: false },
  })
  return i
}

const SAMPLE = { caster: 'Aldric', target: 'Sewer Rat', spell: 'Fireball', amount: '9' }

test.each(Object.keys(LOCALES))(
  '%s: every world_chat.log_* template resolves AND every substituted value survives verbatim',
  (lng) => {
    const i = inst(lng)
    const cast = i.t('world_chat.log_cast', SAMPLE)
    expect(cast).toContain(SAMPLE.caster)
    expect(cast).toContain(SAMPLE.spell)

    for (const key of [
      'world_chat.log_hit',
      'world_chat.log_heal',
      'world_chat.log_ap_drain',
      'world_chat.log_mp_drain',
    ]) {
      const resolved = i.t(key, SAMPLE)
      expect(resolved).toContain(SAMPLE.caster)
      expect(resolved).toContain(SAMPLE.target)
      expect(resolved).toContain(SAMPLE.amount)
    }

    const absorb = i.t('world_chat.log_absorb', SAMPLE)
    expect(absorb).toContain(SAMPLE.caster)
    expect(absorb).toContain(SAMPLE.target)

    const death = i.t('world_chat.log_death', SAMPLE)
    expect(death).toContain(SAMPLE.target)

    // log_trap (2026-07-13): a placed trap detonating on a mob — target + amount, NO caster (it is placement).
    const trap = i.t('world_chat.log_trap', SAMPLE)
    expect(trap).toContain(SAMPLE.target)
    expect(trap).toContain(SAMPLE.amount)

    // standalone, non-interpolated strings — just prove they resolve to real copy, never the raw key back.
    expect(i.t('world_chat.log_crit_prefix')).not.toBe('world_chat.log_crit_prefix')
    expect(i.t('world_chat.log_crit_prefix').length).toBeGreaterThan(0)
    expect(i.t('world_chat.log_unknown_fighter')).not.toBe('world_chat.log_unknown_fighter')
    expect(i.t('world_chat.log_unknown_fighter').length).toBeGreaterThan(0)
  }
)

test('en: exact copy pin (catches accidental rewording of the "cast" golden-path harness needle)', () => {
  const i = inst('en')
  expect(i.t('world_chat.log_cast', SAMPLE)).toBe('Aldric cast Fireball')
  expect(i.t('world_chat.log_hit', SAMPLE)).toBe('Aldric hit Sewer Rat for 9')
  expect(i.t('world_chat.log_heal', { ...SAMPLE, amount: '+9' })).toBe('Aldric healed Sewer Rat for +9')
  expect(i.t('world_chat.log_death', SAMPLE)).toBe('Sewer Rat died')
})

test(
  'self-referencing values (self-heal: caster === target text) still leave BOTH occurrences findable in the\n' +
    "resolved string — the property segment_template's cursor-walk relies on (it never inspects the template\n" +
    'source, only the resolved text, so this must hold in every locale, not just en)',
  () => {
    for (const lng of Object.keys(LOCALES)) {
      const i = inst(lng)
      const resolved = i.t('world_chat.log_heal', { caster: 'Aldric', target: 'Aldric', amount: '+9' })
      const first = resolved.indexOf('Aldric')
      const second = resolved.indexOf('Aldric', first + 1)
      expect(first).toBeGreaterThanOrEqual(0)
      expect(second).toBeGreaterThan(first) // a SECOND, later occurrence exists for the target token to claim
    }
  }
)
