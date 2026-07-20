// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHARACTER DELETE (BACKLOG 18, design ruling 2026-07-15: delete characters in the characters tab, provided
// everything was unequipped first — even the free one). The chain-direct action behind the drawer/page delete confirm:
// resolve the character's OWN kiosk (S-57 law — derive from the character, never a first-cap scan), compose
// the SDK's one-call burn door (`character_extract::delete_character` — the unequipped / no-unopened-fight /
// no-dungeon-lock guards live ON-CHAIN; the raw Character never leaves the kiosk system), sign through the
// S-54 tx choke, then fold the receipt-proven removal through the ONE roster pipeline (sui_reduce
// `remove_character` — tombstoned so a lagging /v1 snapshot can never resurrect a burned character).
// IRREVERSIBLE — and the NAME stays reserved forever (derived_object has no unclaim); the confirm card
// says both before this ever runs. Mirrors equip_actions.js: same get_sdk, same kiosk resolution, same
// run_tx path — errors flow to the caller's toast through the ONE shared decoder (abort_copy).

import { use_auth } from '../../auth'
import { get_sdk } from '../../chain/sdk'
import i18n from '../../i18n'
import { context } from '../core/game.js'
import { kiosk_for_character } from '../../world-shell/kiosk_resolve.js'
import { run_tx } from '../../world-shell/tx'

/**
 * Burn one character the wallet owns, in-kiosk, and fold the receipt into the roster pipeline. Throws the
 * decoded-or-human error for the caller's toast; returns the run_tx outcome on success.
 * @param {string} character_id
 */
export async function delete_character_onchain(character_id) {
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('characters.delete.not_connected', 'Not connected'))
  const sdk = await get_sdk()
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle)
    throw new Error(
      i18n.t(
        'characters.delete.not_in_kiosk',
        'That character is not in your kiosk. If it is escrowed or exploring, bring it home first.'
      )
    )

  const tx = sdk.delete_character_ptb({
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
  })
  const outcome = await run_tx('character_delete', tx)

  // Receipt-proven removal — the ONE-PIPELINE law: the reducer drops the character NOW (this frame) and
  // tombstones the id so no stale snapshot regresses the burn. Never a direct store write from out here.
  context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'remove_character', id: character_id })
  return outcome
}
