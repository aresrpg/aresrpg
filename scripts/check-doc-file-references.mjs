#!/usr/bin/env bun
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync as spawn_sync } from 'node:child_process'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_dir = path.dirname(file_url_to_path(import.meta.url))
const default_repo_root = path.resolve(script_dir, '..')
const repo_path_prefixes = ['.claude', '.github', 'api', 'changelog', 'docs', 'packages', 'scripts', 'test']
const repo_root_file_names = new Set([
  '.dependency-cruiser.cjs',
  '.env.example',
  '.gitignore',
  '.prettierignore',
  '.prettierrc',
  'bun.lock',
  'bunfig.toml',
  'CLA.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'eslint.config.js',
  'FROZEN.md',
  'LICENSE',
  'package.json',
  'README.md',
  'SECURITY.md',
  'tsconfig.lint.json',
])
const line_selector_pattern = /:\d+(?:(?:-\d+)|(?:,\d+)*)?$/
const glob_pattern = /[*?[]/
const remote_target_pattern = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const host_absolute_pattern = /^\/(?:Users|home|private|tmp|var|opt|etc|workspace|workspaces)\//
const windows_absolute_pattern = /^(?:[a-z]:[\\/]|\\\\)/i
const hidden_root_file_pattern =
  /^(?:\.\/)?\.[a-z\d_-][a-z\d_.-]*\.(?:cjs|js|json|mjs|toml|ya?ml)(?::\d+(?:(?:-\d+)|(?:,\d+)*)?)?$/i
const bare_file_pattern =
  /^[^./\\][^/\\]*\.(?:cjs|css|csv|d\.ts|glb|html|jsx?|json|lock|md|mjs|move|png|py|sh|svelte|svg|toml|tsx?|txt|wasm|webp|ya?ml)$/i
const deliberate_example_allowlist = [
  {
    cited_path: 'assets/env-*.js',
    doc_path: 'docs/CSP.md',
    reason: 'generated deployment asset pattern, not a source-tree path',
  },
  {
    cited_path: '/draco/*.wasm',
    doc_path: 'docs/CSP.md',
    reason: 'deployed URL pattern, not a source-tree path',
  },
  {
    cited_path: 'dist/index.html',
    doc_path: 'docs/CSP.md',
    reason: 'generated build output, not a source-tree path',
  },
  {
    cited_path: 'constants/simulator.ts',
    doc_path: 'docs/design/simulator_rebuild_spec.md',
    reason: 'legacy file named in the specification deletion list',
  },
  {
    cited_path: 'pages/simulator_content.ts',
    doc_path: 'docs/design/simulator_rebuild_spec.md',
    reason: 'legacy file named in the specification deletion list',
  },
  {
    cited_path: 'world_corpus.json',
    doc_path: 'docs/design/simulator_rebuild_spec.md',
    reason: 'published runtime blob, not a source-tree file',
  },
  {
    cited_path: 'aresrpg-simfight-<seed>-<fight_id>.json',
    doc_path: 'docs/design/simulator_rebuild_spec.md',
    reason: 'generated trace-download filename, not a source-tree file',
  },
]

export function strip_fenced_blocks(markdown) {
  const reduced = markdown.split('\n').reduce(
    (state, line) => {
      const opening = state.fence === null ? line.match(/^ {0,3}(`{3,}|~{3,})/) : null
      const closing =
        state.fence === null ? null : line.match(new RegExp(`^ {0,3}${state.fence[0]}{${state.fence.length},}\\s*$`))
      if (opening)
        return {
          fence: opening[1],
          lines: [...state.lines, ''],
        }
      if (closing)
        return {
          fence: null,
          lines: [...state.lines, ''],
        }
      return {
        fence: state.fence,
        lines: [...state.lines, state.fence === null ? line : ''],
      }
    },
    { fence: null, lines: [] }
  )
  return reduced.lines.join('\n')
}

export function expand_braces(reference_path) {
  const opening_index = reference_path.indexOf('{')
  if (opening_index === -1) return [reference_path]
  const closing_index = reference_path.indexOf('}', opening_index + 1)
  if (closing_index === -1) return [reference_path]
  const prefix = reference_path.slice(0, opening_index)
  const suffix = reference_path.slice(closing_index + 1)
  return reference_path
    .slice(opening_index + 1, closing_index)
    .split(',')
    .flatMap((choice) => expand_braces(`${prefix}${choice}${suffix}`))
}

export function strip_line_selector(reference_path) {
  return reference_path.replace(line_selector_pattern, '')
}

function line_number_at(markdown, index) {
  return markdown.slice(0, index).split('\n').length
}

function normalize_cited_path(cited_path) {
  return cited_path.replace(/^[("'[|]+/, '').replace(/[)"'\],.;|]+$/, '')
}

function path_arms_are_file_shaped(cited_path) {
  return expand_braces(cited_path).every((arm) => {
    const selectorless_arm = strip_line_selector(arm).replaceAll('\\', '/')
    const basename = selectorless_arm.slice(selectorless_arm.lastIndexOf('/') + 1)
    return /\.[a-z][a-z\d+_-]*$/i.test(basename)
  })
}

function code_token_reference(raw_token, doc_path, line) {
  const cited_path = normalize_cited_path(raw_token)
  if (cited_path.length === 0 || cited_path.startsWith('@')) return null
  if (host_absolute_pattern.test(cited_path) || windows_absolute_pattern.test(cited_path))
    return {
      cited_path,
      doc_path,
      kind: 'host-absolute',
      line,
    }
  if (remote_target_pattern.test(cited_path)) return null
  const selectorless_path = strip_line_selector(cited_path)
  const root_file = repo_root_file_names.has(selectorless_path) || hidden_root_file_pattern.test(cited_path)
  const file_shaped = path_arms_are_file_shaped(cited_path)
  const known_prefix = repo_path_prefixes.some(
    (prefix) => selectorless_path.startsWith(`${prefix}/`) || selectorless_path.startsWith(`./${prefix}/`)
  )
  const suffix_path = file_shaped && selectorless_path.includes('/')
  const basename =
    file_shaped &&
    !selectorless_path.includes('/') &&
    expand_braces(selectorless_path).every((arm) => bare_file_pattern.test(arm))
  if (!root_file && !known_prefix && !suffix_path && !basename) return null
  return {
    cited_path,
    doc_path,
    kind: root_file || known_prefix ? 'repo' : suffix_path ? 'repo-suffix' : 'repo-basename',
    line,
  }
}

function code_span_references(markdown, doc_path) {
  const without_fences = strip_fenced_blocks(markdown)
  const prefix_pattern = repo_path_prefixes.map((prefix) => prefix.replace('.', '\\.')).join('|')
  return [...without_fences.matchAll(/(`+)([\s\S]*?)\1/g)].flatMap((code_match) => {
    const [, , code] = code_match
    const code_index = code_match.index ?? 0
    const repo_references = [...code.matchAll(/\S+/g)].flatMap((token_match) => {
      const reference = code_token_reference(
        token_match[0],
        doc_path,
        line_number_at(without_fences, code_index + (token_match.index ?? 0))
      )
      return reference === null ? [] : [reference]
    })
    const split_path_pattern = new RegExp(
      `((?:\\.\\/)?(?:${prefix_pattern})\\/[A-Za-z0-9_./*?{},@+\\-\\[\\]]*[/_.-])\\r?\\n([A-Za-z0-9_.-]+)`,
      'g'
    )
    const split_references = [
      ...[...code.matchAll(split_path_pattern)].map((path_match) => ({
        cited_path: `${path_match[1]}\n${path_match[2]}`,
        doc_path,
        kind: 'split',
        line: line_number_at(without_fences, code_index + (path_match.index ?? 0)),
      })),
      ...[...code.matchAll(/(\S+)\r?\n(\S+)/g)].flatMap((path_match) => {
        const joined_reference = code_token_reference(
          `${path_match[1]}${path_match[2]}`,
          doc_path,
          line_number_at(without_fences, code_index + (path_match.index ?? 0))
        )
        return joined_reference === null
          ? []
          : [
              {
                cited_path: `${path_match[1]}\n${path_match[2]}`,
                doc_path,
                kind: 'split',
                line: joined_reference.line,
              },
            ]
      }),
    ]
    return [...repo_references, ...split_references]
  })
}

function local_link_target(target) {
  const without_wrapper = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
  if (without_wrapper.startsWith('#') || remote_target_pattern.test(without_wrapper)) return null
  const [before_fragment] = without_wrapper.split('#', 1)
  const [without_fragment] = before_fragment.split('?', 1)
  if (without_fragment.length === 0) return null
  try {
    return decodeURIComponent(without_fragment)
  } catch {
    return without_fragment
  }
}

function markdown_link_references(markdown, doc_path) {
  const without_fences = strip_fenced_blocks(markdown)
  const inline_matches = [...without_fences.matchAll(/!?\[[^\]]*]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g)]
  const definition_matches = [...without_fences.matchAll(/^\s*\[[^\]]+]:\s*(<[^>]+>|\S+)/gm)]
  return [...inline_matches, ...definition_matches].flatMap((link_match) => {
    const target = local_link_target(link_match[1])
    return target === null
      ? []
      : [
          {
            cited_path: target,
            doc_path,
            kind: 'document',
            line: line_number_at(without_fences, link_match.index ?? 0),
          },
        ]
  })
}

