// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_object_json, to_bigint } from './_object.js'

// AIRDROP chain-direct READ (pre-flight). Owner display data + the drop's live counters; the sidebar page is
// projected by the packages/rpc `/v1` indexer (a separate lane). Per-address eligibility is a whitelist Table
// dynamic-field lookup — the frontend proves it against the published snapshot, not this read.

/**
 * Read a shared `Airdrop` object → { id, template, name, description, minted, eligible_count }. Returns null on
 * ABSENCE; a FAILED read throws (#2054). (`eligible_count` is the whitelist Table's live size.)
 * @param {import("../../../types.js").Context} context
 */
export function get_airdrop({ grpc_client }) {
  return async airdrop_id => {
    const json = await get_object_json(grpc_client, airdrop_id)
    if (!json) return null // ABSENT airdrop
    return {
      id: airdrop_id,
      template: json.template,
      name: json.name,
      description: json.description,
      minted: to_bigint(json.minted),
      eligible_count: to_bigint(json.whitelist?.size),
    }
  }
}
