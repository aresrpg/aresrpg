// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure economy helpers for the ceremony seeder (seed_full_corpus.mjs) — extracted so the MONEY-PATH conversions
// are unit-testable in isolation (no chain deps, no client.js). Two ceremony-blocking bugs live here:
//   • shop prices are authored in SUI but shop::create_sale takes per-item MIST (a 10^9 shortfall = catalog for dust);
//   • crafting::create_recipe now requires required_job: u8 + craft_xp: u64 (the seeder must source them, never invent).
//
// SSOT NOTE: the job order below MIRRORS @aresrpg/sdk/jobs `JOBS` (index = the on-chain `required_job: u8`) and
// foundation `forgemagie.move` JOB_COUNT=15. It is duplicated here ONLY because the ceremony seeder is deliberately
// dependency-light (it imports @mysten/sui + ceremony_lib alone — @aresrpg/sdk is not a packages/move dependency and
// does not resolve from here). If a 16th job ever lands, update BOTH homes.

/** Canonical craft-job order — the u8 `required_job` id is the INDEX (0..14). A slug not here is a PHANTOM job
 *  (a content gap the seeder skips + counts, never fabricates). Mirrors @aresrpg/sdk/jobs `JOBS`. */
export const JOB_IDS = [
  'farmer',
  'herbalist',
  'miner',
  'sword_smith',
  'axe_smith',
  'blunt_smith',
  'staff_carver',
  'bowyer',
  'armorsmith',
  'tailor',
  'tanner',
  'jeweler',
  'alchemist',
  'baker',
  'handyman',
]

/** Resolve a recipe's authored job to its on-chain `required_job: u8`. Accepts a numeric id (passed through if a
 *  valid 0..14) OR a slug (resolved via JOB_IDS). Returns `null` for a phantom / out-of-range / absent job — the
 *  caller SKIPS + counts it (a content lane authors the fix; the seeder never invents a job onto immutable state).
 *  @param {number|string|null|undefined} job @returns {number|null} */
export function resolve_required_job(job) {
  if (job == null) return null
  if (typeof job === 'number') return Number.isInteger(job) && job >= 0 && job < JOB_IDS.length ? job : null
  const idx = JOB_IDS.indexOf(String(job))
  return idx >= 0 ? idx : null
}

/** Normalize an authored weapon `dmg` — a single line object, an array of line objects, or absent —
 *  into an array of fully-defaulted damage-line objects {from,to,type,element}. ONE home for the
 *  object|array decision both ceremony seeders mint through (seed_full_corpus + seed_testnet): a
 *  single object → a 1-element array whose dmgLine compose is BYTE-IDENTICAL to the pre-array seeder;
 *  an array → each entry mapped (the bracket-mandated multi-line gear, gear law 1/2/3/4 by level);
 *  absent → []. Defaults mirror the seeders' historical fallbacks: type 'weapon', element 'neutral'.
 *  @param {undefined|null|{from:number,to:number,type?:string,element?:string}|Array} dmg */
export function damage_lines(dmg) {
  if (dmg == null) return []
  const arr = Array.isArray(dmg) ? dmg : [dmg]
  return arr.map((d) => ({ from: d.from, to: d.to, type: d.type || 'weapon', element: d.element || 'neutral' }))
}

// Shop prices are authored in WHOLE SUI (shop.json `_meta.tiers`); the chain's shop::create_sale takes per-item MIST.
export const SUI_TO_MIST = 1_000_000_000n
export const MIN_SALE_MIST = 10_000_000n // 0.01 SUI floor (royalty-coherent — ceremony_lib.mjs)
export const MAX_SALE_MIST = 10_000_000n * SUI_TO_MIST // 10,000,000 SUI ceiling (sanity)

/** SUI (authored, whole-number) → per-item MIST as a BigInt (×1e9, exact — never float), with a coherent-range
 *  REFUSE: a raw-SUI price passed to the chain would list the whole catalog for dust, so a final price outside
 *  [0.01, 10,000,000] SUI (or a non-positive price) throws LOUDLY and stops the ceremony with zero gas burned.
 *  @param {number|string|null|undefined} price_sui @returns {bigint} per-item MIST */
export function sui_to_sale_mist(price_sui) {
  const sui = Math.round(Number(price_sui ?? 0)) // shop tiers are whole SUI; round defensively
  if (!Number.isFinite(sui) || sui <= 0)
    throw new Error(`[seed] shop price must be a positive SUI amount, got ${JSON.stringify(price_sui)}`)
  const mist = BigInt(sui) * SUI_TO_MIST
  if (mist < MIN_SALE_MIST || mist > MAX_SALE_MIST)
    throw new Error(
      `[seed] shop sale price ${sui} SUI (${mist} MIST) is out of the coherent range [0.01, 10,000,000] SUI — refuse (money-path).`
    )
  return mist
}

// ── Resource NODE-CHARGE pack sizes by gathering job (a Testlands live-test finding, 2026-07-12 evening:
// "when spawning resources, we shouldn't have only one spawning... spawn packs of 10-20 wheat blocks, a bit less
// for herbs, and even less for ores") — SUPERSEDES the same-day daytime ruling baked into world:author ("one
// gather = one node", min/max qty default 1/1). min/max bound a resource NODE's `remaining` HARVEST COUNT
// (world.move ResourceEntry.min_qty/max_qty → zones.move ResourceSpawn.remaining, decremented one per gather,
// node despawns at 0) — how many times the SAME discovered node can be gathered before it's gone. The PER-GATHER
// YIELD AMOUNT is a separate, job-level-scaling roll (packages/sdk jobs.js gather_amount) untouched by this table.
// Job encoding mirrors JOB_IDS above (0 farmer/1 herbalist/2 miner).
export const RESOURCE_PACK_QTY = {
  0: { min: 10, max: 20 }, // FARMER (crops) — "packs of 10-20 wheat blocks"
  1: { min: 4, max: 8 }, // HERBALIST (herbs / alchemist plants) — "a bit less for herbs"
  2: { min: 2, max: 4 }, // MINER (ore veins) — "even less for ores"; cave/underground-biased WORLD PLACEMENT is a
  // separate, already-deferred ticket (BACKLOG "RESOURCE PACK-SPAWNING" — ores → cinderforge_depths as THE cave
  // world of the 20 — rides the DECISIONS 07-12 per-world-environments POST-RELEASE wave); this table sets COUNT only.
}

/** The node-charge [min,max] qty band for a resource row. An explicitly authored {min_qty,max_qty} PAIR always
 *  wins (a deliberate per-row override — e.g. a boss-adjacent node tuned by hand); else the row's `job` (0 farmer/
 *  1 herbalist/2 miner) picks the pack band above; a job the table doesn't recognize falls back to a conservative
 *  single-gather node (never invent a pack size for an unknown job).
 *  @param {number|null|undefined} job @param {number|null|undefined} min_qty @param {number|null|undefined} max_qty
 *  @returns {{min:number,max:number}} */
export function pack_qty_for_job(job, min_qty, max_qty) {
  if (min_qty != null && max_qty != null) return { min: min_qty, max: max_qty }
  return RESOURCE_PACK_QTY[job] ?? { min: 1, max: 1 }
}
