// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CELESTIAL_CYCLE_MS, MIDDAY_TIME_OF_DAY } from '@aresrpg/engine'

/** One phase drives both world lighting and the compass. */
export const world_daylight = (now: number, pinned_time: number | null, cycle_enabled: boolean): number =>
  cycle_enabled ? (pinned_time ?? (now / CELESTIAL_CYCLE_MS + 0.31) % 1) : MIDDAY_TIME_OF_DAY
