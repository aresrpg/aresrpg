// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { derive_equipment_stats, fold_equipment_stats } from './views.js'

describe('fight-authoritative equipment aggregate', () => {
  test('subtracts active maluses from the positive cache without losing signed contributions', () => {
    const stats = fold_equipment_stats({ vitality: 7, strength: 5, action: 1 }, { vitality: 4, strength: 8, action: 0 })
    expect(stats).toMatchObject({ vitality: 3, strength: -3, action: 1 })
  })

  test('stays null until the positive EquipmentMap snapshot exists', () => {
    expect(fold_equipment_stats(null, { vitality: 4 })).toBeNull()
  })

  test('withholds an event-newer identity until the object snapshot catches up', () => {
    const character = {
      gear_positive: { vitality: 3 },
      gear_malus: { vitality: 0 },
      equipment_cursor: { checkpoint: 488, tx_index: 7 },
      gear_cursor: { checkpoint: 488, tx_index: 6 },
    }
    expect(derive_equipment_stats(character, 1)).toBeNull()
    expect(derive_equipment_stats({ ...character, gear_cursor: { checkpoint: 488, tx_index: 7 } }, 1)?.vitality).toBe(3)
  })
})
