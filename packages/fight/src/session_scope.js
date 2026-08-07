// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight session namespace's one classifier. The headless projection and each host shell import this same
// verdict instead of independently interpreting the `sim:` prefix.
export const fight_scope_world = 'world'
export const fight_scope_sim = 'sim'

/** @param {unknown} fight_id @returns {'world' | 'sim' | null} */
export const fight_scope_of_id = (fight_id) => {
  if (fight_id == null) return null
  return String(fight_id).startsWith('sim:') ? fight_scope_sim : fight_scope_world
}
