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
 * The live map's item_type is also the authored render slug. Snapshot it explicitly onto the projection:
 * FightReport must not re-join template ids against either the bundled seed receipt or a network read.
 * @param {Map<string, { item_type?: string, name?: string }>} template_by_id get_template_map()'s shape
 * @returns {Array<{ template_id: string, item_type: string, icon_slug?: string, name: string, amount: number }>} the FightLoot lines the slice folds
 */
export const loot_from_rolled = (rolled, template_by_id) => {
  /** @type {Map<string, { template_id: string, item_type: string, icon_slug?: string, name: string, amount: number }>} */
  const by_key = new Map()
  for (const entry of rolled ?? []) {
    const id = String(entry?.item_template ?? '')
    if (!id) continue
    const tmpl = template_by_id?.get(id) ?? null
    const icon_slug = String(tmpl?.item_type ?? '')
    // Template identity is exact and already authored by the receipt. `item_type` is only a class for
    // several stackables (every RESOURCE can literally be "resource"), so aggregating on it merged distinct
    // drops and made both their icon and stats impossible to recover. Keep the id all the way to LootTile,
    // plus the live catalog's authored slug as a fold-time snapshot (#1522).
    const prev = by_key.get(id)
    by_key.set(id, {
      template_id: id,
      item_type: tmpl?.item_type || id,
      ...(icon_slug ? { icon_slug } : {}),
      name: tmpl?.name ?? '',
      amount: (prev?.amount ?? 0) + Number(entry?.qty ?? 0),
    })
  }
  return [...by_key.values()].filter((line) => line.amount > 0)
}

/**
 * Exact ItemMinted receipt rows -> victory-card lines. Unlike FightResult.rolled's aggregate declaration,
 * these rows carry the concrete object id whose StatsKey must drive an owned tooltip. Keep separate gear
 * objects separate; one stackable mint remains one line with its on-chain amount.
 * @param {Array<{ id: string, template_id?: string|null, item_type?: string, icon_slug?: string, name?: string, amount?: number }>} rows
 * @returns {Array<{ item_id: string, template_id?: string, item_type: string, icon_slug?: string, name: string, amount: number }>}
 */
export const loot_from_minted_rows = (rows) =>
  (rows ?? []).flatMap((row) => {
    const item_id = String(row?.id ?? '')
    if (!item_id) return []
    const template_id = String(row?.template_id ?? '')
    const amount = Number(row?.amount ?? 1)
    return [
      {
        item_id,
        ...(template_id ? { template_id } : {}),
        item_type: String(row?.item_type ?? template_id),
        ...(row?.icon_slug ? { icon_slug: String(row.icon_slug) } : {}),
        name: String(row?.name ?? ''),
        amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
      },
    ]
  })

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
