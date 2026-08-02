// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — useGameState(...) bypasses the canonical coop-visible projection.
export const read = () => useGameState((state) => state.selected_character_id)
