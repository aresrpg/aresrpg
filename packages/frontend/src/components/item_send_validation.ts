// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { is_suins_name } from '../utils/suins'

const address_full_re = /^0x[a-f0-9]{64}$/i
const positive_integer_re = /^[1-9]\d*$/

export type item_send_recipient_error = 'recipient_invalid' | null
export type item_send_amount_error = 'amount_invalid' | 'amount_exceeds_available' | 'amount_non_stackable' | null

export type item_send_dialog_validation = {
  valid: boolean
  amount: bigint | null
  recipient_error: item_send_recipient_error
  amount_error: item_send_amount_error
}

export function validate_item_send_dialog({
  recipient,
  amount,
  available_amount,
  stackable,
}: {
  recipient: string
  amount: string
  available_amount: number | bigint
  stackable: boolean
}): item_send_dialog_validation {
  const recipient_value = recipient.trim()
  const recipient_error: item_send_recipient_error =
    address_full_re.test(recipient_value) || is_suins_name(recipient_value) ? null : 'recipient_invalid'

  const amount_value = amount.trim()
  const parsed_amount = positive_integer_re.test(amount_value) ? BigInt(amount_value) : null
  let amount_error: item_send_amount_error = null
  if (parsed_amount == null) amount_error = 'amount_invalid'
  else if (!stackable && parsed_amount !== 1n) amount_error = 'amount_non_stackable'
  else if (stackable && parsed_amount > BigInt(available_amount)) amount_error = 'amount_exceeds_available'

  return {
    valid: recipient_error == null && amount_error == null,
    amount: parsed_amount,
    recipient_error,
    amount_error,
  }
}
