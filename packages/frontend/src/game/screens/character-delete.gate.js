// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE DELETE GATE — the ONE pure block-reason fold both character-delete UI variants (the in-world
// drawer and the companion page master-detail, CharactersDrawer.jsx) render the delete affordance from.
// Split from character-delete.js (the tx action) so the fold stays importable under DOM-less bun:test —
// the action's graph (auth → Enoki wallet registration) needs `window` at module scope. Imports here are
// pure data + i18n ONLY; keep it that way.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { EQUIPMENTS, WEAPONS } from '@aresrpg/sdk/items'

import i18n from '../../i18n'

// The read-model (read_user.get_characters) spreads each EQUIPPED item onto the character object keyed by
// the item's category (hat/amulet/belt/boots/pet/title/relic/ring + a weapon category like sword/bow/...),
// AND the inventory paper-doll keys it by slot (weapon/left_ring/right_ring/relic_1..6). To detect "has any
// equipped item" robustly across both shapes, we scan a superset of keys for a present item-like value.
const EQUIPPED_KEYS = [
  ...EQUIPMENTS,
  ...WEAPONS,
  'weapon',
  'left_ring',
  'right_ring',
  'relic_1',
  'relic_2',
  'relic_3',
  'relic_4',
  'relic_5',
  'relic_6',
]

/**
 * Does an on-chain character currently have ANY equipped item? A deletion would orphan the kiosk-locked
 * item, so the delete is blocked until the player unequips. A value counts only when it is an
 * item-like object (carries an id) — a scalar field of the same name (e.g. a numeric stat) never trips it.
 * @param {any} character @returns {boolean}
 */
const has_equipped_items = (character) =>
  EQUIPPED_KEYS.some((key) => {
    const value = character?.[key]
    return value != null && typeof value === 'object' && value.id != null
  })

/**
 * THE UNPUBLISHED-DOOR GATE + the delete guard matrix. FIRST guard: the on-chain door itself
 * (`aresrpg::character_extract`) ships at a FUTURE Move-wave ceremony — until the deployment pin
 * (CHARACTER_EXTRACT_POLICY) is stamped for `network`, every delete is blocked with the honest "next
 * chain upgrade" reason (the SDK builder would refuse with a raw dev error; the UI must never route a
 * click into that wall). A missing/unknown `network` reads as unstamped → fail-CLOSED. Then these
 * guards: a character out on an expedition, the character you are PLAYING (in-world drawer only — the
 * companion page is management, and its previewed character must stay deletable or a single-character
 * account could never delete at all), and any character with EQUIPPED items (deleting would orphan
 * kiosk-locked gear — the on-chain door refuses too). Returns the human reason to disable + explain, or
 * null when delete is allowed. No em-dashes (house copy law).
 * @param {any} character
 * @param {{ network: string, in_world?: boolean, selected_id?: string | null }} opts
 * @returns {string | null}
 */
export function delete_block_reason(character, { network, in_world = true, selected_id = null }) {
  if (!aresrpg_id(/** @type {any} */ (network), 'CHARACTER_EXTRACT_POLICY'))
    return i18n.t(
      'characters.delete.block_unpublished',
      'Character deletion arrives with the next chain upgrade'
    )
  if (character.exploring)
    return i18n.t('characters.delete.block_exploring', 'Character is out on an expedition')
  if (in_world && character.id === selected_id)
    return i18n.t('characters.delete.block_playing', 'Cannot delete the character you are playing')
  if (has_equipped_items(character))
    return i18n.t('characters.delete.block_equipped', 'Unequip all items before deleting')
  return null
}
