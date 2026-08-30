// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- The Move twin updates only its reducer-owned structuredClone draft. */

import { emit } from './runtime.ts'
import type { BoardZone, FightRuntime } from './types.ts'

/** A dead or departed owner cannot retain a zone: dead seats never receive another duration tick,
 * and every later trigger still needs its source fighter. */
export const drop_owned_zones = (runtime: FightRuntime, owner: bigint, reason: string): void => {
  const kept: BoardZone[] = []
  const kept_ids: string[] = []
  runtime.contract.zones.forEach((zone, index) => {
    if (zone.owner_fighter === owner) {
      emit(runtime, 'zone_removed', {
        zone_id: runtime.render_ids.zones[index],
        kind: zone.trap ? 'trap' : 'glyph',
        reason,
      })
    } else {
      kept.push(zone)
      kept_ids.push(runtime.render_ids.zones[index])
    }
  })
  runtime.contract.zones = kept
  runtime.render_ids.zones = kept_ids
}
