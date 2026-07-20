// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// ADMIN teardown composers. Both Move doors consume a shared object BY VALUE and require the caller's AdminCap
// plus the core Version. `burn_mob_template` lives beside MobTemplate rather than in `admin`: MobTemplate's module
// already imports AdminCap, and Move forbids the reverse module dependency. Authority and behavior are unchanged.

/**
 * Delete a MobTemplate after its dynamic-free blueprint has been retired from live references. The Move door
 * verifies AdminCap + latest Version and reclaims the shared object's storage rebate.
 * @param {import("../../../types.js").Context} context
 */
export function burn_mob_template_ptb(context) {
  const { network } = context
  return ({ admin_cap_id, mob_template_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!admin_cap_id || !mob_template_id)
      throw new Error(
        '[burn_mob_template_ptb] admin_cap_id and mob_template_id are required.',
      )
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::mob_template::burn_mob_template`,
      arguments: [
        as_object_arg(tx, admin_cap_id),
        as_object_arg(tx, mob_template_id),
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION),
      ],
    })
    return tx
  }
}

/**
 * Delete a paused shop Sale. Move enforces the pause precondition in addition to AdminCap + latest Version.
 * @param {import("../../../types.js").Context} context
 */
export function burn_sale_ptb(context) {
  const { network } = context
  return ({ admin_cap_id, sale_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!admin_cap_id || !sale_id)
      throw new Error('[burn_sale_ptb] admin_cap_id and sale_id are required.')
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::shop::burn_sale`,
      arguments: [
        as_object_arg(tx, admin_cap_id),
        as_object_arg(tx, sale_id),
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION),
      ],
    })
    return tx
  }
}
