// PURE loot-box pool display math (no React / no RPC / no window) — the shop's drop-rate transparency panel
// shows every possible pet with its % chance listed. weight -> percent-of-pool mirrors
// loot_box.move's `pick()` denominator exactly: a row's weight over the pool's total weight (see
// aresrpg/sources/loot_box.move `total_weight`/`pick`). Import-free on purpose (same reason lootbox_util.js
// stays import-free) so bun:test can exercise it directly.

export type LootPoolRow = { pet: string; weight: number }
export type LootPoolDisplayRow = LootPoolRow & { percent: number }

/**
 * weight -> percent of the pool's total weight, rounded to ONE decimal. A
 * zero-total pool (never happens on-chain — admin_set_loot_table refuses EZeroWeight) returns 0 for every row
 * instead of dividing by zero. PURE.
 */
export function pool_with_percent(pool: LootPoolRow[]): LootPoolDisplayRow[] {
  const total = pool.reduce((sum, row) => sum + row.weight, 0)
  return pool.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((row.weight / total) * 1000) / 10 : 0,
  }))
}
