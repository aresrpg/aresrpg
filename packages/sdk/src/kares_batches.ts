// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Application bound, below PTB argument/object caps; exact gas still comes from the resolver. */
export const KARES_BATCH_SIZE = 50

/** Each batch is separately reviewed and submitted; planning never drops the remaining rows. */
export const plan_kares_batches = <T extends Readonly<{ id: string }>>(
  rows: readonly T[]
): readonly (readonly T[])[] => {
  const ordered = rows.toSorted((left, right) => left.id.localeCompare(right.id))
  return Array.from({ length: Math.ceil(ordered.length / KARES_BATCH_SIZE) }, (_, index) =>
    ordered.slice(index * KARES_BATCH_SIZE, (index + 1) * KARES_BATCH_SIZE)
  )
}

export const require_kares_batch = (count: number): void => {
  if (count > KARES_BATCH_SIZE) throw new Error(`Select a KARES batch of at most ${KARES_BATCH_SIZE} positions`)
}
