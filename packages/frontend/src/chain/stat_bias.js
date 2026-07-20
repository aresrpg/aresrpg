// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SINGLE HOME for the on-chain item-stat bias. item_stats.move stores every ItemStatistics field as a u16
// CENTERED at 32768 (`// All values centered at SHIFT_U16 (32768)`), so the unsigned int can carry a signed
// delta: 32768 = 0, 32773 = +5, 32763 = -5, and the sentinel [32768,32768] = a fixed "no bonus" stat.
//
// The READ path (read_templates.js normalize_item_template) DECODES on read so statsJson is real-valued
// everywhere in the app; the WRITE path (write_templates.js mint_item_template) ENCODES right before the PTB.
// These two are exact inverses (proven in stat_bias.test.js) so a read→edit-nothing→write round-trips to
// byte-identical on-chain stats. This is the ONLY place the 32768 constant may live — no display-layer decode.
export const STAT_BIAS = 32768

/** biased u16 (on-chain) → real signed delta. */
export const decode_stat = (v) => Number(v) - STAT_BIAS

/** real signed delta → biased u16 (on-chain). */
export const encode_stat = (v) => Number(v) + STAT_BIAS
