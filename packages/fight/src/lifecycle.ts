// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** The chain clock has millisecond resolution; adjacent fast turns may share a timestamp. */
export const fight_turn_identity = (
  contract: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }>
): string => `${String(contract.round)}:${String(contract.turn_ptr)}:${String(contract.turn_started_ms)}`

export const same_fight_turn = (
  left: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }> | undefined,
  right: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }>
): boolean => left !== undefined && fight_turn_identity(left) === fight_turn_identity(right)

export const end_turn_submission_after_reconcile = (
  previous: Readonly<{ end_turn_submitted: boolean }>,
  same_turn: boolean,
  ended: boolean
): boolean => previous.end_turn_submitted && (same_turn || ended)
