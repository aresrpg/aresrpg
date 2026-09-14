// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { craft_required_level } from '@aresrpg/immutable'

import type { FetchedObject } from './cache.ts'
import { canonical_json } from './canonical_json.ts'
import type { SeedLedger, SeedSyncRow } from './seed_sync.ts'

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/** Compare the actual mutable recipe, not just its last recorded hash/version pair. */
export const recipe_matches = (expected: NonNullable<SeedSyncRow['recipe']>, json: unknown): boolean => {
  const row = record(json)
  const data = record(row.data)
  if (!Array.isArray(data.inputs)) throw new Error('Published recipe inputs are unavailable')
  const inputs = data.inputs.map(record)
  return (
    canonical_json({
      output_type: row.output_type,
      output_template: data.output_template,
      input_templates: inputs.map((input) => input.template),
      input_quantities: inputs.map((input) => String(input.quantity)),
      job: data.job,
      required_level: String(data.required_level),
      active: row.active,
    }) ===
    canonical_json({
      ...expected,
      input_quantities: expected.input_quantities.map(String),
      required_level: String(craft_required_level(expected.input_templates.length)),
      active: true,
    })
  )
}

/** Discard only false recipe evidence in memory; certified update checkpoints repair the persisted ledger. */
export const verified_recipe_ledger = (
  rows: readonly SeedSyncRow[],
  ledger: SeedLedger,
  objects: readonly FetchedObject[]
): SeedLedger => {
  const by_id = new Map(objects.map((object) => [object.objectId, object]))
  const mismatches = new Set(
    rows
      .filter((row) => {
        if (!row.recipe) return false
        const object = by_id.get(row.chain_id)
        if (!object || object.version === undefined) throw new Error(`Published recipe read is missing: ${row.label}`)
        const version = ledger[row.key]?.revisions?.[row.chain_id] ?? '0'
        if (BigInt(object.version) < BigInt(version.split(':')[0]!))
          throw new Error(`Published recipe read is older than its certified revision: ${row.label}`)
        return !recipe_matches(row.recipe, object.json)
      })
      .map((row) => row.key)
  )
  return Object.freeze(Object.fromEntries(Object.entries(ledger).filter(([key]) => !mismatches.has(key))))
}
