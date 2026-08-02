// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — use_dungeon(...) bypasses the canonical coop-visible projection.
export const read = () => use_dungeon((state) => state.dungeon_id)
