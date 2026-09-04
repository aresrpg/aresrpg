// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const encyclopedia_item_path = (item_type: string): string =>
  `/encyclopedia/items/${encodeURIComponent(item_type)}`
