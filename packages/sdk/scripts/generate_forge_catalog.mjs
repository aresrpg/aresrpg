// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Materialize the immutable Move rune tables through the SDK's JSON-corpus path. Values are parsed from the
// chain source; this script contains table names only, never a second authored catalog.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TABLES = Object.freeze({
  unit_weights: 'UNIT_WEIGHTS',
  runeable: 'RUNEABLE',
  ba_amount: 'BA_AMOUNT',
  pa_amount: 'PA_AMOUNT',
  ra_amount: 'RA_AMOUNT',
})

const parse_vector = (source, move_name) => {
  const match = source.match(
    new RegExp(
      `const\\s+${move_name}:\\s+vector<u(?:8|64)>\\s*=\\s*vector\\[([^\\]]+)\\];`,
    ),
  )
  if (!match)
    throw new Error(
      `[forge_catalog] ${move_name} is missing from rune_catalog.move`,
    )
  return match[1].split(',').map(value => Number(value.trim().replaceAll('_', '')))
}

export const derive_forge_catalog = source =>
  Object.fromEntries(
    Object.entries(TABLES).map(([key, move_name]) => [
      key,
      parse_vector(source, move_name),
    ]),
  )

const generate_forge_catalog = () => {
  const source_url = new URL(
    '../../move/foundation/sources/rune_catalog.move',
    import.meta.url,
  )
  const output_url = new URL('../src/forge_catalog.json', import.meta.url)
  const source = readFileSync(source_url, 'utf8')
  const catalog = {
    _source: 'packages/move/foundation/sources/rune_catalog.move',
    ...derive_forge_catalog(source),
  }
  writeFileSync(output_url, `${JSON.stringify(catalog, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) generate_forge_catalog()
