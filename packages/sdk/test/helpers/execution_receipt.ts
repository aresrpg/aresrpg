// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { TransactionDataBuilder } from '@mysten/sui/transactions'

import type { Receipt } from '../../src/cache.ts'

/** A fake fullnode response must still bind its digest to the bytes submitted to that fake. */
export const execution_receipt = (transaction: Uint8Array, source: Receipt = {}): Receipt => {
  const kind = source.FailedTransaction ? 'FailedTransaction' : 'Transaction'
  const result = source[kind] ?? {}
  return {
    ...source,
    $kind: kind,
    [kind]: {
      ...result,
      digest: TransactionDataBuilder.getDigestFromBytes(transaction),
      events: result.events ?? [],
      objectTypes: result.objectTypes ?? {},
      effects: {
        changedObjects: [],
        ...result.effects,
        status: { success: kind === 'Transaction', ...result.effects?.status },
      },
    },
  }
}
