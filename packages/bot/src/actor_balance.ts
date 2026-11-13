// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Sdk } from '@aresrpg/sdk'

/** Preserve the SDK sample's age across its cache; actor time is monotonic. */
export const read_actor_balance = async (
  sdk: Pick<Sdk, 'read_sui_balance_snapshot'>,
  monotonic_now: () => number,
  report_failure: (error: unknown) => void
) => {
  try {
    const sample = await sdk.read_sui_balance_snapshot()
    if (!sample) return null
    const sampled_clock_ms = performance.now()
    const mono_ms = monotonic_now()
    return {
      address: sample.address,
      balance_mist: sample.balance_mist,
      sampled_at: mono_ms - (sampled_clock_ms - sample.sampled_at_ms),
      expires_at: mono_ms + (sample.expires_at_ms - sampled_clock_ms),
    }
  } catch (error) {
    report_failure(error)
    return null
  }
}
