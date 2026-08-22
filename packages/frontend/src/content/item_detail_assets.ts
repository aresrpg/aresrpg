// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Sui Display and the app share one stable HD URL. The build derives that public tree from seed/;
// items without authored art retain the same null fallback as every thumbnail surface.

import { item_icon } from './assets.ts'

export const item_detail_icon = (item_type: string): string | null =>
  item_icon(item_type) ? `/item/${item_type}_hd.png` : null
