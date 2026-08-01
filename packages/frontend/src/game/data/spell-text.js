// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure client half of the published spell-text contract. Spell prose and state copy remain corpus content:
// repo locale files own only surrounding UI/template grammar.

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** Reduce a browser locale (`fr-FR`, `JA`, …) to the corpus' locale key. Unknown locales use EN. */
export const spell_text_locale = (locale) => {
  const key = String(locale ?? 'en')
    .toLowerCase()
    .split(/[-_]/u)[0]
  return ['fr', 'de', 'es', 'ja', 'uk'].includes(key) ? key : 'en'
}

const state_key = (reference) => {
  if (typeof reference === 'number' && Number.isFinite(reference)) return String(reference)
  if (typeof reference !== 'string') return null
  const key = reference.trim()
  return key && /^\d+$/u.test(key) ? String(Number(key)) : null
}

/**
 * Union every per-applier `row.states` registry fragment, first occurrence winning. Published duplicate rows
 * are byte-identical; first-wins makes the pure degrade deterministic even if a malformed future corpus is not.
 * @param {unknown} spell_corpus
 * @returns {Map<string, Record<string, any>>}
 */
export const build_spell_state_registry = (spell_corpus) => {
  const rows = Array.isArray(spell_corpus) ? spell_corpus : []
  return rows
    .flatMap((row) => (Array.isArray(row?.states) ? row.states : []))
    .reduce((registry, state) => {
      const key = state_key(state?.id)
      return key && !registry.has(key) ? new Map([...registry, [key, state]]) : registry
    }, new Map())
}

/** Resolve a numeric wire reference to its deduped canonical corpus row, never to the reference itself. */
export const resolve_spell_state_row = (registry, reference) => {
  const key = state_key(reference)
  return key && registry instanceof Map ? registry.get(key) ?? null : null
}

/** Localize a resolved state row. Each field falls back independently to its EN canonical corpus field. */
export const localize_spell_state = (state, locale = 'en') => {
  if (!state) return null
  const lang = spell_text_locale(locale)
  const localized = lang === 'en' ? null : state.i18n?.[lang]
  const name = text(localized?.name) ?? text(state.name)
  if (!name) return null
  return {
    id: state.id,
    slug: text(state.slug) ?? '',
    name,
    felt: text(localized?.felt) ?? text(state.felt) ?? '',
  }
}

/** Resolve + localize one numeric effect reference through the corpus-built registry. */
export const resolve_spell_state = (registry, reference, locale = 'en') =>
  localize_spell_state(resolve_spell_state_row(registry, reference), locale)

/** The exact callback seam L1's spell_effect_sentence consumes. Registry construction happens once. */
export const spell_state_name_resolver = (spell_corpus, locale = 'en') => {
  const registry = build_spell_state_registry(spell_corpus)
  return (reference) => resolve_spell_state(registry, reference, locale)?.name ?? null
}

/**
 * Per-spell description resolution mandated by SPELL_TEXT_CONTRACT.md:
 * active locale → canonical EN → a visible corpus key canary. A missing row is never a blank panel.
 */
export const resolve_spell_description = (spell, locale = 'en') => {
  const lang = spell_text_locale(locale)
  const localized = lang === 'en' ? null : text(spell?.i18n?.[lang]?.description)
  const english = text(spell?.description)
  if (localized ?? english) return localized ?? english
  const key = text(spell?.description_key) ?? `spell.${text(spell?.id ?? spell?.template_id) ?? 'unknown'}.description`
  return `[${key}]`
}
