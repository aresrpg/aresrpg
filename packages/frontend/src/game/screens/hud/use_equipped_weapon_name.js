// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2279 — the React binding for ONE fact: what a character's equipped weapon is CALLED.
//
// This is deliberately NOT a fight-visible fact and never enters the fight projection. The fight carries the
// STRIKE (participant.move's Weapon line: element, band, AP, reach) and nothing about the item's identity —
// the chain seats a weapon's numbers into a fight, never its name. The name is equipment identity, and its one
// home is the paper doll's own projection (`equipped_weapon_name` → `real_equipment_of`). Binding it here, once,
// keeps every surface that wants to NAME the swing (the fight bar's slot 0, its tooltip, the combat log)
// reading the same string the Inventory paints, and keeps the equipment read out of the fight components.

import { useMemo } from 'react'

import { useGameState } from '../../store.js'

import { equipped_weapon_name } from './inventory-equip.js'

/**
 * The display name of `character_id`'s equipped weapon — '' when nothing is equipped, when the character is
 * unknown, or while the `/v1` feeds have not landed (the caller then keeps its own generic label).
 * @param {string | null | undefined} character_id the character whose doll to read (a fight reads ITS fighter)
 * @returns {string}
 */
export function useEquippedWeaponName(character_id) {
  const characters = useGameState((s) => s.sui.characters)
  const owner_items = useGameState((s) => s.sui.items)
  return useMemo(
    () => equipped_weapon_name((characters ?? []).find((row) => row.id === character_id) ?? null, owner_items),
    [characters, owner_items, character_id]
  )
}
