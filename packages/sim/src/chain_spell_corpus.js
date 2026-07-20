// The chain-spell corpus door. Seed/mainnet rows use the Move SpellTemplate shape; the sim owns the one
// normalization algebra for that shape. Product consumers pass the already-loaded rows through this pure
// package boundary and receive only authored chain templates (the sim's built-in mob attack is intentionally
// not part of this map).

import { normalize_spell_templates } from './spell_templates.js'

/**
 * Normalize an iterable/array of authored chain SpellTemplate rows into the sim's SpellTemplate map.
 * Duplicate ids follow normalize_spell_templates' last-row-wins rule.
 * @param {unknown} corpus
 * @returns {Map<string, import('./spell_templates.js').SpellTemplate>}
 */
export const normalize_chain_spell_corpus = (corpus) => {
  const rows = Array.isArray(corpus) ? corpus : []
  const normalized = normalize_spell_templates(rows)
  /** @type {Array<[string, import('./spell_templates.js').SpellTemplate]>} */
  const entries = rows.reduce((out, row) => {
    const spell_id = String(row?.id ?? '')
    const template = normalized.get(spell_id)
    return spell_id && template ? [...out, [spell_id, template]] : out
  }, [])
  return new Map(entries)
}
