// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'

import { CITY_DEFINITIONS } from '../src/cities/registry.ts'
import { load_generated_city_artifacts } from '../src/cities/generated_city.ts'

const original_file = Bun.file
let reads = 0
Bun.file = ((...args: Parameters<typeof Bun.file>) => {
  reads++
  if (reads === 1) return { json: () => Promise.reject(new Error('interrupted artifact read')) }
  return original_file(...args)
}) as typeof Bun.file
try {
  await assert.rejects(load_generated_city_artifacts(), /interrupted artifact read/)
  await load_generated_city_artifacts()
  assert.equal(reads, CITY_DEFINITIONS.length + 1)
  await load_generated_city_artifacts()
  assert.equal(reads, CITY_DEFINITIONS.length + 1)
} finally {
  Bun.file = original_file
}
console.log('generated city recovery passed')
