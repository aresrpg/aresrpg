// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_object_json, balance_value, to_bigint } from './_object.js'

// KOLIZEUM READS for `aresrpg_kolizeum` — the live lobby state a consumer needs to render / gate join/exit. Status is
// the u8 enum (0 OPEN · 1 STARTED · 2 SETTLED · 3 CANCELLED — mirror `status_*` getters).

export const KOLIZEUM_STATUS = {
  OPEN: 0,
  STARTED: 1,
  SETTLED: 2,
  CANCELLED: 3,
}

/**
 * A `Kolizeum` snapshot: creator + status + format + economics (pledge/pot) + gating (level diff, allowlist) + the two
 * side rosters (per seat: owner, character, level). Null if unreadable.
 * @param {import("../../../types.js").Context} context
 */
export function get_kolizeum(context) {
  const { grpc_client } = context
  return async kolizeum_id => {
    const json = await get_object_json(grpc_client, kolizeum_id)
    if (!json) return null
    const seats = side =>
      (Array.isArray(json[side]) ? json[side] : []).map(f => ({
        owner: f.owner,
        character: f.character,
        level: to_bigint(f.level),
        join_order: to_bigint(f.join_order),
      }))
    return {
      id: json.id,
      creator: json.creator,
      status: Number(json.status ?? 0),
      format_slots: to_bigint(json.format_slots),
      pledge_amount: to_bigint(json.pledge_amount),
      pot: balance_value(json.pot),
      is_public: Boolean(json.is_public),
      max_level_diff: to_bigint(json.max_level_diff),
      creator_level: to_bigint(json.creator_level),
      allow: Array.isArray(json.allow) ? json.allow : [],
      side_a: seats('side_a'),
      side_b: seats('side_b'),
    }
  }
}
