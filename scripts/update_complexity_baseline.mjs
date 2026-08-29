// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Ratchets the exact cognitive/cyclomatic scores emitted by the local ESLint complexity gate.

import fs from 'node:fs'
import path from 'node:path'

import { ESLint } from 'eslint'

import { score_change, unsafe_baseline_change } from './eslint-rules/complexity_gate.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts/eslint-rules/complexity.baseline.json')
const current = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
const eslint = new ESLint({ overrideConfig: [{ settings: { 'complexity-gate': { collect: true } } }] })
const results = await eslint.lintFiles(['.'])
const next = { version: 1, cognitive: {}, cyclomatic: {} }

for (const result of results) {
  const filename = path.relative(REPO_ROOT, result.filePath).replaceAll('\\', '/')
  for (const message of result.messages) {
    if (message.messageId !== 'collection') continue
    const match = /^COMPLEXITY_BASELINE (cognitive|cyclomatic) (.+)$/.exec(message.message)
    if (!match) throw new Error(`Malformed complexity collection: ${message.message}`)
    const [, metric, payload] = match
    const { label, scores } = JSON.parse(payload)
    next[metric][filename] ??= {}
    next[metric][filename][label] = scores
  }
}

const changes_for = (metric) => {
  const filenames = new Set([...Object.keys(current[metric] ?? {}), ...Object.keys(next[metric] ?? {})])
  return [...filenames].flatMap((filename) => {
    const before_file = current[metric]?.[filename] ?? {}
    const after_file = next[metric]?.[filename] ?? {}
    const labels = new Set([...Object.keys(before_file), ...Object.keys(after_file)])
    return [...labels].map((label) => {
      const before = before_file[label] ?? []
      const after = after_file[label] ?? []
      return { metric, filename, label, before, after, ...score_change(before, after) }
    })
  })
}

const describe_change = ({ metric, filename, label, before, after }) =>
  `${metric} complexity in ${filename} (${label}): ${before.length ? before : 'none'} -> ${after.length ? after : 'none'}`

const assert_safe_update = () => {
  if (current.bootstrap) return
  const changes = ['cognitive', 'cyclomatic'].flatMap(changes_for)
  const regression = changes.find(
    ({ metric, before, after }) => unsafe_baseline_change(metric, before, after) === 'regression'
  )
  if (regression) throw new Error(`${describe_change(regression)} is a regression`)
  const hard_violation = changes.find(
    ({ metric, before, after }) => unsafe_baseline_change(metric, before, after) === 'hardCeiling'
  )
  if (hard_violation) throw new Error(`${describe_change(hard_violation)} exceeds the hard ceiling`)
}

assert_safe_update()
fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
process.stdout.write(
  `complexity baseline: ${Object.keys(next.cognitive).length} cognitive files, ${Object.keys(next.cyclomatic).length} cyclomatic files\n`
)
