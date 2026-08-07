#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Mechanical drift census for issue #1336's one-pipeline ruling. Scanner functions
// consume immutable { path, source } records; filesystem and process effects live
// only in the CLI edge at the bottom of this file.

import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CLONE_LINE_THRESHOLD = 10

export const RAW_SOURCE_MODULES = Object.freeze([
  'api/sponsor_state.mjs',
  'packages/frontend/src/chain/read_character.js',
  'packages/frontend/src/chain/read_checkpoint.js',
  'packages/frontend/src/chain/read_findables.js',
  'packages/frontend/src/chain/read_kiosk_profits.js',
  'packages/frontend/src/chain/read_listings.js',
  'packages/frontend/src/chain/read_party.js',
  'packages/frontend/src/chain/read_shop_sales.js',
  'packages/frontend/src/chain/read_spell_state.js',
  'packages/frontend/src/chain/read_staking.js',
  'packages/frontend/src/chain/read_templates.js',
  'packages/frontend/src/chain/sdk.ts',
  'packages/frontend/src/game/data/mob_catalog.js',
  'packages/frontend/src/game/data/pet_catalog.js',
  'packages/frontend/src/game/data/spell_corpus.js',
  'packages/frontend/src/game/screens/fight-stream.js',
  'packages/frontend/src/pages/encyclopedia/item_corpus.ts',
  'packages/frontend/src/pages/encyclopedia/world_corpus.ts',
  'packages/frontend/src/rpc/client.ts',
  'packages/frontend/src/rpc/fight_journal.js',
])

const source_extensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const extension_order = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']
const ignored_literal_path =
  /(?:^|\/)(?:__tests__|fixtures?|i18n|tests?|test_helpers)(?:\/|$)|(?:^|\/)[^/]*\.(?:fixture|spec|test)\.[cm]?[jt]sx?$/
