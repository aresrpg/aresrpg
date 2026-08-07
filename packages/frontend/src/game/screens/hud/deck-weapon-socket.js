// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Slot-0's pure projection: the escrow weapon line becomes the name + facts handed to SpellSeedTip. Keeping
// this store/DOM-free pins the equipped-weapon boundary without mounting DeckCluster's fight/world stores.

import { weapon_next_hit, weapon_strike_band, weapon_strike_elements } from '@aresrpg/fight/weapon'

// §17.27 weapon element id → localized element name (participant.move WL_ELEMENT: 0 fire · 1 water · 2 earth · 3 air).
const WEAPON_ELEMENT_KEYS = ['fire', 'water', 'earth', 'air']
const weapon_element_name = (t, element) => t(`encyclopedia.element.${WEAPON_ELEMENT_KEYS[element] ?? 'neutral'}`)

// Bare hands = the participant.move unarmed_line signature (earth, dmg 4, ap 3, reach 1). No family slug survives
// the on-chain Weapon decode, so this signature is the honest "no weapon equipped" tell for the tooltip label.
export const is_bare_hands = (w) => !!w && w.element === 2 && w.damage === 4 && w.ap_cost === 3 && w.reach === 1

/**
 * #2279 — THE ATTACK IS THE ITEM. The weapon action's label is the equipped item's OWN name whenever the
 * equipment projection has one (`equipped_weapon_name`, the paper doll's own home), so the bar, the tooltip
 * and the fight log all read the sword the player equipped instead of the generic "Weapon Attack". The
 * generic strings stay the honest fallback for bare hands and for the split second before the item doc lands.
 * @param {string | null | undefined} item_name the equipped weapon item's display name
 * @param {boolean} bare_hands the unarmed signature
 * @param {(key: string) => string} t
 * @returns {string}
 */
export const weapon_action_name = (item_name, bare_hands, t) =>
  item_name || t(bare_hands ? 'fight.weapon_bare' : 'fight.weapon_attack')

/**
 * @param {{ weapon: any, item_name?: string | null, glow: boolean, clock: any,
 *   t: (key: string, values?: any) => string }} args
 * @returns {{ is_bare_hands: boolean, name: string, facts: true | Record<string, any> }}
 */
export function weapon_socket_projection({ weapon, item_name = null, glow, clock, t }) {
  const bare_hands = is_bare_hands(weapon)
  const name = weapon_action_name(item_name, bare_hands, t)
  // The DAMAGE the tooltip states comes from the ONE strike derivation (@aresrpg/fight/weapon), not the family
  // `Weapon` fields: a seat with authored item lines strikes for Σ(lines), across the elements those lines
  // name, and printing the family line here was the socket's half of #1323. The band is the honest resting
  // state; `next_hit` sharpens it to the slot-exact number whenever the §7 clock resolves.
  const band = weapon ? weapon_strike_band(weapon, false) : null
  const crit_band = weapon ? weapon_strike_band(weapon, true) : null
  const rolled = weapon ? weapon_next_hit(weapon, clock, glow) : null
  // Pass the FACTS object (element names resolved) when the escrow weapon has loaded, else `true` (name-only).
  const facts = weapon
    ? {
        ...weapon,
        damage: band.min,
        damage_max: band.max,
        crit_damage: crit_band.min,
        crit_damage_max: crit_band.max,
        element_name: weapon_strike_elements(weapon)
          .map((element) => weapon_element_name(t, element))
          .join(' / '),
        next_hit: rolled == null ? null : { value: rolled, crit: glow },
      }
    : true
  return { is_bare_hands: bare_hands, name, facts }
}
