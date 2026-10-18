// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'

import { CITY_DEFINITIONS } from '../src/cities/registry.ts'
import { load_generated_city_artifacts } from '../src/cities/generated_city.ts'
import { load_city_details } from '../src/cities/city_details.ts'
import { detail_builder } from '../src/detail_builder.ts'
import { decode_detail_cell, decode_detail_vertices } from '../src/detail_artifact.ts'

const original_file = Bun.file
const original_atob = globalThis.atob
const artifacts = CITY_DEFINITIONS.map((definition) => {
  const builder = detail_builder()
  const material = definition.material_names[0]!
  builder.box([1, 1, 1], [2, 2, 2], material)
  builder.box([33, 1, 1], [34, 2, 2], material)
  const [valid, invalid] = builder.finish()
  const vertices = decode_detail_vertices(invalid!.vertices)
  vertices[3] = NaN
  return {
    ...definition.map,
    chunks: [],
    details: [valid!, { ...invalid!, vertices: Buffer.from(vertices.buffer).toString('base64') }],
  }
})
let detail_reads = 0
let reads = 0
let decodes = 0
globalThis.atob = (encoded) => {
  decodes++
  return original_atob(encoded)
}
Bun.file = ((...args: Parameters<typeof Bun.file>) => {
  const detail_index = CITY_DEFINITIONS.findIndex(({ details_url }) => String(details_url) === String(args[0]))
  if (detail_index >= 0) {
    detail_reads++
    if (detail_reads === 1) return { json: () => Promise.reject(new Error('interrupted detail read')) }
    const artifact = artifacts[detail_index]!
    return { json: async () => ({ ...artifact, source_hash: detail_reads === 2 ? 'stale' : artifact.source_hash }) }
  }
  reads++
  if (reads === 1) return { json: () => Promise.reject(new Error('interrupted artifact read')) }
  const index = CITY_DEFINITIONS.findIndex(({ artifact_url }) => String(artifact_url) === String(args[0]))
  return { json: async () => ({ ...artifacts[index], details: undefined }) }
}) as typeof Bun.file
try {
  await assert.rejects(load_generated_city_artifacts(), /interrupted artifact read/)
  await load_generated_city_artifacts()
  assert.equal(reads, CITY_DEFINITIONS.length + 1)
  await load_generated_city_artifacts()
  assert.equal(reads, CITY_DEFINITIONS.length + 1)
  assert.equal(detail_reads, 0)
  assert.equal(decodes, 0, 'collision and planning must not decode decorative vertices')
  const definition = CITY_DEFINITIONS[0]!
  const city = definition.compile(definition.map.area)
  await assert.rejects(load_city_details([city], 0, 0), /interrupted detail read/)
  await assert.rejects(load_city_details([city], 0, 0), /provenance/)
  const [valid] = await load_city_details([city], 0, 0)
  const [invalid] = await load_city_details([city], 32, 0)
  assert.equal(decodes, 0, 'archive loading leaves vertex work to bounded admission')
  assert(valid)
  decode_detail_cell(valid)
  assert.equal(decodes, 1)
  assert(invalid)
  assert.throws(() => decode_detail_cell(invalid), /Invalid detail vertex or normal/)
  assert.throws(() => decode_detail_cell(invalid), /Invalid detail vertex or normal/)
  assert.equal(detail_reads, 3, 'columns share one retained decoration archive')
} finally {
  Bun.file = original_file
  globalThis.atob = original_atob
}
console.log('generated city recovery passed')
