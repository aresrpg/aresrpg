// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pre_submission_failure, world_travel_refusal } from '@aresrpg/sdk/transaction-error'

/** Only an unsigned timing refusal can offer another attempt; no gas or signature was spent. */
export const world_action_failure = (error: unknown, monotonic_ms: number): Readonly<{ retry_at_ms?: number }> =>
  pre_submission_failure(error) && world_travel_refusal(error) ? { retry_at_ms: monotonic_ms + 500 } : {}
