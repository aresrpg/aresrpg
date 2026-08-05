// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// send_sui_amount.ts — the SUI send form's amount policy, as a pure function the modal renders and the tests
// drive (it used to be 25 lines inlined in an onChange handler, untestable by construction).
//
// #2243 KILLED THREE ARTIFICIAL LIMITS that lived here:
//   · `balance − GAS_RESERVE_MIST` — a "keep 0.2 SUI for gas" ceiling. It made the wallet un-emptiable; the
//     drain path (sui_transfer_ptb with amount_mist=null) pays the fee FROM the transferred coin, so no
//     reserve is needed to send, and a partial send that leaves the sender too poor for the NEXT gameplay tx
//     is the player's call — the whole game is sponsored at zero SUI anyway.
//   · a 0.01 SUI MINIMUM — borrowed from the MARKETPLACE net-price rules (MIN_MIST / %20 divisibility exist
//     so the 5%/95%/10% fee split stays exact integers). A plain transfer is never split into fee shares, so
//     none of that applies: 1 MIST is a legitimate transfer.
//   · 2-decimal input precision — the chain's unit is MIST (9 decimals); truncating to 0.01 SUI silently
//     refused amounts that are perfectly sendable.
//
// What is LEFT is honest-only: parseable, strictly positive, and not more than the wallet actually holds.

import { MIST_PER_SUI } from '../utils/sui_mist'

/** i18n leaf under `wallet.send.err.*` — the error IS the translation key, so no mapping table can drift. */
export type SendAmountError = 'amount_invalid' | 'amount_positive' | 'insufficient_balance'

export interface SendAmountVerdict {
  /** Parsed MIST, or null when nothing parseable was typed yet. */
  mist: bigint | null
  error: SendAmountError | null
}

// What the field ACCEPTS as you type (digits, one dot, up to MIST precision). Rejecting the keystroke rather
// than the value is what keeps a half-typed "1." from flashing an error.
const TYPABLE_RE = /^\d*\.?\d{0,9}$/
const PARSABLE_RE = /^\d*(\.\d{0,9})?$/

export function is_typable_amount(raw: string): boolean {
  return TYPABLE_RE.test(raw)
}

/**
 * Decide what a typed amount means. `balance_mist === null` = balance not read yet, so the wallet-holds check
 * is skipped rather than guessed (never invent a refusal from a number we do not have).
 */
export function parse_send_amount(raw: string, balance_mist: bigint | null): SendAmountVerdict {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '.') return { mist: null, error: null }
  if (!PARSABLE_RE.test(trimmed)) return { mist: null, error: 'amount_invalid' }

  const [whole = '', frac = ''] = trimmed.split('.')
  const mist = BigInt(whole || '0') * MIST_PER_SUI + BigInt(frac.padEnd(9, '0') || '0')

  if (mist <= 0n) return { mist, error: 'amount_positive' }
  if (balance_mist !== null && mist > balance_mist) return { mist, error: 'insufficient_balance' }
  return { mist, error: null }
}
