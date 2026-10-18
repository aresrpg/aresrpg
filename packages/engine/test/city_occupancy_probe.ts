// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import assert from 'node:assert/strict'

import { CITY_DEFINITIONS } from '../src/cities/registry.ts'
import { load_generated_city_artifacts } from '../src/cities/generated_city.ts'

const original_file = Bun.file
const requested: string[] = []
Bun.file = ((url: URL) => {
  requested.push(String(url))
  const definition = CITY_DEFINITIONS.find(({ artifact_url }) => String(artifact_url) === String(url))!
  return { json: async () => ({ ...definition.map, chunks: [] }) }
}) as typeof Bun.file
try {
  await load_generated_city_artifacts()
  await load_generated_city_artifacts()
  assert.equal(requested.length, CITY_DEFINITIONS.length)
  assert(requested.every((url) => !url.includes('_details')))
} finally {
  Bun.file = original_file
}
console.log('city occupancy without decorative payloads passed')