export function collect_references(markdown, doc_path) {
  const references = [...code_span_references(markdown, doc_path), ...markdown_link_references(markdown, doc_path)]
  return references
    .filter(
      (reference, index) =>
        references.findIndex(
          (candidate) =>
            candidate.cited_path === reference.cited_path &&
            candidate.doc_path === reference.doc_path &&
            candidate.kind === reference.kind &&
            candidate.line === reference.line
        ) === index
    )
    .toSorted(
      (left, right) =>
        left.line - right.line || left.cited_path.localeCompare(right.cited_path) || left.kind.localeCompare(right.kind)
    )
}

function path_is_inside(repo_root, absolute_path) {
  const relative_path = path.relative(repo_root, absolute_path)
  return relative_path === '' || (!relative_path.startsWith(`..${path.sep}`) && relative_path !== '..')
}

export function exact_path_exists(absolute_path, repo_root) {
  if (!path_is_inside(repo_root, absolute_path)) return false
  const relative_path = path.relative(repo_root, absolute_path)
  if (relative_path === '') return true
  return relative_path.split(path.sep).reduce(
    (state, segment) => {
      if (!state.exists) return state
      try {
        const exact_segment = fs.readdirSync(state.current_path).includes(segment)
        return {
          current_path: exact_segment ? path.join(state.current_path, segment) : state.current_path,
          exists: exact_segment,
        }
      } catch {
        return {
          current_path: state.current_path,
          exists: false,
        }
      }
    },
    { current_path: repo_root, exists: true }
  ).exists
}