const number_pattern =
  /^(?:0[xX][\dA-Fa-f](?:_?[\dA-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?(?:[eE][+-]?\d(?:_?\d)*)?)n?$/
const identifier_pattern = /^[A-Za-z_$][\w$]*$/
const lexical_pattern =
  /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|(?:0[xX][\dA-Fa-f](?:_?[\dA-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?(?:[eE][+-]?\d(?:_?\d)*)?n?)|(?:[A-Za-z_$][\w$]*)|(?:===|!==|>>>|<<=|>>=|\*\*=|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\?\.|\+=|-=|\*=|\/=|%=|<<|>>|\*\*|\.\.\.|[^\s])/g
const keywords = new Set(
  (
    'as async await break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for from function get if implements import in instanceof interface let new null of package ' +
    'private protected public require return set static super switch this throw true try typeof undefined var ' +
    'void while with yield'
  ).split(' ')
)
const clone_signal_keywords = new Set([
  'await',
  'case',
  'catch',
  'class',
  'const',
  'else',
  'for',
  'function',
  'if',
  'let',
  'return',
  'switch',
  'throw',
  'try',
  'while',
])

const newline_count = (value) => (value.match(/\n/g) ?? []).length
const normalized_path = (value) => value.replaceAll('\\', '/').replace(/^\.\//, '')

function lexical_tokens(source) {
  const tokens = []
  let cursor = 0
  let line = 1
  for (const match of source.matchAll(lexical_pattern)) {
    line += newline_count(source.slice(cursor, match.index))
    const [raw] = match
    const token_line = line
    cursor = (match.index ?? 0) + raw.length
    line += newline_count(raw)
    if (raw.startsWith('//') || raw.startsWith('/*')) continue
    const [first] = raw
    const kind =
      first === "'" || first === '"' || first === '`'
        ? 'string'
        : number_pattern.test(raw)
          ? 'number'
          : identifier_pattern.test(raw)
            ? keywords.has(raw)
              ? 'keyword'
              : 'identifier'
            : 'punctuation'
    tokens.push({ kind, line: token_line, raw })
  }
  return tokens
}

function code_lines(file) {
  const grouped = new Map()
  for (const token of lexical_tokens(file.source)) {
    const current = grouped.get(token.line) ?? []
    current.push(token)
    grouped.set(token.line, current)
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([line, tokens]) => ({ line, tokens }))
}

function canonical_window(lines) {
  const tokens = lines.flatMap(({ tokens: line_tokens }) => line_tokens)
  const signal_count = tokens.filter((token) => token.kind === 'keyword' && clone_signal_keywords.has(token.raw)).length
  if (signal_count < 2) return null
  const identifiers = new Map()
  const canonical_identifier = (raw) => {
    if (!identifiers.has(raw)) identifiers.set(raw, `id${identifiers.size}`)
    return identifiers.get(raw)
  }
  return lines
    .map(({ tokens }) =>
      tokens.map((token) => (token.kind === 'identifier' ? canonical_identifier(token.raw) : token.raw)).join(' ')
    )
    .join('\n')
}

function ordered_occurrences(left, right) {
  const left_key = `${left.path}\0${String(left.index).padStart(10, '0')}`
  const right_key = `${right.path}\0${String(right.index).padStart(10, '0')}`
  return left_key <= right_key ? [left, right] : [right, left]
}

export function scan_clones(files, { minimum_lines = CLONE_LINE_THRESHOLD } = {}) {
  const lines_by_file = new Map(
    [...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => [file.path, code_lines(file)])
  )
  const windows = new Map()
  for (const [file_path, lines] of lines_by_file) {
    for (let index = 0; index <= lines.length - minimum_lines; index += 1) {
      const signature = canonical_window(lines.slice(index, index + minimum_lines))
      if (signature === null) continue
      const occurrences = windows.get(signature) ?? []
      occurrences.push({ index, path: file_path })
      windows.set(signature, occurrences)
    }
  }

  const runs = new Map()
  for (const occurrences of windows.values()) {
    for (let left_index = 0; left_index < occurrences.length; left_index += 1) {
      for (let right_index = left_index + 1; right_index < occurrences.length; right_index += 1) {
        const [left, right] = ordered_occurrences(occurrences[left_index], occurrences[right_index])
        if (left.path === right.path && Math.abs(left.index - right.index) < minimum_lines) continue
        const run_key = `${left.path}\0${right.path}\0${right.index - left.index}`
        const hits = runs.get(run_key) ?? []
        hits.push({ left, right })
        runs.set(run_key, hits)
      }
    }
  }

  const findings = []
  for (const hits of runs.values()) {
    const ordered_hits = hits.sort(
      (left, right) => left.left.index - right.left.index || left.right.index - right.right.index
    )
    let [start] = ordered_hits
    let previous = start
    const finish_run = () => {
      const extra_lines = previous.left.index - start.left.index
      const left_lines = lines_by_file.get(start.left.path)
      const right_lines = lines_by_file.get(start.right.path)
      const maximum_non_overlapping_lines =
        start.left.path === start.right.path ? start.right.index - start.left.index : Infinity
      const line_count = Math.min(minimum_lines + extra_lines, maximum_non_overlapping_lines)
      findings.push({
        homes: [
          { line: left_lines[start.left.index].line, path: start.left.path },
          { line: right_lines[start.right.index].line, path: start.right.path },
        ],
        kind: 'clone',
        line_count,
        ranges: [
          { end: start.left.index + line_count, path: start.left.path, start: start.left.index },
          { end: start.right.index + line_count, path: start.right.path, start: start.right.index },
        ],
      })
    }
    for (const hit of ordered_hits.slice(1)) {
      const contiguous = hit.left.index === previous.left.index + 1 && hit.right.index === previous.right.index + 1
      if (!contiguous) {
        finish_run()
        start = hit
      }
      previous = hit
    }
    finish_run()
  }
  const sorted_findings = findings.sort(
    (left, right) =>
      right.line_count - left.line_count ||
      left.homes[0].path.localeCompare(right.homes[0].path) ||
      left.homes[0].line - right.homes[0].line ||
      left.homes[1].path.localeCompare(right.homes[1].path) ||
      left.homes[1].line - right.homes[1].line
  )
  const accepted = []
  for (const finding of sorted_findings) {
    const substantially_overlaps = accepted.some((previous) =>
      finding.ranges.every((range, index) => {
        const other = previous.ranges[index]
        if (range.path !== other.path) return false
        const overlap = Math.max(0, Math.min(range.end, other.end) - Math.max(range.start, other.start))
        return overlap / Math.min(range.end - range.start, other.end - other.start) >= 0.8
      })
    )
    if (!substantially_overlaps) accepted.push(finding)
  }
  return accepted.map(({ ranges: _ranges, ...finding }) => finding)
}

function import_specifiers(source) {
  const tokens = lexical_tokens(source)
  return tokens.flatMap((token, index) => {
    if (token.kind !== 'string' || token.raw.startsWith('`')) return []
    const previous = tokens[index - 1]
    const before_previous = tokens[index - 2]
    const is_static = previous?.raw === 'from' || previous?.raw === 'import'
    const is_call = previous?.raw === '(' && (before_previous?.raw === 'import' || before_previous?.raw === 'require')
    return is_static || is_call ? [{ line: token.line, specifier: token.raw.slice(1, -1) }] : []
  })
}

function resolve_candidate(importer_path, specifier, candidates) {
  if (!specifier.startsWith('.')) return null
  const resolved = normalized_path(path.posix.join(path.posix.dirname(importer_path), specifier))
  const attempts = [
    resolved,
    ...extension_order.map((extension) => `${resolved}${extension}`),
    ...extension_order.map((extension) => `${resolved}/index${extension}`),
  ]
  return attempts.find((attempt) => candidates.has(attempt)) ?? null
}

export function scan_multi_importers(files, raw_sources = RAW_SOURCE_MODULES) {
  const candidates = new Set(raw_sources.map(normalized_path))
  const importers = new Map([...candidates].map((candidate) => [candidate, new Map()]))
  for (const file of files) {
    for (const { line, specifier } of import_specifiers(file.source)) {
      const candidate = resolve_candidate(file.path, specifier, candidates)
      if (candidate === null || candidate === file.path) continue
      const homes = importers.get(candidate)
      if (!homes.has(file.path)) homes.set(file.path, { line, path: file.path })
    }
  }
  return [...importers.entries()]
    .flatMap(([raw_source, homes]) =>
      homes.size > 1
        ? [
            {
              homes: [{ line: 1, path: raw_source }, ...homes.values()],
              importers: [...homes.values()].sort((left, right) => left.path.localeCompare(right.path)),
              kind: 'multi_importer',
              raw_source,
            },
          ]
        : []
    )
    .sort(
      (left, right) => right.importers.length - left.importers.length || left.raw_source.localeCompare(right.raw_source)
    )
}

function string_value(raw) {
  if (raw.startsWith('`') && raw.includes('${')) return null
  return raw.slice(1, -1).replaceAll(/\\(['"`\\])/g, '$1')
}

function import_literal_lines(source) {
  return new Set(import_specifiers(source).map(({ line }) => line))
}

function numeric_digit_count(raw) {
  const value = raw.replace(/n$/, '').replaceAll('_', '').toLowerCase()
  if (/^0[xbo]/.test(value)) return value.length - 2
  return value.replaceAll(/\D/g, '').length
}

export function scan_repeated_literals(files) {
  const occurrences = new Map()
  for (const file of files) {
    if (ignored_literal_path.test(file.path)) continue
    const import_lines = import_literal_lines(file.source)
    for (const token of lexical_tokens(file.source)) {
      let literal = null
      const literal_kind = token.kind
      if (token.kind === 'string' && !import_lines.has(token.line)) {
        literal = string_value(token.raw)
        if (literal === null || [...literal].length < 8 || !/[\p{L}\p{N}]/u.test(literal)) continue
      } else if (token.kind === 'number' && numeric_digit_count(token.raw) > 2) {
        literal = token.raw.replaceAll('_', '').toLowerCase()
      } else {
        continue
      }
      const key = `${literal_kind}\0${literal}`
      const finding = occurrences.get(key) ?? {
        by_file: new Map(),
        kind: 'repeated_literal',
        literal,
        literal_kind,
      }
      if (!finding.by_file.has(file.path)) finding.by_file.set(file.path, { line: token.line, path: file.path })
      occurrences.set(key, finding)
    }
  }
  return [...occurrences.values()]
    .filter(({ by_file }) => by_file.size >= 3)
    .map(({ by_file, ...finding }) => ({
      ...finding,
      homes: [...by_file.values()].sort((left, right) => left.path.localeCompare(right.path)),
    }))
    .sort(
      (left, right) =>
        right.homes.length - left.homes.length ||
        left.literal_kind.localeCompare(right.literal_kind) ||
        String(left.literal).localeCompare(String(right.literal))
    )
}

export function evaluate_ratchet(counts, baseline_counts) {
  const keys = ['clones', 'multi_importers', 'repeated_literals']
  const growth = keys.flatMap((key) =>
    counts[key] > baseline_counts[key] ? [{ actual: counts[key], baseline: baseline_counts[key], key }] : []
  )
  const shrink = keys.flatMap((key) =>
    counts[key] < baseline_counts[key] ? [{ actual: counts[key], baseline: baseline_counts[key], key }] : []
  )
  return {
    exit_code: growth.length > 0 ? 1 : 0,
    growth,
    shrink,
    suggested_baseline: growth.length === 0 && shrink.length > 0 ? { counts: { ...counts }, version: 1 } : null,
  }
}

function ranked_findings({ clones, multi_importers, repeated_literals }) {
  return [
    ...clones.map((finding) => ({ ...finding, rank: 300_000 + finding.line_count })),
    ...multi_importers.map((finding) => ({
      ...finding,
      rank: 200_000 + finding.importers.length,
    })),
    ...repeated_literals.map((finding) => ({ ...finding, rank: 100_000 + finding.homes.length })),
  ].sort(
    (left, right) =>
      right.rank - left.rank ||
      left.homes[0].path.localeCompare(right.homes[0].path) ||
      left.homes[0].line - right.homes[0].line
  )
}

const markdown_code = (value) => `\`${String(value).replaceAll('`', '\\`')}\``
const home_label = ({ line, path: home_path }) => markdown_code(`${home_path}:${line}`)

function finding_lines(finding, rank) {
  const label =
    finding.kind === 'clone'
      ? `clone · ${finding.line_count} structurally similar lines`
      : finding.kind === 'multi_importer'
        ? `multi-importer · ${finding.importers.length} importers of ${finding.raw_source}`
        : `${finding.literal_kind} literal · ${JSON.stringify(finding.literal)} · ${finding.homes.length} files`
  return [`${rank}. **${label}**`, ...finding.homes.map((home) => `   - home: ${home_label(home)}`)]
}

function format_ratchet(verdict) {
  const lines =
    verdict.growth.length > 0
      ? [
          '## Ratchet: FAIL',
          '',
          ...verdict.growth.map(
            ({ actual, baseline, key }) => `- ${markdown_code(key)} grew from ${baseline} to ${actual}.`
          ),
        ]
      : ['## Ratchet: PASS']
  if (verdict.suggested_baseline !== null)
    lines.push(
      '',
      'Counts shrank. Suggested baseline for a separate reviewed commit:',
      '',
      '```json',
      JSON.stringify(verdict.suggested_baseline, null, 2),
      '```'
    )
  return lines
}

function format_report(scans, verdict) {
  const counts = {
    clones: scans.clones.length,
    multi_importers: scans.multi_importers.length,
    repeated_literals: scans.repeated_literals.length,
  }
  const findings = ranked_findings(scans)
  return [
    '# Nuclear drift audit',
    '',
    ...format_ratchet(verdict),
    '',
    '| violation class | current |',
    '|---|---:|',
    `| clones | ${counts.clones} |`,
    `| multi-importers | ${counts.multi_importers} |`,
    `| repeated literals | ${counts.repeated_literals} |`,
    '',
    '## Ranked findings',
    '',
    ...(findings.length === 0
      ? ['No violations found.']
      : findings.flatMap((finding, index) => [...finding_lines(finding, index + 1), ''])),
  ].join('\n')
}

function walk_source_files(root, relative_directory) {
  const absolute_directory = path.join(root, relative_directory)
  return readdirSync(absolute_directory, { withFileTypes: true }).flatMap((entry) => {
    const relative_path = normalized_path(path.posix.join(relative_directory, entry.name))
    if (entry.isDirectory()) return walk_source_files(root, relative_path)
    return entry.isFile() && source_extensions.has(path.extname(entry.name))
      ? [{ path: relative_path, source: readFileSync(path.join(root, relative_path), 'utf8') }]
      : []
  })
}

function read_audit_files(root) {
  const package_sources = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const source_root = `packages/${entry.name}/src`
      try {
        return walk_source_files(root, source_root)
      } catch (error) {
        if (error?.code === 'ENOENT') return []
        throw error
      }
    })
  return [...package_sources, ...walk_source_files(root, 'api')].sort((left, right) =>
    left.path.localeCompare(right.path)
  )
}

function parse_args(argv) {
  const options = {
    baseline: 'scripts/fixtures/nuclear_audit_baseline.json',
    census: false,
    ratchet_counts: null,
    root: process.cwd(),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--census') options.census = true
    else if (argument === '--root') options.root = argv[++index]
    else if (argument === '--baseline') options.baseline = argv[++index]
    else if (argument === '--ratchet-counts') options.ratchet_counts = JSON.parse(argv[++index])
    else throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

function cli(argv, environment) {
  const options = parse_args(argv)
  const root = path.resolve(options.root)
  const baseline_path = path.resolve(root, options.baseline)
  const baseline =
    options.census && options.ratchet_counts === null ? null : JSON.parse(readFileSync(baseline_path, 'utf8'))
  if (options.ratchet_counts !== null) {
    const verdict = evaluate_ratchet(options.ratchet_counts, baseline.counts)
    return { exit_code: verdict.exit_code, output: `${format_ratchet(verdict).join('\n')}\n` }
  }
  const files = read_audit_files(root)
  const scans = {
    clones: scan_clones(files),
    multi_importers: scan_multi_importers(files),
    repeated_literals: scan_repeated_literals(files),
  }
  const counts = {
    clones: scans.clones.length,
    multi_importers: scans.multi_importers.length,
    repeated_literals: scans.repeated_literals.length,
  }
  const verdict = options.census
    ? { exit_code: 0, growth: [], shrink: [], suggested_baseline: null }
    : evaluate_ratchet(counts, baseline.counts)
  const output = `${format_report(scans, verdict)}\n`
  if (environment.GITHUB_STEP_SUMMARY) appendFileSync(environment.GITHUB_STEP_SUMMARY, output, 'utf8')
  return { exit_code: verdict.exit_code, output }
}

const invoked_path = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invoked_path === import.meta.url) {
  try {
    const result = cli(process.argv.slice(2), process.env)
    process.stdout.write(result.output)
    process.exitCode = result.exit_code
  } catch (error) {
    process.stderr.write(`nuclear audit error: ${error.stack ?? error}\n`)
    process.exitCode = 2
  }
}
