// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { changed_object_ids, receipt_event, receipt_events } from './cache.ts'
import type { Receipt } from './client.ts'
import { event_integer, event_string } from './receipt_decode.ts'

export const LOOT_BOX_BATCH_LIMIT = 50
export type BoxRoll = Readonly<{ claim_id: string; rolled_template: string; amount: number }>

/** The batch event binds ordered reveal events to their actual claim IDs, never object-change order. */
export const box_rolls = (receipt: Receipt, template: string, count: number): readonly BoxRoll[] => {
  const batch = receipt_event(receipt, '::loot_box::LootBoxesOpened')
  if (!batch) throw new Error('The open receipt has no batch event')
  const ids = batch.claim_ids
  const events = receipt_events(receipt, '::loot_box::LootBoxOpened')
  const claims = new Set(changed_object_ids(receipt, '::loot_box::BoxClaim'))
  if (batch.box_template !== template || !Array.isArray(ids) || ids.length !== count || events.length !== count)
    throw new Error('The open receipt does not match the reviewed batch')
  if (new Set(ids).size !== count || !ids.every((id) => typeof id === 'string' && claims.has(id)))
    throw new Error('The open receipt has invalid claim identities')
  return events.map((event, index) => {
    const amount = event_integer(event, 'amount')
    if (event.box_template !== template || amount === 0) throw new Error('The open receipt has an invalid reward')
    return { claim_id: ids[index] as string, rolled_template: event_string(event, 'rolled_template'), amount }
  })
}