function absolute_reference_path(reference, repo_root) {
  const cited_path = strip_line_selector(reference.cited_path)
  if (reference.kind === 'document') {
    if (host_absolute_pattern.test(cited_path)) return path.resolve(repo_root, cited_path.slice(1))
    return cited_path.startsWith('/')
      ? path.resolve(repo_root, cited_path.slice(1))
      : path.resolve(repo_root, path.dirname(reference.doc_path), cited_path)
  }
  return path.resolve(repo_root, cited_path.replace(/^\.?\//, ''))
}

function arm_resolves(reference_arm, repo_root, path_exists, find_matches) {
  const absolute_path = absolute_reference_path(
    {
      ...reference_arm.reference,
      cited_path: reference_arm.arm,
    },
    repo_root
  )
  if (!path_is_inside(repo_root, absolute_path)) return false
  if (!glob_pattern.test(reference_arm.arm) && path_exists(absolute_path, repo_root)) return true
  const relative_pattern = path.relative(repo_root, absolute_path).split(path.sep).join('/')
  const direct_matches = find_matches(relative_pattern, repo_root)
  if (direct_matches.some((match_path) => path_exists(path.resolve(repo_root, match_path), repo_root))) return true
  if (!['repo-basename', 'repo-suffix'].includes(reference_arm.reference.kind)) return false
  const normalized_suffix = reference_arm.arm.replace(/^\.?\//, '')
  return find_matches(`**/${normalized_suffix}`, repo_root).some((match_path) =>
    path_exists(path.resolve(repo_root, match_path), repo_root)
  )
}

export function unresolved_references(
  references,
  {
    repo_root,
    path_exists = exact_path_exists,
    allowlist = deliberate_example_allowlist,
    find_matches = (reference_pattern, root) =>
      fs.globSync(reference_pattern, {
        cwd: root,
        exclude: ['.git/**', 'node_modules/**'],
      }),
  }
) {
  return references.flatMap((reference) => {
    if (
      allowlist.some(
        (allowed_reference) =>
          allowed_reference.cited_path === reference.cited_path && allowed_reference.doc_path === reference.doc_path
      )
    )
      return []
    if (reference.kind === 'host-absolute')
      return [
        {
          ...reference,
          reason: 'host-absolute path',
        },
      ]
    if (reference.kind === 'split')
      return [
        {
          ...reference,
          reason: 'path is split across lines',
        },
      ]
    const reference_path = strip_line_selector(reference.cited_path)
    const arms = expand_braces(reference_path)
    const missing_arms = arms.filter(
      (arm) =>
        !arm_resolves(
          {
            arm,
            reference,
          },
          repo_root,
          path_exists,
          find_matches
        )
    )
    return missing_arms.map((missing_arm) => ({
      ...reference,
      reason: path_is_inside(repo_root, absolute_reference_path(reference, repo_root))
        ? `missing target${arms.length > 1 ? ` (${missing_arm})` : ''}`
        : 'path escapes repository',
    }))
  })
}

export function list_doc_paths(repo_root) {
  const result = spawn_sync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs/**/*.md', 'docs/*.md'],
    {
      cwd: repo_root,
      encoding: 'utf8',
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ls-files exited ${result.status}`)
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

function list_repo_paths(repo_root) {
  const result = spawn_sync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repo_root,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ls-files exited ${result.status}`)
  return result.stdout.split('\0').filter(Boolean)
}

export function check_doc_file_references(repo_root) {
  const doc_paths = list_doc_paths(repo_root)
  if (doc_paths.length === 0) throw new Error('no Markdown files found under docs/')
  const repo_paths = list_repo_paths(repo_root)
  const references = doc_paths.flatMap((doc_path) =>
    collect_references(fs.readFileSync(path.resolve(repo_root, doc_path), 'utf8'), doc_path)
  )
  const unresolved = unresolved_references(references, {
    find_matches: (reference_pattern) => {
      const matcher = new Bun.Glob(reference_pattern)
      return repo_paths.filter((repo_path) => matcher.match(repo_path))
    },
    repo_root,
  }).sort(
    (left, right) =>
      left.doc_path.localeCompare(right.doc_path) ||
      left.line - right.line ||
      left.cited_path.localeCompare(right.cited_path)
  )
  return {
    doc_count: doc_paths.length,
    reference_count: references.length,
    unresolved,
  }
}

export function doc_reference_blind_guard() {
  const cited_path = 'scripts/fresh-doc-reference-control.mjs'
  const references = collect_references(`\`${cited_path}\``, 'docs/fresh-control.md')
  const unresolved = unresolved_references(references, {
    find_matches: () => [],
    path_exists: () => false,
    repo_root: '/fresh-doc-reference-control',
  })
  return (
    unresolved.length === 1 &&
    unresolved[0].cited_path === cited_path &&
    unresolved[0].reason === 'missing target'
  )
}

function parse_root_argument(args) {
  if (args.length === 0) return default_repo_root
  if (args.length === 2 && args[0] === '--root') return path.resolve(args[1])
  throw new Error('usage: bun scripts/check-doc-file-references.mjs [--root <repository>]')
}

function main() {
  try {
    const repo_root = parse_root_argument(process.argv.slice(2))
    const fresh_control = Number(doc_reference_blind_guard())
    console.log(`docs file references control trip (expected): fresh_unresolved=${fresh_control}`)
    if (fresh_control !== 1) {
      console.error('docs file references: FAIL (blind guard did not reject its fresh missing citation)')
      return 1
    }
    const result = check_doc_file_references(repo_root)
    if (result.unresolved.length === 0) {
      console.log(`docs file references: PASS (${result.doc_count} docs, ${result.reference_count} references)`)
      return 0
    }
    console.error(`docs file references: FAIL (${result.unresolved.length} unresolved of ${result.reference_count})`)
    result.unresolved.forEach((reference) =>
      console.error(`${reference.doc_path}:${reference.line} -> ${reference.cited_path} (${reference.reason})`)
    )
    return 1
  } catch (error) {
    console.error(`docs file references: ERROR (${error instanceof Error ? error.message : String(error)})`)
    return 2
  }
}

if (import.meta.main) process.exitCode = main()
