// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The gather ladder's RARE VARIANT join (§6 golden-gather): which live item IS the jackpot twin of a base
// resource. Existence-only linkage comes from `/v1/rare-links` (admin-authored on chain), the display row
// from the SAME `/v1/encyclopedia` items list every other encyclopedia surface joins against — so a link
// whose rare template has not snapshotted yet resolves to NOTHING and the table renders the honest gap,
// never a fabricated twin. Pure: no React, no RPC (loot.ts / recipes.ts idiom).

/** base resource template id -> the live rare-variant item row. */
export function rare_variants_by_base<T extends { template_id: string }>(
  rare_links: readonly { template_id: string; rare_template_id: string }[] | null | undefined,
  items: readonly T[] | null | undefined
): Map<string, T> {
  const by_template_id = new Map((items ?? []).map((item) => [item.template_id, item]))
  const by_base = new Map<string, T>()
  for (const link of rare_links ?? []) {
    const rare = by_template_id.get(link.rare_template_id)
    if (rare) by_base.set(link.template_id, rare)
  }
  return by_base
}
