// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The public build graph must match the local Move manifests before CI, the signer, or release
// tooling treats a package artifact as belonging to a named slot.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'move-packages.json'), 'utf8'))
const expected_slots = ['math', 'control', 'combat', 'seed', 'game']

if (manifest.schema !== 1 || !Array.isArray(manifest.packages)) throw new Error('move-packages.json schema is invalid')
if (manifest.packages.map(({ slot }) => slot).join(',') !== expected_slots.join(','))
  throw new Error(`Move package slots must be ${expected_slots.join(', ')}`)

const by_path = new Map(manifest.packages.map((row) => [normalize(row.path), row.slot]))
for (const row of manifest.packages) {
  const move_toml = readFileSync(join(root, row.path, 'Move.toml'), 'utf8')
  const package_name = move_toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
  if (package_name !== row.package_name)
    throw new Error(`${row.slot} declares ${String(package_name)}, expected ${row.package_name}`)
  const local_dependencies = [...move_toml.matchAll(/local\s*=\s*"([^"]+)"/g)].map(([, path]) => {
    const local_path = normalize(relative(root, resolve(root, row.path, path)))
    const slot = by_path.get(local_path)
    if (!slot) throw new Error(`${row.slot} has unknown local dependency ${local_path}`)
    return slot
  })
  const actual = [...local_dependencies].sort()
  const declared = [...row.dependencies].sort()
  if (actual.join(',') !== declared.join(','))
    throw new Error(`${row.slot} dependencies [${actual.join(', ')}] differ from manifest [${declared.join(', ')}]`)
  const dependency_block = move_toml.match(/\[dependencies\][^\n]*\n([\s\S]*?)(?=\n\[|$)/)?.[1] ?? ''
  const dependency_names = [...dependency_block.matchAll(/^([A-Za-z][A-Za-z0-9_]*)\s*=/gm)].map(([, name]) => name)
  const local_names = row.dependencies.map(
    (slot) => manifest.packages.find((candidate) => candidate.slot === slot)?.package_name
  )
  const allowed_names = row.slot === 'game' ? [...local_names, 'Kiosk'] : local_names
  const unexpected_names = dependency_names.filter((name) => !allowed_names.includes(name))
  const missing_names = allowed_names.filter((name) => !dependency_names.includes(name))
  if (unexpected_names.length || missing_names.length)
    throw new Error(
      `${row.slot} dependency keys differ from policy; unexpected [${unexpected_names.join(', ')}], missing [${missing_names.join(', ')}]`
    )
}

const combat_source_dir = join(root, manifest.packages.find(({ slot }) => slot === 'combat').path, 'sources')
const combat_source = readdirSync(combat_source_dir)
  .filter((file) => file.endsWith('.move'))
  .map((file) => readFileSync(join(combat_source_dir, file), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
const forbidden_combat_authority = [
  ['key ability', /\bhas\s+key\b/],
  ['object identity', /\bUID\b|\bobject::/],
  ['transaction context', /\bTxContext\b/],
  ['clock object', /\bClock\b/],
  ['random object', /\bRandom(?:Generator)?\b/],
  ['kiosk custody', /\bKiosk(?:OwnerCap)?\b|\bkiosk::/],
  ['coin custody', /\bCoin\b|\bBalance\b|\bcoin::|\bbalance::/],
  ['object transfer', /\btransfer::/],
  ['canonical events', /\bevent::/],
  ['dynamic fields', /\bdynamic_(?:object_)?field\b|\bdynamic_object::|\bdynamic_field::/],
  ['entry door', /\bentry\s+fun\b/],
  ['direct Sui import', /\buse\s+sui\b/],
  ['higher package import', /\buse\s+aresrpg(?:_seed|_control)?\b/],
]
for (const [authority, pattern] of forbidden_combat_authority) {
  if (pattern.test(combat_source)) throw new Error(`combat package crossed its authority boundary: ${authority}`)
}

process.stdout.write(`Move package graph verified: ${expected_slots.join(' → ')}\n`)
process.stdout.write('Combat authority boundary verified: math + plain values only\n')
