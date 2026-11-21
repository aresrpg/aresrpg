// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow } from '@aresrpg/protocol'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { items_by_type } from '../content/items.ts'
import { format_sui } from '../wallet_amount.ts'

import type { DirectRequest } from './direct.ts'

export const dapp_text = (copy: AppCopy | null, key: string, values: Readonly<Record<string, string>> = {}): string =>
  copy ? copy_text(copy.dapp_page)(key, values) : key

/** What a closed action says while the bot has not answered: it waits, or the bot cannot be reached. */
export const bot_wait_key = (unreachable: boolean): string =>
  unreachable ? 'observe_failed' : 'blocker_command_pending'

export const item_name = (item_type: string): string => items_by_type[item_type]?.name ?? item_type

/** Digits of the network fees a run or the wallet paid: one transaction costs a few thousandths of a SUI. */
const FEE_DIGITS = 3
/** Network fees paid, in SUI, as every card and total of the page prints them. */
export const fees_paid = (locale: Locale, mist: bigint): string => format_sui(mist, FEE_DIGITS, locale)

/** Refusal codes become one plain sentence; an unexpected code never reaches the player raw. */
export const dapp_error = (copy: AppCopy | null, code: string): string =>
  copy?.dapp_page[`error_${code}`] ?? dapp_text(copy, 'error_unknown')

/**
 * The sentence of a resolved direct request. One that went through has one key per kind,
 * `direct_done_<action>`, naming the hero it was for, or the hero it created, and the item and units it
 * was about. A refused one says its reason.
 */
export const direct_text = (
  copy: AppCopy | null,
  { action, status, error, hero_id, proof, item_type, amount }: DirectRequest,
  heroes: readonly Readonly<Pick<CharacterRow, 'id' | 'name'>>[]
): string => {
  if (status === 'refused') return dapp_error(copy, error ?? 'unknown')
  const created = proof?.name ?? ''
  return dapp_text(copy, `direct_done_${action}`, {
    name: heroes.find(({ id }) => id === hero_id)?.name ?? created,
    item: item_type === null ? '' : item_name(item_type),
    amount: String(amount),
  })
}
