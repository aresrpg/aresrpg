// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * Start the authoritative fight-engage task before its presentation. `present` only launches the visual beat;
 * its animation lifetime is deliberately absent from the returned task, so an authoritative state change can
 * mount the board while that beat is still running.
 * Presentation failures are reported but cannot replace the already-started authoritative promise.
 * @template T
 * @param {{ submit: () => Promise<T>, present: () => void,
 *   on_present_error: (error: unknown) => void }} effects
 * @returns {Promise<T>}
 */
export function start_fight_engage({ submit, present, on_present_error }) {
  const submitted = submit()
  try {
    present()
  } catch (error) {
    try {
      on_present_error(error)
    } catch {
      // Even a broken diagnostic sink cannot orphan a transaction that is already in flight.
    }
  }
  return submitted
}
