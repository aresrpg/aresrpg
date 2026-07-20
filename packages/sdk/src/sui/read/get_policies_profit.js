// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #23 gRPC: getObjects entries are `Object|Error`; json:true exposes the TransferPolicy's `balance` field directly.
const balance = result => (result instanceof Error ? 0 : result.json?.balance)

/** @param {import("../../../types.js").Context} context */
export function get_policies_profit({ grpc_client, kiosk_client, types }) {
  return async address => {
    const { objects } = await grpc_client.core.getObjects({
      objectIds: [types.LEGACY_ITEM_POLICY, types.LEGACY_CHARACTER_POLICY],
      include: { json: true },
    })
    const [item_policy, character_policy] = objects

    const [character_policy_cap] =
      await kiosk_client.getOwnedTransferPoliciesByType({
        type: `${types.LEGACY_PACKAGE_ID}::character::Character`,
        address,
      })

    const [item_policy_cap] = await kiosk_client.getOwnedTransferPoliciesByType(
      {
        type: `${types.LEGACY_PACKAGE_ID}::item::Item`,
        address,
      },
    )

    return {
      is_owner: !!(character_policy_cap && item_policy_cap),
      character_profits: balance(character_policy),
      item_profits: balance(item_policy),
    }
  }
}
