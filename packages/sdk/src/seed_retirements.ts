// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Transaction } from '@mysten/sui/transactions'

import type { Resolvable } from './client.ts'
import type { SeedSdk } from './seed.ts'
import type { SeedLedger, SeedSyncRow } from './seed_sync.ts'

type LedgerEntry = SeedLedger[string]

const row = (
  key: string,
  label: string,
  domain: 'mastery_offer' | 'recipe',
  update: (sdk: SeedSdk, tx: Transaction, cap: Resolvable, root: Resolvable) => void
): SeedSyncRow =>
  Object.freeze({
    key,
    label: `retire ${label}`,
    hash: 'retired',
    kind: 'template',
    domain,
    chain_id: key,
    addresses: Object.freeze([key]),
    hydrate: Object.freeze([key]),
    cost: 1,
    update,
  })

export const retired_seed_row = (key: string, entry: LedgerEntry): SeedSyncRow | null => {
  if (entry.domain === 'mastery_offer' || entry.label.startsWith('mastery offer '))
    return row(key, entry.label, 'mastery_offer', (sdk, tx, cap, root) =>
      sdk.seed_doors.set_mastery_offer(tx, { cap, root, offer: key, cost: 1, enabled: false })
    )
  if (entry.domain === 'recipe' || entry.label.startsWith('recipe '))
    return row(key, entry.label, 'recipe', (sdk, tx, cap, root) =>
      sdk.seed_doors.retire_recipe(tx, { cap, root, recipe: key })
    )
  return null
}
