// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Encyclopedia projection of the reducer-owned spell seat. Reconciliation lives in stores/spell_seat.ts.

import { use_spell_seat, type spell_character } from '../../stores/spell_seat'

export { load_spell_alloc as load_encyclopedia_spell_alloc } from '../../stores/spell_seat'

/**
 * The seat shape encyclopedia detail consumes. A live fight seat is already a composed snapshot and wins
 * immediately; outside a fight, the namespaced read is floored by any just-confirmed grimoire upgrade.
 */
export function use_encyclopedia_spell_seat(character: spell_character | null, fight_seat: any = null) {
  const { allocation } = use_spell_seat(character)
  return fight_seat ?? (character ? { spell_levels: allocation?.levels ?? {} } : null)
}
