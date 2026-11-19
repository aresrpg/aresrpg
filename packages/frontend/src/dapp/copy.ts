// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { items_by_type } from '../content/items.ts'

export const dapp_text = (copy: AppCopy | null, key: string, values: Readonly<Record<string, string>> = {}): string =>
  copy ? copy_text(copy.dapp_page)(key, values) : key

export const item_name = (item_type: string): string => items_by_type[item_type]?.name ?? item_type

/** Refusal codes become one plain sentence; an unexpected code never reaches the player raw. */
export const dapp_error = (copy: AppCopy | null, code: string): string =>
  copy?.dapp_page[`error_${code}`] ?? dapp_text(copy, 'error_unknown')
