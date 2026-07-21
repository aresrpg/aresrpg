// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure view-model for a queued damage/heal beat. Keeping this outside voxel_fight_adapter's runtime graph lets
// the draft-preview unit prove the exact renderer input: `kind: crit` is the engine's house amber/orange number.

/**
 * @param {{ damage?: number, heal?: number, is_critical?: boolean }} event
 * @returns {{ amount: number, kind: 'damage'|'heal'|'crit', text: string }}
 */
export const damage_floater = (event) => {
  const amount = Math.max(0, Number(event.damage ?? event.heal ?? 0))
  const kind = event.heal != null ? 'heal' : event.is_critical ? 'crit' : 'damage'
  return { amount, kind, text: `${kind === 'heal' ? '+' : '-'}${amount}` }
}
