// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * Run a composed character-delete PTB through the caller's standard transaction pipeline exactly once.
 * This boundary deliberately owns no fallback or retry: once execution was attempted, only the player may
 * choose a new transaction after seeing the failure.
 * @param {any} transaction
 * @param {(label: string, transaction: any) => Promise<any>} execute
 * @returns {Promise<any>}
 */
export function execute_character_delete_once(transaction, execute) {
  return execute('character_delete', transaction)
}
