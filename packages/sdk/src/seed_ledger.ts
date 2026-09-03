// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedLedger, SeedSyncRow } from './seed_sync.ts'

const ledger_entry = (row: SeedSyncRow, revision: (id: string) => string | null = () => null): SeedLedger[string] => {
  const revisions = Object.fromEntries(
    row.addresses.flatMap((address) => {
      const value = revision(address)
      return value ? [[address, value] as const] : []
    })
  )
  return Object.freeze({
    hash: row.hash,
    label: row.label,
    addresses: row.addresses,
    ...(Object.keys(revisions).length === row.addresses.length ? { revisions: Object.freeze(revisions) } : {}),
    domain: row.domain,
    ...(row.item ? { item: row.item } : {}),
    ...(row.spell ? { spell: row.spell } : {}),
    ...(row.world ? { world: row.world } : {}),
  })
}

/** Persistable progress after exactly one certified mutable-content transaction. */
export const seed_ledger_after_batch = (
  rows: readonly SeedSyncRow[],
  ledger: SeedLedger,
  written: readonly string[],
  revision: (id: string) => string | null = () => null
): SeedLedger => {
  const next: Record<string, SeedLedger[string]> = { ...ledger }
  const by_key = new Map(rows.map((row) => [row.key, row] as const))
  for (const key of written) {
    const row = by_key.get(key)
    if (row) next[key] = ledger_entry(row, revision)
    else delete next[key]
  }
  return Object.freeze(next)
}

/** The ledger as it stands after a successful apply. */
export const seed_ledger_after = (
  rows: readonly SeedSyncRow[],
  ledger: SeedLedger,
  written: ReadonlySet<string>,
  exists: (id: string) => boolean,
  revision: (id: string) => string | null = () => null
): SeedLedger =>
  Object.freeze(
    Object.fromEntries(
      rows
        .filter((row) => written.has(row.key) || (exists(row.chain_id) && ledger[row.key]?.hash === row.hash))
        .map((row) => [row.key, ledger_entry(row, revision)])
    )
  )
