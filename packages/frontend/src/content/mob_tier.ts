// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Authored mob-tier semantics, shared by the ruled world-card composition and encyclopedia projection.
// Keep this pure: spawn_compose.js is a headless chain twin and must not import the deployment receipt itself.

/** The single display predicate for authored archi-tier MobTemplates. */
export const is_archi_tier = (tier: string | null | undefined): boolean => tier?.toLowerCase() === 'archi'
