// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { transaction_failure_kind } from '@aresrpg/sdk/transaction-error'

/** Facts not observed yet: the leaf waits instead of failing. */
const waiting = new Set([
  'needs_resync',
  'zone_outside_view',
  'inventory_unavailable',
  'travel_not_ready',
  'needs_custody_resync',
  'market_unavailable',
])
/** What only the player can change: the leaf holds its run, pays nothing and reads the fact again each
 * tick. A blocker is reported as the run's issue, so it waits where a refusal would fall through. */
const blocked = new Set(['area_unreachable', 'area_has_no_zone'])
/** What the game refuses right now: the leaf fails, and later ticks evaluate the tree again. */
const refused = new Set([
  'invalid_target_options',
  'target_outside_area',
  'target_group_mismatch',
  'character_not_available',
  'character_authority_mismatch',
  'fight_authority_mismatch',
  'unsupported_fight_mode',
  'not_active_turn',
  'fight_not_ended',
  'mob_group_unavailable',
  'fight_not_joinable',
  'pledge_changed',
  'tournament_idle',
  'tournament_confirm_required',
  'entry_fee_too_high',
  'dungeon_unavailable',
  'item_unavailable',
  'item_already_equipped',
  'unsupported_consumable',
  'consumable_no_effect',
  'insufficient_consumables',
  'tool_unavailable',
  'equipment_level_required',
  'tool_already_equipped',
  'resource_unavailable',
  'gathering_level_required',
  'gathering_tool_required',
  'recipe_unavailable',
  'craft_batch_limit',
  'crafting_level_required',
  'ingredients_required',
  'protector_required',
  'listing_changed_or_ineligible',
  'sale_source_changed_or_unavailable',
  'invalid_market_lot',
  'wrong_slot',
  'level_too_low',
  'relic_duplicate',
  'item_listed',
  'spell_not_learned',
  'spell_rank_capped',
  'insufficient_spell_points',
  'slot_empty',
  'character_name_taken',
  'invalid_character_name',
  'listing_gone',
  'nothing_to_collect',
])
/** Only explicit domain errors are user-facing; implementation messages may contain secrets. */
export const planning_issue = (error: unknown) => {
  if (!(error instanceof Error) || error.constructor !== Error) return undefined
  if (waiting.has(error.message) || blocked.has(error.message))
    return { state: 'waiting' as const, issue: error.message }
  if (refused.has(error.message) || /^illegal_fight_(action|turn):[a-z_]+$/.test(error.message))
    return { state: 'failure' as const, issue: error.message }
  return undefined
}
export const PLANNING_FAULT = 'run_planning_internal_error'
/** A planning fault the run survives. Its message is a fixed code and its operation holds only our own
 * identifiers, so reporting sends it as it is. */
const planning_diagnostic = (error: unknown, run: Readonly<{ id: string; revision?: number }>) =>
  Object.assign(new Error(PLANNING_FAULT), {
    operation: {
      run_id: run.id,
      revision: run.revision ?? 0,
      type: [TypeError, RangeError, SyntaxError].find((constructor) => error instanceof constructor)?.name ?? 'Error',
    },
  })
export const planning_blocker = <Run extends Readonly<{ id: string; revision?: number }>>(error: unknown, run: Run) => {
  const known = planning_issue(error)
  // A planning fault is never a decision: the run waits and evaluates its tree again next tick.
  return {
    state: 'waiting' as const,
    issue: known?.issue ?? 'internal_error',
    record: run,
    diagnostic: known ? undefined : planning_diagnostic(error, run),
  }
}

/** Reuse the SDK display classification; persisted raw errors never enter objective copy.
 * This is explanation only, never permission to retry a failed or uncertain command. */
export const command_issue = (status: string, error: unknown): string => {
  if (status !== 'failed') return `command_${status}`
  const failure = new Error(String(error).replace(/^Error: /, ''))
  const known = planning_issue(failure)
  if (known) return known.issue
  return transaction_failure_kind(failure) === 'funding' ? 'funding_required' : 'command_failed'
}

/**
 * What a client may read of a command's error. A stored domain code passes as it is; any other stored
 * text is an implementation message and leaves the service only as its classification.
 */
export const public_command_error = (status: string, error: string | undefined): string | undefined => {
  if (error === undefined) return undefined
  return /^[a-z_]+(:[a-z_]+)?$/.test(error) ? error : command_issue(status, error)
}
