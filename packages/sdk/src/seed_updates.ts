// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Transaction } from '@mysten/sui/transactions'

import type { Resolvable } from './client.ts'
import { board_value, bounded_transaction, content_root_id_of, pack, package_id_of, seed_sdk } from './seed.ts'
import { board_catalog_id } from './seed_ids.ts'
import type { SeedSyncRow } from './seed_sync.ts'

export type SeedUpdateBatch = Readonly<{
  transaction: Transaction
  written: readonly string[]
}>

/** Mutable rows packed into resumable receipt boundaries. */
export const seed_update_batches = (
  sdk_in: Parameters<typeof seed_sdk>[0],
  rows: readonly SeedSyncRow[],
  context: Readonly<{ admin_cap: Resolvable; content_root: Resolvable }>,
  boards: Readonly<{ chain_len: number; authored_len: number }> = { chain_len: 0, authored_len: 0 }
): readonly SeedUpdateBatch[] => {
  const sdk = seed_sdk(sdk_in)
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const catalog = board_catalog_id(content_root, seed_original)
  const updates = pack(
    rows,
    ({ cost }) => cost,
    undefined,
    ({ label }) => label
  ).map((group, index) => {
    const transaction = sdk.tx()
    for (const row of group) {
      if (row.kind === 'board' && Number(row.key.slice('board:'.length)) >= boards.chain_len && row.board_source) {
        const board = board_value(sdk, transaction, row.board_source)
        sdk.seed_doors.add_board(transaction, { cap: context.admin_cap, root: context.content_root, catalog, board })
      } else row.update?.(sdk, transaction, context.admin_cap, context.content_root)
    }
    return Object.freeze({
      transaction: bounded_transaction(transaction, `changes:${index}`),
      written: Object.freeze(group.map(({ key }) => key)),
    })
  })
  if (boards.chain_len <= boards.authored_len) return updates
  const transaction = sdk.tx()
  let remaining = boards.chain_len - boards.authored_len
  while (remaining > 0) {
    sdk.seed_doors.remove_last_board(transaction, { cap: context.admin_cap, root: context.content_root, catalog })
    remaining -= 1
  }
  return Object.freeze([
    ...updates,
    Object.freeze({
      transaction: bounded_transaction(transaction, 'boards:remove'),
      written: Object.freeze(
        Array.from(
          { length: boards.chain_len - boards.authored_len },
          (_, index) => `board:${boards.authored_len + index}`
        )
      ),
    }),
  ])
}
