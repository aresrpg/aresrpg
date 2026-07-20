// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Atomic settlement receipt correlation. `ResultOpened` proves the result/XP/loot but carries no HP;
// `ResultMinted` carries final_hp for every settled seat, so it MUST be matched by character before use.

/**
 * @param {any[]} events
 * @param {string | null | undefined} character_id
 * @param {(event: any) => any} decode
 * @returns {number | null}
 */
export function receipt_final_hp(events, character_id, decode) {
  if (!character_id) return null
  for (const event of events ?? []) {
    if (!String(event?.type ?? '').endsWith('::ResultMinted')) continue
    const minted = decode(event)
    if (String(minted?.character ?? '') !== String(character_id)) continue
    const final_hp = Number(minted?.final_hp)
    return minted?.final_hp != null && Number.isFinite(final_hp) ? final_hp : null
  }
  return null
}

/**
 * SPOILS RECEIPT LAW (regression: a bag pet once rendered as razkin loot): map the FightResult's
 * `rolled` declaration ([{ item_template, qty }] — template OBJECT ids, results.move) into the victory card's
 * loot lines via the template map (object id → normalize_item_template row). The receipt is the ONLY loot
 * source — never an inventory diff (the old /v1 items-delta home in player_experience.js died with this: a
 * D245 bag transient emptied its baseline and the post-settle full-bag repaint rendered the player's whole
 * inventory as mob loot). Honest degradation: a template the map cannot resolve keeps its raw id as the
 * line's key — the card renders the D53 letter tile for it — never dropped, never guessed. Duplicate
 * templates aggregate; zero-qty rolls (nothing owed) surface no line.
 * @param {Array<{ item_template: string, qty: number|string }>} rolled the FightResult's rolled entries
 * @param {Map<string, { item_type?: string, name?: string }>} template_by_id get_template_map()'s shape
 * @returns {Array<{ item_type: string, name: string, amount: number }>} the FightLoot lines the slice folds
 */
export const loot_from_rolled = (rolled, template_by_id) => {
  /** @type {Map<string, { item_type: string, name: string, amount: number }>} */
  const by_key = new Map()
  for (const entry of rolled ?? []) {
    const id = String(entry?.item_template ?? '')
    if (!id) continue
    const tmpl = template_by_id?.get(id) ?? null
    const key = tmpl?.item_type || id
    const prev = by_key.get(key)
    by_key.set(key, {
      item_type: key,
      name: tmpl?.name ?? '',
      amount: (prev?.amount ?? 0) + Number(entry?.qty ?? 0),
    })
  }
  return [...by_key.values()].filter((line) => line.amount > 0)
}

/**
 * Every seat's exact soulbound FightOutcome id from a successful settle receipt, keyed by character. The active
 * seat may be consumed later in the same PTB; its ResultMinted event still remains authoritative receipt truth.
 * @param {any[]} events
 * @param {(event: any) => any} decode
 * @returns {Map<string,string>}
 */
export function receipt_minted_outcomes(events, decode) {
  const outcomes = new Map()
  for (const event of events ?? []) {
    if (!String(event?.type ?? '').endsWith('::ResultMinted')) continue
    const minted = decode(event)
    const character_id = minted?.character ? String(minted.character) : ''
    const outcome_id = minted?.result ? String(minted.result) : ''
    if (character_id && outcome_id) outcomes.set(character_id, outcome_id)
  }
  return outcomes
}
