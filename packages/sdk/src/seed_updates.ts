// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Transaction } from '@mysten/sui/transactions'

import type { Resolvable } from './client.ts'
import {
  MAX_SEED_COMMANDS,
  board_value,
  bounded_transaction,
  content_root_id_of,
  pack,
  package_id_of,
  seed_sdk,
} from './seed.ts'
import { board_catalog_id } from './seed_ids.ts'
import type { SeedSyncRow } from './seed_sync.ts'

export type SeedUpdateBatch = Readonly<{
  build: () => Transaction
  written: readonly string[]
}>

/** Mutable rows packed into resumable receipt boundaries; owned refs resolve only at execution. */
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
  const setup_commands = sdk.tx().getData().commands.length
  const budget = MAX_SEED_COMMANDS - setup_commands
  const compose = (group: readonly SeedSyncRow[]): Transaction => {
    const transaction = sdk.tx()
    for (const row of group) {
      if (row.kind === 'board' && Number(row.key.slice('board:'.length)) >= boards.chain_len && row.board_source) {
        const board = board_value(sdk, transaction, row.board_source)
        sdk.seed_doors.add_board(transaction, { cap: context.admin_cap, root: context.content_root, catalog, board })
      } else row.update?.(sdk, transaction, context.admin_cap, context.content_root)
    }
    return transaction
  }
  // Measure real row commands instead of creation estimates; reserve transaction setup once.
  // Any additional shared commands deduplicate in a group, keeping this an upper bound.
  const updates = pack(
    rows,
    (row) => compose([row]).getData().commands.length - setup_commands,
    budget,
    ({ label }) => label
  ).map((group, index) =>
    Object.freeze({
      build: () => bounded_transaction(compose(group), `changes:${index}`),
      written: Object.freeze(group.map(({ key }) => key)),
    })
  )
  if (boards.chain_len <= boards.authored_len) return updates
  const removals = Array.from(
    { length: boards.chain_len - boards.authored_len },
    (_, index) => boards.chain_len - index - 1
  )
  const removed = pack(removals, () => 1, budget).map((group, index) =>
    Object.freeze({
      build: () => {
        const transaction = sdk.tx()
        for (const _board of group)
          sdk.seed_doors.remove_last_board(transaction, { cap: context.admin_cap, root: context.content_root, catalog })
        return bounded_transaction(transaction, `boards:remove:${index}`)
      },
      written: Object.freeze(group.map((board) => `board:${board}`)),
    })
  )
  return Object.freeze([...updates, ...removed])
}
