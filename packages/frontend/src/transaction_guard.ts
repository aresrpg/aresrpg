// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const VERSION_RACE_RETRY_MS = 250

/** A lagging read node can reject a receipt-fresh owned ref before submission. A failure with
 *  a digest is categorically different: it executed and must never be retried automatically. */
export const pre_submission_version_race = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return !message.includes('failed on-chain') && /provided version doesn't match/i.test(message)
}

/** Retry one transaction factory after the load-balanced node catches its predecessor's receipt. */
export const retry_after_version_race = async <T>(
  transaction: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<T> => {
  try {
    return await transaction()
  } catch (error) {
    if (!pre_submission_version_race(error)) throw error
    await wait(VERSION_RACE_RETRY_MS)
    return transaction()
  }
}

/** Admit one promise immediately and reject duplicate gestures until it settles. */
export const create_single_flight = () => {
  let active: Promise<unknown> | null = null
  return <T>(action: () => Promise<T>): Promise<T> | null => {
    if (active) return null
    const transaction = Promise.resolve()
      .then(action)
      .finally(() => {
        if (active === transaction) active = null
      })
    active = transaction
    return transaction
  }
}

/** One tab-wide player-gesture lane. It survives component unmounts and page switches. */
export const run_direct_transaction = create_single_flight()
