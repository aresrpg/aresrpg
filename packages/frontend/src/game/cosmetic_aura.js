// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COSMETIC → STATUS AURA (display concern, frontend home). When a mapped cosmetic is equipped, the roam
// avatar's OWN silhouette glows with the aura's pack colour (engine attach_status_overlay + STATUS_OVERLAY).
//
// SSOT: seed/generators/shop_catalog.mjs — every prestige wearable is pinned to one of the pack's StatusFX
// auras there (the shop rows carry the `aura` field; the 3 airdrop-reserved crowns are documented in that
// file's header, no seed row). This map is the RUNTIME projection of that pairing, keyed by the item's
// template slug. It is display-only: NO Move field, NO chain read — the aura is derived from the equipped
// slug alone (the package is in a size crisis; SPEC keeps cosmetics purely visual). Keep it in lockstep with
// the generator; cosmetic_aura.test.js asserts the pinned reserved crowns + full generator coverage.
//
// Values are ENGINE STATUS_OVERLAY keys (packages/engine/src/render/vfx_model_overlay.js) so each resolves to
// a faithful on-model colour transcribed from the pack's <k>_overlay.tres. 1:1 with the generator EXCEPT
// `gem` (casque_hayate): the pack ships no gem_overlay.tres, so it borrows the nearest crystal family, `shard`.

/** @type {Record<string, string>} slug → STATUS_OVERLAY key (packages/engine STATUS_OVERLAY). */
export const COSMETIC_AURA = /** @type {const} */ ({
  // ── S/A — the crown jewels + hero models (shop) ─────────────────────────────────────────────
  coiffe_pepe_royal: 'divine',
  berserk: 'flame',
  cape_kamui: 'void',
  casque_hayate: 'shard', // seed aura `gem` → shard (no gem_overlay.tres in the pack; nearest crystal family)
  corbac_head: 'rot',
  drakar: 'shard',
  momaku: 'sleep',
  solomonk: 'magic',
  // ── B — themed singles / dual skins (shop) ──────────────────────────────────────────────────
  cape_fuwa_black: 'heal',
  cape_fuwa_white: 'ice',
  coiffe_fuwa_black: 'green',
  coiffe_fuwa_white: 'shatter',
  ekusoni: 'dark',
  enka_muru: 'nature',
  mokan: 'poison',
  // ── the 3 airdrop-reserved crowns (pinned; no shop row) ────────────────────────────────
  sui_helmet: 'water', // the sui helmet gets a blue aura — water is the pack's canonical blue
  suicunio: 'purple', // the suicunio gets a purple aura — the literal pack purple
  sam: 'glow',
})

/** Slot properties (precedence order) an equipped cosmetic may live on a Character read-model. The head crown
 *  wins over the cloak. cosmetic_* are the display-only paper-doll slots (SPEC §7.11); hat/cloak are the live
 *  equip slots. @type {readonly string[]} */
const COSMETIC_SLOTS = /** @type {const} */ (['hat', 'cosmetic_hat', 'cloak', 'cosmetic_cloak'])

/** The identity fields a cosmetic item may carry (the on-chain template slug is the map key; item_type may be
 *  the slot word 'hat', which is never a map key, so it can never false-match). @type {readonly string[]} */
const ID_FIELDS = /** @type {const} */ (['template_id', 'slug', 'id', 'name', 'item_type', 'type', 'appearance'])

/** Resolve one item's aura key from the map (tries every identity field), or null. @param {any} item */
export function aura_of_item(item) {
  if (!item) return null
  for (const f of ID_FIELDS) {
    const v = item[f]
    if (typeof v === 'string' && v in COSMETIC_AURA) return COSMETIC_AURA[v]
  }
  return null
}

/**
 * The STATUS_OVERLAY aura key for a character's equipped cosmetics (head crown first, then cloak), or null when
 * nothing mapped is worn. The single read the roam avatar uses to decide the body-glow — pure over the live
 * read-model, so equip/unequip applies the instant the store updates. @param {any} character @returns {string|null}
 */
export function resolve_cosmetic_aura(character) {
  if (!character) return null
  for (const slot of COSMETIC_SLOTS) {
    const key = aura_of_item(character[slot])
    if (key) return key
  }
  return null
}
