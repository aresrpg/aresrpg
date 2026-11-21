// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Its own module so a consumer of one zone fact does not load the packet codecs and the fight package.

/** Zones are 512-block squares (zone.move ZONE_SIZE) — the tracking unit for everything. */
export const ZONE_SIZE = 512
