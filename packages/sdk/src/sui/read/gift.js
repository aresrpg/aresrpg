// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_object_json, balance_value } from './_object.js'

// GIFT chain-direct READ (pre-flight). The live inbox is projected by the packages/rpc `/v1` indexer (a separate
// lane); this is the thin object-parse a claim/recall pre-flight uses to learn the gift's sender kiosk + items.

/**
 * Read a shared `Gift` object → { id, sender, recipient, item_ids, sender_kiosk_id, royalty_value }. The
 * sender_kiosk_id (which `gift_claim_ptb` needs) is read off the escrowed caps (all share one sender kiosk).
 * Returns null on absence.
 * @param {import("../../../types.js").Context} context
 */
export function get_gift({ grpc_client }) {
  return async gift_id => {
    const json = await get_object_json(grpc_client, gift_id)
    if (!json) return null
    const caps = Array.isArray(json.caps) ? json.caps : []
    return {
      id: gift_id,
      sender: json.sender,
      recipient: json.recipient,
      item_ids: caps.map(cap => cap.item_id),
      sender_kiosk_id: caps.length ? caps[0].kiosk_id : null,
      royalty_value: balance_value(json.royalty),
    }
  }
}
