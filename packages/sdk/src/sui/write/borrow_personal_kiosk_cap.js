// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { aresrpg_deployment } from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

import { new_ptb } from './header.js'

// KIOSK-RULE-LINKAGE LAW — the same law items_creation.js's `personal_kiosk_call_client` enforces for the
// create-or-borrow dance, applied HERE for the borrow/return dance (this file's whole reason to exist, and the
// ONE choke point every borrow/return dance in the SDK goes through: items_extract.js equip/unequip,
// kolizeum_lobby.js create/join, dungeon.js activate, sui.js's raw export — none of them keep a second copy of
// the dance). Every current caller fires an aresrpg MoveCall INSIDE `handler`, between borrow_val and
// return_val — a PTB that calls `personal_kiosk::*` ALONGSIDE an aresrpg MoveCall MUST target the id the aresrpg
// package's own linkage table binds (KIOSK_ROYALTY_RULE_PACKAGE_ID — the forked kiosk-rules/personal-kiosk
// lineage's UPGRADED id), or the two kiosk-lineage versions collide and the mixed tx aborts `InvalidLinkage` at
// the first aresrpg command. Resolved UNCONDITIONALLY below so every caller is safe by construction, whether or
// not IT happens to mix in an aresrpg call today — harmless for callers that don't. Marketplace callers may pass
// the already-resolved policy linkage target explicitly; every other flow uses the same ceremony-stamped deployment
// value. There is deliberately no getRulePackageId fallback: its defining/original id is not a linkage-safe target.

/**
 * `personal_kiosk_cap_id` rides the ref-or-id seam (S-51b): an id string or a cached owned ref
 * `{objectId, version, digest}` — the soulbound cap is OWNED, so its ref moves on every mutation.
 * @param {import("../../../types.js").Context} context
 */
export function borrow_personal_kiosk_cap(context) {
  const { network } = context
  return ({
    personal_kiosk_cap_id,
    personal_kiosk_package_id = null,
    tx = new_ptb(context.network, context.ids?.aresrpg),
    handler,
  }) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    const package_id =
      personal_kiosk_package_id ?? dep.KIOSK_ROYALTY_RULE_PACKAGE_ID
    if (!package_id)
      throw new Error(
        `[borrow_personal_kiosk_cap] kiosk linkage package is not stamped for "${network}"`,
      )

    const personal_kiosk_cap_ref = as_object_arg(tx, personal_kiosk_cap_id)

    const [kiosk_cap, promise] = tx.moveCall({
      target: `${package_id}::personal_kiosk::borrow_val`,
      arguments: [personal_kiosk_cap_ref],
    })

    handler(kiosk_cap)

    tx.moveCall({
      target: `${package_id}::personal_kiosk::return_val`,
      arguments: [personal_kiosk_cap_ref, kiosk_cap, promise],
    })

    return tx
  }
}
