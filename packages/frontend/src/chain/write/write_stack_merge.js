// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1495 — the SUBMIT half of the boot stack sweep: a plan (world-shell/auto_merge_stacks.js) in, the
// transaction receipt out. One PTB, one signature, through the SAME gameplay door every other player action
// uses (world-shell/tx.js run_tx → the S-54 simulate-refuse choke → sponsor-first for a zkLogin session).
//
// The PTB itself is the SDK's (`merge_stacks_ptb` — a loop over the proven single-pair composer); nothing
// about the Move call shape is re-derived here. The sweep names an `intent` and declares itself `automated`
// so the mechanical spend guard owns its blast radius like every other system-owned submission.

import { use_auth } from '../../auth'
import { run_tx } from '../../world-shell/tx'
import { get_sdk } from '../sdk'
import { get_personal_cap } from '../kiosk_cap_cache'

/**
 * @param {{ kiosk_id: string, target_item_id: string, source_item_id: string }[]} merges
 * @returns {Promise<any>} the normalized receipt (its `item::ItemMerged` events are the bag's fold input)
 */
export async function submit_stack_merges(merges) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const sdk = await get_sdk()

  // Each planned pair already shares ONE kiosk (the plan groups by it); resolve that kiosk's personal cap
  // through the warm session cache every other write reads — never the indexer-supplied cap id, which is not
  // the authority on what this wallet may sign with.
  const caps = await Promise.all(merges.map((merge) => get_personal_cap(sdk, address, merge.kiosk_id)))
  const composed = merges.flatMap((merge, index) => {
    const cap = caps[index]
    if (!cap) return []
    return [
      {
        kiosk_id: cap.kioskId,
        personal_kiosk_cap_id: cap.objectId,
        target_item_id: merge.target_item_id,
        source_item_id: merge.source_item_id,
      },
    ]
  })
  if (!composed.length) throw new Error('No personal kiosk cap for the planned stack merges')

  const { result } = await run_tx('merge_stacks', sdk.merge_stacks_ptb({ merges: composed }), undefined, undefined, {
    queued: true,
    intent: `merge_stacks:${composed[0].target_item_id}`,
    automated: true,
  })
  return result
}
