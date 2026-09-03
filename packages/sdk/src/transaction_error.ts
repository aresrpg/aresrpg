// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const readable_transaction_error = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
    const byte = Number.parseInt(hex, 16)
    return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : encoded
  })
}

/** A receipt-fresh owned ref may reach one resolver before another. Only pre-submission failures
 * are retry candidates; a digest-bearing execution is terminal. Timing belongs to the caller. */
export const pre_submission_version_race = (error: unknown): boolean => {
  const message = readable_transaction_error(error)
  const stale_input =
    /provided version (?:doesn't|does not) match/i.test(message) ||
    /transaction needs to be rebuilt because object .* is unavailable for consumption, current version:/i.test(message)
  return !message.includes('failed on-chain') && message.includes('NOT submitted') && stale_input
}

export const pre_submission_stale_owned_ref = (error: unknown): boolean => {
  const message = readable_transaction_error(error)
  const versions = message.match(
    /provided version (?:doesn't|does not) match[^]*?provided:\s*(\d+)\s+actual:\s*(0x[\da-f]+|\d+)/i
  )
  return !message.includes('failed on-chain') && !!versions && BigInt(versions[1]!) < BigInt(versions[2]!)
}

export const pre_submission_close_projection_lag = (error: unknown): boolean => {
  const message = readable_transaction_error(error)
  const close_guard = /::fight::close|::combat::assert_closable/i.test(message)
  return !message.includes('failed on-chain') && /abort code:\s*1712/i.test(message) && close_guard
}
