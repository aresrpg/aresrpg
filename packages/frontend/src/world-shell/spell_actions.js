// #55 — REAL on-chain spell LEVEL-UP against `spell_level::raise_spell_level` (permissionless, structural
// correctness via the player's PersonalKioskCap). Spending spell points raises ONE owned spell one level on the
// kiosk-locked Character; the door takes the spell's shared `SpellTemplate` object (fight-spells.js rows carry
// its id) and reads the max level + per-level char gate + class match off it. The SDK builder is
// `raise_spell_level_ptb` (game.js — it replaced the S-51b-deleted legacy `character_spells` builder). Mirrors
// equip_actions.js / consumable_actions.js EXACTLY: same get_sdk() instance, same personal-kiosk resolution,
// same run_tx path. NO @server, no fake — a real self-pay tx the player signs, spending points at the S8
// escalating cost (target_level − 1) the chain enforces.
//
// The Character must be IDLE (locked in the player's kiosk): while it is exploring / in a dungeon it is escrowed
// OUT of the kiosk, so `kiosk_for_character` returns null and the caller surfaces an honest error.

import i18n from '../i18n'
import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'

import { run_tx } from './tx'
// S-57 — THE ONE kiosk-resolution home (derive-from-character; never a first-cap scan). See kiosk_resolve.js.
import { kiosk_for_character } from './kiosk_resolve.js'

/**
 * Spend spell points to raise the spell of `spell_template_id` (the shared SpellTemplate OBJECT id — a
 * fight-spells.js row's `object_id`) by ONE level on `character_id`. Returns `{ result, timing }` (run_tx)
 * so the caller reconciles off the tx result + reads latency. Throws (humanized) if the character isn't idle in
 * the player's kiosk, or on any on-chain abort (spell_level codes 101-104 → player copy via run_tx/abort_copy).
 * @param {{ character_id: string, spell_template_id: string }} args
 */
export async function upgrade_spell({ character_id, spell_template_id }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error(i18n.t('spells.char_busy'))

  const tx = sdk.raise_spell_level_ptb({
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    spell_template_id,
  })
  return run_tx('spell', tx)
}
