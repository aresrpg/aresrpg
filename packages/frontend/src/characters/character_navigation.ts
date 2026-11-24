// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const DETAIL_TABS = ['equipment', 'stats', 'spells', 'jobs', 'runeforge'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]
