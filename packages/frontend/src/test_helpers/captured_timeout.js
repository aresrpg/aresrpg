// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * Capture the one timeout synchronously armed by a test action, restoring the process timer before
 * returning. The callback can then be fired deterministically without leaving a fake timer visible to
 * another test file.
 *
 * @param {() => void} arm
 * @returns {{ delay_ms: number, fire: () => void }}
 */
export const capture_timeout = (arm) => {
  const real_set_timeout = globalThis.setTimeout
  /** @type {{ delay_ms: number, fire: () => void } | null} */
  let captured = null

  globalThis.setTimeout = /** @type {typeof setTimeout} */ (
    (handler, delay_ms, ...args) => {
      if (captured) throw new Error('expected exactly one timeout')
      if (typeof handler !== 'function') throw new Error('expected a function timeout handler')
      captured = { delay_ms: Number(delay_ms ?? 0), fire: () => handler(...args) }
      return /** @type {ReturnType<typeof setTimeout>} */ (/** @type {unknown} */ (0))
    }
  )

  try {
    arm()
  } finally {
    globalThis.setTimeout = real_set_timeout
  }

  if (!captured) throw new Error('expected the action to arm a timeout')
  return captured
}
