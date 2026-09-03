// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  pre_submission_close_projection_lag,
  pre_submission_version_race,
  readable_transaction_error,
} from '@aresrpg/sdk/transaction-error'

const VERSION_RACE_RETRY_MS = 250
const CLOSE_PROJECTION_RETRY_MS = Object.freeze([250, 500, 1_000])

export { pre_submission_version_race, readable_transaction_error }

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

export const retry_close_after_projection_lag = async <T>(
  transaction: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<T> => {
  let last_error: unknown = new Error('Fight cleanup did not execute')
  for (const delay of [0, ...CLOSE_PROJECTION_RETRY_MS]) {
    if (delay > 0) await wait(delay)
    try {
      return await transaction()
    } catch (error) {
      if (!pre_submission_close_projection_lag(error)) throw error
      last_error = error
    }
  }
  throw last_error
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
