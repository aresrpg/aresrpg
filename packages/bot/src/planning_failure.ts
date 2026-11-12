// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { transaction_failure_kind } from '@aresrpg/sdk/transaction-error'

export const PLANNING_DIAGNOSTIC_PREFIX = 'run_planning_internal_error '

const waiting = new Set([
  'needs_resync',
  'inventory_unavailable',
  'travel_not_ready',
  'needs_custody_resync',
  'market_unavailable',
])
const blocked = new Set([
  'character_not_available',
  'character_authority_mismatch',
  'fight_authority_mismatch',
  'unsupported_fight_mode',
  'not_active_turn',
  'fight_not_ended',
  'mob_group_unavailable',
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
])
/** Only explicit domain errors are user-facing; implementation messages may contain secrets. */
export const planning_issue = (error: unknown) => {
  if (!(error instanceof Error) || error.constructor !== Error) return undefined
  if (waiting.has(error.message)) return { state: 'waiting' as const, issue: error.message }
  if (blocked.has(error.message)) return { state: 'awaiting_ai' as const, issue: error.message }
  if (/^illegal_fight_(action|turn):[a-z_]+$/.test(error.message))
    return { state: 'awaiting_ai' as const, issue: error.message }
  return undefined
}
export const planning_diagnostic = (error: unknown, kind: string, run: Readonly<{ id: string; revision?: number }>) => {
  const type = [TypeError, RangeError, SyntaxError].find((constructor) => error instanceof constructor)?.name ?? 'Error'
  return new Error(
    `${PLANNING_DIAGNOSTIC_PREFIX}${JSON.stringify({ kind, run_id: run.id, revision: run.revision ?? 0, type })}`
  )
}

export const planning_blocker = <Run extends Readonly<{ id: string; revision?: number }>>(
  error: unknown,
  kind: string,
  run: Run
) => {
  const known = planning_issue(error)
  return {
    state: known?.state ?? ('awaiting_ai' as const),
    issue: known?.issue ?? 'internal_error',
    record: run,
    diagnostic: known ? undefined : planning_diagnostic(error, kind, run),
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
