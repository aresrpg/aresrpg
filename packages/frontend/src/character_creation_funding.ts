// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'

import { format_sui } from './wallet_amount.ts'

const CHARACTER_CREATION_BALANCE_MIST = CHARACTER_PRICE_MIST + GAS_BUDGET_MIST
const FALLBACK_FUNDING_TEXT = 'You need at least {{fee}} SUI left in your balance for fees.'

export const character_creation_insufficient = (balance_mist: bigint | null): boolean =>
  balance_mist !== null && balance_mist < CHARACTER_CREATION_BALANCE_MIST

export const character_creation_funding_text = (template: string): string =>
  template.replaceAll('{{fee}}', format_sui(GAS_BUDGET_MIST, 1))

const is_character_creation_balance_error = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.includes('InsufficientCoinBalance')
}

export const character_creation_failure_message = (
  error: unknown,
  copy: Readonly<{ insufficient_sui: string }> | null
): unknown =>
  is_character_creation_balance_error(error)
    ? character_creation_funding_text(copy?.insufficient_sui ?? FALLBACK_FUNDING_TEXT)
    : error
