// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Public discovery expires from birth; custody and settlement never expire with it. */
export const FIGHT_DISCOVERY_MAX_AGE_MS = 60 * 60 * 1000

export const fight_discoverable = (fight: Readonly<{ placement_ms: string | number }>, now_ms: number): boolean =>
  now_ms - Number(fight.placement_ms) <= FIGHT_DISCOVERY_MAX_AGE_MS
