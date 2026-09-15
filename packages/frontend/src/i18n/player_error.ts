// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { world_travel_refusal } from '@aresrpg/sdk/transaction-error'

import type { AppCopy } from './copy.ts'
import { error_message, error_text } from './error_text.ts'

export type FailureCopyKey =
  | 'transaction_unknown_toast'
  | 'transaction_recovered_toast'
  | 'game_paused_toast'
  | 'gas_budget_toast'
  | 'movement_sync_toast'
  | 'fight_path_changed_toast'
  | 'fight_placement_unavailable_toast'
  | 'party_member_unavailable_toast'
  | 'fight_turn_already_forced_toast'

const matches_abort = (message: string, code: number, owner: string): boolean =>
  new RegExp(`abort code:\\s*${code}\\b`, 'i').test(message) && message.includes(owner)

const ABORT_FAILURES = Object.freeze([
  Object.freeze({ code: 1709, owner: '::combat::place', key: 'fight_placement_unavailable_toast' }),
  Object.freeze({ code: 1725, owner: '::fight::walk_path', key: 'fight_path_changed_toast' }),
  Object.freeze({ code: 2002, owner: '::party::af', key: 'party_member_unavailable_toast' }),
  Object.freeze({ code: 1724, owner: '::fight::crank', key: 'fight_turn_already_forced_toast' }),
] satisfies readonly Readonly<{ code: number; owner: string; key: FailureCopyKey }>[])

export const failure_copy_key = (message: string): FailureCopyKey | null => {
  if (message.startsWith('[sdk] transaction outcome unknown:')) return 'transaction_unknown_toast'
  if (message.startsWith('[sdk] previous transaction recovered')) return 'transaction_recovered_toast'
  if (message.includes('::version::assert_latest')) return 'game_paused_toast'
  if (message.includes('gas budget exceeded')) return 'gas_budget_toast'
  if (world_travel_refusal(message)) return 'movement_sync_toast'
  return ABORT_FAILURES.find(({ code, owner }) => matches_abort(message, code, owner))?.key ?? null
}

export const player_error_text = (copy: AppCopy, error: unknown): string => {
  const message = error_message(error)
  if (Object.values(copy).includes(message) || Object.values(copy.airdrop_page).includes(message)) return message
  const key = failure_copy_key(message)
  return key ? copy[key] : error_text(copy.kares_page, error)
}

export const player_error_hint = (copy: AppCopy, error: unknown): string | undefined =>
  error == null ? undefined : player_error_text(copy, error)
