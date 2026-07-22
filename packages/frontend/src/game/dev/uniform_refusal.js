// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const uniform_refusal_sample_size = 5

/**
 * Return the exact refusal shared by the complete initial sample, or null when the sample is incomplete/mixed.
 * @param {string[]} refusal_reasons
 * @param {number} sample_size
 */
export function first_uniform_refusal(refusal_reasons, sample_size = uniform_refusal_sample_size) {
  if (sample_size < 1 || refusal_reasons.length < sample_size) return null
  const first_reason = refusal_reasons[0]
  return refusal_reasons.slice(1, sample_size).every((reason) => reason === first_reason) ? first_reason : null
}
