#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE LINT-COVERAGE GATE (#2059) — every first-party source file is actually linted.
//
// ESLint's flat config only lints a non-default extension (.jsx/.ts/.tsx) when some block's
// `files` glob names it. A directory that no glob names is not "clean": it is INVISIBLE, and
// every gate above it (max-lines, the fp-law tiers, the one-reducer tripwire, no-undef) reports
// a silent zero for it. That is how packages/frontend/src/game/screens/hud/ carried an 876-line
// component past a 600-line ceiling for months — .jsx matched exactly one glob in the whole
// config (the hud/world TDZ block) and nothing else.
//
// A missing glob and a clean directory are indistinguishable from the outside, so the invariant
// has to be measured, not trusted: census the tree, ask ESLint which files it ACTUALLY lints,
// and make ESLint itself classify every difference. Handed an explicit path it declines, ESLint
// gives two distinct verdicts — "File ignored because of a matching ignore pattern" (deliberate,
// the config's `ignores`) and "File ignored because no matching configuration was supplied"
// (the #2059 defect). Only the second is a failure. `isPathIgnored` cannot make that call: it
// answers true for both in some shapes and false for both in others.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { ESLint } from 'eslint'

const script_path = file_url_to_path(import.meta.url)
const repo_root = path.resolve(path.dirname(script_path), '..')
const skipped_directories = new Set(['.git', '.agents', '.codex', 'build', 'dist', 'node_modules', 'target'])
const source_file = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/
const test_snapshot = /\.snap$/

const relative_path = (root, file) => path.relative(root, file).split(path.sep).join('/')

export const source_census = (root) => {
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && skipped_directories.has(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && source_file.test(entry.name) && !test_snapshot.test(entry.name))
        files.push(relative_path(root, file))
    }
  }
  walk(root)
  return files.sort()
}

const NO_MATCHING_CONFIG = 'no matching configuration'

// `ruleFilter: () => false` keeps the config resolution and the file enumeration — the only two
// things this gate reads — and skips running 470 rules over 2.4k files.
const eslint_probe = (root) => new ESLint({ cwd: root, ruleFilter: () => false, warnIgnored: true })

const linted_paths = async (root) => {
  const results = await eslint_probe(root).lintFiles(['.'])
  return new Set(results.map((result) => relative_path(root, result.filePath)))
}

const declined_for_no_config = async (eslint, root, file) => {
  const [result] = await eslint.lintFiles([path.join(root, file)])
  if (!result) throw new Error(`ESLint returned no verdict for ${file}`)
  return result.messages.some((message) => message.message.includes(NO_MATCHING_CONFIG))
}

export const coverage_verdict = async (root) => {
  const eslint = eslint_probe(root)
  const linted = await linted_paths(root)
  const candidates = source_census(root).filter((file) => !linted.has(file))
  const verdicts = await Promise.all(candidates.map((file) => declined_for_no_config(eslint, root, file)))
  return { linted: linted.size, uncovered: candidates.filter((_, index) => verdicts[index]) }
}

// Positive control: a throwaway repo whose config names .js and never .jsx — the exact #2059
// shape, next to a deliberately ignored .js. If the gate cannot tell those two apart, its zero
// on the real tree means nothing.
const prove_synthetic_red = async () => {
  const control_root = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-lint-coverage-control-'))
  try {
    fs.mkdirSync(path.join(control_root, 'src/vendored'), { recursive: true })
    fs.writeFileSync(
      path.join(control_root, 'eslint.config.mjs'),
      "export default [{ ignores: ['src/vendored/**'] }, { files: ['**/*.js'], rules: { 'no-var': 'error' } }]\n"
    )
    fs.writeFileSync(path.join(control_root, 'src/covered.js'), 'export const covered = 1\n')
    fs.writeFileSync(path.join(control_root, 'src/vendored/skipped.js'), 'export const skipped = 1\n')
    fs.writeFileSync(path.join(control_root, 'src/invisible.jsx'), 'export const invisible = () => 1\n')
    const { uncovered } = await coverage_verdict(control_root)
    if (uncovered.length !== 1 || uncovered[0] !== 'src/invisible.jsx')
      throw new Error(`control did not isolate the unmatched .jsx (saw: ${uncovered.join(', ') || 'nothing'})`)
  } finally {
    fs.rmSync(control_root, { recursive: true, force: true })
  }
  console.log('lint-coverage proof red: an unmatched .jsx is reported; a deliberately ignored .js is not')
}

try {
  await prove_synthetic_red()
  const { linted, uncovered } = await coverage_verdict(repo_root)
  if (uncovered.length) {
    console.error('LINT COVERAGE GATE FAILED — source file(s) that no `files` glob matches:')
    uncovered.forEach((file) => console.error(`  ${file}`))
    console.error('  add the extension to the relevant `files` globs, or ignore the path deliberately')
    process.exit(1)
  }
  console.log(`LINT COVERAGE GATE PASSED: ${linted} files linted, 0 source files unmatched by any \`files\` glob`)
} catch (error) {
  console.error(`LINT COVERAGE GATE FAILED: ${error.message}`)
  process.exit(1)
}
