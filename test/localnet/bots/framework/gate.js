// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const ENV_FAIL = 'ENV-FAIL'
export const PRODUCT_FAIL = 'PRODUCT-FAIL'

const failure = (error, failure_kind) => {
  const tagged = error instanceof Error ? error : new Error(String(error))
  tagged.failure_kind = failure_kind
  return tagged
}

export const exit_code_for = (failure_kind) => (failure_kind === ENV_FAIL ? 2 : 1)

/**
 * Boot is infrastructure: one failure gets one clean re-entry through the same boot function, while the
 * landed timeout helper bounds the complete two-attempt sequence. Keeping the bound outside the retry avoids
 * starting attempt two beside an attempt whose timeout race fired but whose process is still unwinding.
 */
export async function run_boot_gate({ boot, bound, timeout_ms, log = () => {} }) {
  try {
    return await bound(
      'fight-bot boot completes',
      async () => {
        try {
          return await boot()
        } catch (first_error) {
          log(`boot attempt 1/2 failed; retrying once: ${first_error.message}`)
          try {
            return await boot()
          } catch (second_error) {
            throw failure(second_error, ENV_FAIL)
          }
        }
      },
      timeout_ms
    )
  } catch (error) {
    throw failure(error, ENV_FAIL)
  }
}

/** A product leg never rerolls: its one bounded execution becomes one stable verdict row. */
export async function run_leg_gate({ name, run, input, bound, timeout_ms }) {
  const started_at = Date.now()
  try {
    const detail = await bound(`${name} leg completes`, () => run(input), timeout_ms)
    return { leg: name, ok: true, ms: Date.now() - started_at, detail }
  } catch (error) {
    const tagged = failure(error, PRODUCT_FAIL)
    return {
      leg: name,
      ok: false,
      ms: Date.now() - started_at,
      failure_kind: tagged.failure_kind,
      error: tagged.message,
    }
  }
}
