#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_path = file_url_to_path(import.meta.url)
const repo_root = path.resolve(path.dirname(script_path), '..')
const frontend_src = path.join(repo_root, 'packages/frontend/src')
const manifest_path = path.join(repo_root, 'packages/frontend/public/asset_manifest.json')
const source_extension = /\.[cm]?[jt]sx?$/
const test_file = /\.(?:test|spec)\.[cm]?[jt]sx?$/

const source_files = (directory) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) return source_files(file)
      return source_extension.test(entry.name) && !test_file.test(entry.name) ? [file] : []
    })
    .sort()

const string_bindings = (source) =>
  new Map([...source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(['"])([^'"]+)\2/g)].map((match) => [match[1], match[3]]))

const resolve_token = (token, bindings) => {
  const value = token.trim()
  const quoted = value.match(/^(['"])([^'"]+)\1$/)
  if (quoted) return quoted[2]
  if (bindings.has(value)) return bindings.get(value)
  const template = value.match(/^`\$\{(\w+)\}\.json`$/)
  if (template && bindings.has(template[1])) return `${bindings.get(template[1])}.json`
  return null
}

const client_consumers = () =>
  source_files(frontend_src).flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8')
    const bindings = string_bindings(source)
    const consumers = []
    for (const match of source.matchAll(
      /\b(asset_url|bare_corpus_url|versioned_corpus_url)\s*\(\s*([^,)]+)(?:,\s*([^,)]+))?/g
    )) {
      const url_class = resolve_token(match[2], bindings)
      if (!url_class) continue
      const filename = match[1] === 'asset_url' ? resolve_token(match[3] ?? '', bindings) : `${url_class}.json`
      if (!filename?.endsWith('.json')) continue
      consumers.push({ kind: 'consume', artifact: url_class, source: path.relative(repo_root, file) })
    }
    for (const match of source.matchAll(/\bnew URL\(\s*(\w+)/g)) {
      const filename = bindings.get(match[1])
      if (!filename?.endsWith('.json')) continue
      consumers.push({
        kind: 'consume',
        artifact: filename.slice(0, -'.json'.length),
        source: path.relative(repo_root, file),
      })
    }
    return consumers
  })

const loud_fallback = ({ artifact, source }) => {
  if (artifact !== 'corpus_version') return null
  const fallback_checks = {
    'packages/frontend/src/game/data/corpus_asset.js': 'corpus pointer HTTP',
    'packages/frontend/src/game/data/spell_corpus.js': 'speak_fallback_failure',
    'packages/frontend/src/pages/encyclopedia/world_corpus.ts': 'degrade(',
  }
  const pattern = fallback_checks[source]
  return pattern && fs.readFileSync(path.join(repo_root, source), 'utf8').includes(pattern) ? pattern : null
}

export const validate_plan = (actions) => {
  const published = new Set()
  const errors = []
  for (const action of actions) {
    if (action.kind === 'publish') {
      published.add(action.artifact)
      continue
    }
    if (action.kind !== 'consume') {
      errors.push(`unknown action kind ${JSON.stringify(action.kind)}`)
      continue
    }
    if (!published.has(action.artifact) && !action.fallback)
      errors.push(`${action.source} consumes ${action.artifact}.json before its publisher receipt exists`)
  }
  return errors
}

const actual_plan = () => {
  const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'))
  const publishes = Object.entries(manifest.classes ?? {})
    .filter(([, row]) => row?.published === true)
    .map(([artifact]) => ({ kind: 'publish', artifact, source: path.relative(repo_root, manifest_path) }))
  const consumers = client_consumers().map((consumer) => ({
    ...consumer,
    fallback: loud_fallback(consumer),
  }))
  // Both shared-pointer clients must carry their own loud degradation. The pointer is written after the
  // versioned payloads by the external seed publisher, so it intentionally has no manifest class of its own.
  for (const source of [
    'packages/frontend/src/game/data/spell_corpus.js',
    'packages/frontend/src/pages/encyclopedia/world_corpus.ts',
  ])
    consumers.push({
      kind: 'consume',
      artifact: 'corpus_version',
      source,
      fallback: loud_fallback({ artifact: 'corpus_version', source }),
    })
  return [...publishes, ...consumers]
}

const fixture_index = process.argv.indexOf('--fixture')
const actions =
  fixture_index === -1
    ? actual_plan()
    : JSON.parse(fs.readFileSync(path.resolve(repo_root, process.argv[fixture_index + 1]), 'utf8')).actions
const errors = validate_plan(actions)

if (errors.length) {
  console.error('PUBLISHER-BEFORE-CONSUMER GATE FAILED')
  errors.forEach((error) => console.error(`  ${error}`))
  process.exit(1)
}

console.log(
  `PUBLISHER-BEFORE-CONSUMER GATE PASSED: ${actions.filter(({ kind }) => kind === 'consume').length} client reads are published or loud`
)
