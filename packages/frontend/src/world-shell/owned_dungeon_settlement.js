// Same-wallet dungeon companion settlement. The active seat's settlement receipt mints one exact FightOutcome
// for every seat; each alt then advances its own RunPass and opens its own outcome through an existing self-pay PTB.
// This tail deliberately does not drive the active victory card or room recap.

import { decode_fight_event } from '@aresrpg/sdk/fight'

import { context } from '../game/store.js'
import { load_roster } from '../roster/load_roster'

import { settle_owned_dungeon_runs } from './owned_team_actions.js'
import { receipt_minted_outcomes } from './fight_result_receipt.js'
import { invalidate_pending_outcomes } from './pending_outcomes.js'

/**
 * @param {{ leader_receipt:any, world_id:string|null, leader_character_id:string|null,
 *   run_pass_ids_by_character:Record<string,string> }} input
 * @returns {Promise<Record<string,string>>} character → opened FightResult id (loot ticket; marker already clear)
 */
export async function settle_owned_dungeon_companions({
  leader_receipt,
  world_id,
  leader_character_id,
  run_pass_ids_by_character,
}) {
  const pass_ids = run_pass_ids_by_character ?? {}
  if (!leader_character_id || !world_id || Object.keys(pass_ids).length <= 1) return {}
  const outcome_ids_by_character = receipt_minted_outcomes(leader_receipt?.events, decode_fight_event)
  const opened_result_ids = {}
  try {
    await settle_owned_dungeon_runs({
      world_id,
      leader_character_id,
      run_pass_ids_by_character: pass_ids,
      outcome_ids_by_character,
      on_settled: (character_id, opened) => {
        if (opened?.result_id) opened_result_ids[character_id] = opened.result_id
        // M5: same-wallet companion HP/XP write-back as a typed receipt_patch (folded + XP-floored in the reducer).
        context.dispatch('action/sui_data', {
          kind: 'receipt_patch',
          op: 'fight_receipt',
          character_id,
          xp_share: opened?.xp_share,
          final_hp: opened?.final_hp,
        })
      },
    })
    return opened_result_ids
  } catch (error) {
    if (error && typeof error === 'object') error.opened_result_ids = opened_result_ids
    throw error
  } finally {
    invalidate_pending_outcomes()
    void load_roster().catch(() => {})
  }
}
