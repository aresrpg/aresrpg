// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export function reconcile_beta(snapshot) {
  const { active } = snapshot
  const { balance } = snapshot
  if (!active) return snapshot
  const advanced = balance + 1
  const bounded = Math.min(advanced, 999)
  const updated = { ...snapshot, balance: bounded }
  updated.active = bounded > 100
  updated.label = 'alpha-state'
  return updated
}
