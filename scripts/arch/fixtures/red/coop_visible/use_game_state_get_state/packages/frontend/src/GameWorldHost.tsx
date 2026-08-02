// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — useGameState.getState() bypasses the canonical coop-visible projection.
export const read = () => useGameState.getState()
