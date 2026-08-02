#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const endpoint = 'https://rpc.aresrpg.world/v1/encyclopedia?kind=mobs'
const repo_root = path.resolve(path.dirname(file_url_to_path(import.meta.url)), '..')
const fixture_path = path.resolve(
  repo_root,
  process.env.MOB_SLUGS_FIXTURE ?? 'packages/frontend/test/pages/encyclopedia/mob_slugs.fixture.ts'
)
const source = process.argv[2] ?? endpoint
const captured = process.env.MOB_SLUGS_CAPTURE_DATE ?? new Date().toISOString().slice(0, 10)

if (!/^\d{4}-\d{2}-\d{2}$/.test(captured)) throw new Error('MOB_SLUGS_CAPTURE_DATE must be YYYY-MM-DD')

const payload = source.startsWith('file:')
  ? JSON.parse(fs.readFileSync(file_url_to_path(source), 'utf8'))
  : await (async () => {
      const response = await fetch(source, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`)
      return response.json()
    })()
const names = payload?.mobs?.map((mob) => mob?.name).toSorted()
if (!names?.length || names.some((name) => typeof name !== 'string' || !name || /[\p{Cc}\u2028\u2029]/u.test(name)))
  throw new Error('encyclopedia payload has no valid mobs array')
if (new Set(names).size !== names.length) throw new Error('encyclopedia payload contains duplicate mob names')

const mob_slugs = JSON.parse(
  fs.readFileSync(path.join(repo_root, 'packages/frontend/src/pages/encyclopedia/mob_slugs.json'), 'utf8')
)
const missing = names.filter((name) => !Object.hasOwn(mob_slugs, name))
const quote_name = (name) =>
  (name.match(/'/g)?.length ?? 0) > (name.match(/"/g)?.length ?? 0)
    ? JSON.stringify(name)
    : `'${name.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
const rows = names.map((name) => `  ${quote_name(name)},`).join('\n')
const fixture = `// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIXTURE PROVENANCE: GET ${endpoint}, captured ${captured}.
// Initial offline seed: packages/frontend/src/rpc/fixtures/encyclopedia.json .mobs[].name; refresh with this script.
export default [
${rows}
] as const
`
fs.writeFileSync(fixture_path, fixture)
console.log(`captured ${names.length} mob names in ${path.relative(repo_root, fixture_path)}`)

if (missing.length) {
  console.error(`MOB SLUGS DRIFT: ${missing.length} served name(s) have no mob_slugs key`)
  missing.forEach((name) => console.error(`  ${name}`))
  process.exitCode = 1
}
