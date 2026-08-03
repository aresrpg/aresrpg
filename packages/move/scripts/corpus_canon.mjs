// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ONE HOME for how the corpus resolves DUPLICATE keys.
//
// Fresh authoring (`seed_full_corpus`) mints a duplicated mob key FIRST-WINS and projects that same canonical
// row's level and role. The reseed planner used to build its own maps with `new Map(rows.map(...))`, which is
// LAST-WINS — so the two paths disagreed about what a duplicated key means, and a reseed would drive the world
// away from what the mint established. Fresh authoring is the canon; reseed converges to it.
//
// Zero dependencies on purpose: the pure planner and the chain-touching seeder both import this without either
// pulling the other's weight.

/** Duplicate keys resolve FIRST-WINS. @template {{ key: string }} T @param {T[]} rows @returns {T[]} */
export function canonical_rows(rows) {
  const seen = new Set()
  return (rows ?? []).filter((row) => !seen.has(row.key) && seen.add(row.key))
}

/** `key → value_of(canonical row)` — the projection every consumer of a corpus row must read. */
export function canonical_map(rows, value_of) {
  return new Map(canonical_rows(rows).map((row) => [row.key, value_of(row)]))
}

/** The authored eligibility ceiling of a mob row, with the same fallback chain fresh authoring uses. */
export const mob_level_of = (mob) => mob.maxLevel ?? mob.minLevel ?? 1
