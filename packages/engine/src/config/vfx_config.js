// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Fight VFX are authored once at pack intensity, then reduced exactly once before display-space additive
 *  accumulation. The gain lives on routed materials so both the post-AgX overlay and the bare-render
 *  resilience path consume the same transform; no quality tier owns a second emission table. Measured on the
 *  fight board with bolt_air/fire/water: 0.3 preserves coloured bodies and white-hot cores without blowout. */
export const FIGHT_VFX_OUTPUT_GAIN = 0.3
