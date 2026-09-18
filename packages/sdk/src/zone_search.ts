// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pre_submission_failure, readable_transaction_error } from './transaction_error.ts'

/** A stale discovery view may target an already-created derived Zone. Only an unsigned
 * create refusal can switch to the existing object's refresh door; executed attempts never retry. */
export const search_existing_zone = async <T>(
  refresh: boolean,
  submit: (refresh: boolean) => Promise<T>
): Promise<T> => {
  try {
    return await submit(refresh)
  } catch (error) {
    const message = readable_transaction_error(error)
    if (
      refresh ||
      !pre_submission_failure(error) ||
      !message.includes('::derived_object::claim') ||
      !/EObjectAlreadyExists|Derived object is already claimed/.test(message)
    )
      throw error
    return submit(true)
  }
}
