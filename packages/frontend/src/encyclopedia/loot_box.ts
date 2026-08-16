// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const loot_box_is_random = (rewards: readonly Readonly<{ weight: number }>[]): boolean =>
  rewards.length !== 1 || rewards[0]!.weight <= 0
