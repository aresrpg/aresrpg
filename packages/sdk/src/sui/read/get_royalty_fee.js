// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'

// royalty_rule::Config — the DF value struct behind a TransferPolicy's RuleKey<royalty_rule::Rule>.
// amount_bp (u16) is the royalty fee in basis points; min_amount (u64) is unused here.
const ROYALTY_CONFIG = bcs.struct('Config', {
  amount_bp: bcs.u16(),
  min_amount: bcs.u64(),
})

/** @param {import("../../../types.js").Context} context */
export function get_royalty_fee({ grpc_client, kiosk_client }) {
  return async item_type => {
    try {
      const [policy] = await kiosk_client.getTransferPolicies({
        type: item_type,
      })
      // #23 gRPC: listDynamicFields → { dynamicFields:[{ name:{type,bcs}, fieldId }] } (was the jsonRpc dynamic-field listing → { data }).
      const { dynamicFields } = await grpc_client.core.listDynamicFields({
        parentId: policy.id,
      })
      const entry = dynamicFields.find(field =>
        field.name.type.includes('royalty_rule'),
      )
      if (!entry) return null

      // #23 gRPC: getDynamicField returns the BCS-encoded value (was the jsonRpc DF-object read → parsed content.fields).
      // Pass the entry's exact name (type + bcs bytes), then BCS-decode royalty_rule::Config to read amount_bp.
      const { dynamicField } = await grpc_client.core.getDynamicField({
        parentId: policy.id,
        name: { type: entry.name.type, bcs: entry.name.bcs },
      })
      if (!dynamicField?.value?.bcs) return null
      return ROYALTY_CONFIG.parse(dynamicField.value.bcs).amount_bp
    } catch (error) {
      console.error(error)
      return null
    }
  }
}
