// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Runtime consumers and release fingerprints share these projections of the authored locales.
export const allocation_locale = <Copy>(document: Readonly<{ allocation_page: Copy }>): Copy => document.allocation_page

export const notification_locale = <Copy>(
  document: Readonly<{ discord_marketplace?: Copy; simulator_page: Readonly<Record<string, string>> }>
) => ({
  copy: document.discord_marketplace,
  stats: Object.fromEntries(
    Object.entries(document.simulator_page)
      .filter(([key]) => key.startsWith('stat_'))
      .map(([key, value]) => [key.slice(5), value])
  ),
})
