// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// DUNGEON PTB BUILDERS for the merged `aresrpg` package's `dungeon`.
//
/**
 * ABANDON a character-bound RunPass. The kiosk proof lets Move restore the exact locked character to the run's
 * recorded world before consuming the pass; GameConfig carries the pinned dungeon brand gate.
 * @param {import("../../../types.js").Context} context
 */
export function abandon_ptb(context) {
  const { network } = context
  return ({
    run_pass_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.DUNGEON_PACKAGE_ID}::dungeon::abandon`,
      arguments: [
        as_object_arg(tx, run_pass_id),
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG),
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION),
      ],
    })
    return tx
  }
}
