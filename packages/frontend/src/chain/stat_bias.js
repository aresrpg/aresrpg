// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The app's item-stat wire door: read_templates decodes centered u16 values and write_templates encodes them.
// The inverses are pinned in stat_bias.test.js; the numeric home is @aresrpg/sim/equipment_stats.
import { ITEM_STAT_SHIFT as STAT_BIAS } from '@aresrpg/sim/equipment_stats'

export { STAT_BIAS }

/** biased u16 (on-chain) → real signed delta. */
export const decode_stat = (v) => Number(v) - STAT_BIAS

/** real signed delta → biased u16 (on-chain). */
export const encode_stat = (v) => Number(v) + STAT_BIAS
