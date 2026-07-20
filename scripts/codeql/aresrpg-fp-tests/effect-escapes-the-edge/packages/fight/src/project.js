// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN — read-side projections use the same param-default edge convention as the door.
export const can_act = (state, now = Date.now()) => now - state.turn_start > 3000
