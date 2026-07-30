// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  collect_references,
  expand_braces,
  strip_fenced_blocks,
  strip_line_selector,
  unresolved_references,
} from '../../scripts/check-doc-file-references.mjs'

const repo_root = '/repo'
const known_paths = new Set([
  '/repo/README.md',
  '/repo/docs/guide.md',
  '/repo/packages/frontend/src/game/core/report.js',
  '/repo/packages/frontend/src/app.tsx',
  '/repo/packages/frontend/src/a.js',
  '/repo/packages/frontend/src/b.ts',
  '/repo/scripts/check.sh',
])
const path_exists = (absolute_path) => known_paths.has(absolute_path)
const find_matches = (reference_pattern) =>
  ({
    '**/game/**/report.js': ['packages/frontend/src/game/core/report.js'],
    '**/game/core/report.js': ['packages/frontend/src/game/core/report.js'],
    '**/app.tsx': ['packages/frontend/src/app.tsx'],
    'packages/frontend/src/*.tsx': ['packages/frontend/src/app.tsx'],
  })[reference_pattern] ?? []

describe('docs file-reference gate', () => {
  test('expands every brace arm and strips source line selectors', () => {
    expect(expand_braces('packages/frontend/src/{a.js,b.ts}')).toEqual([
      'packages/frontend/src/a.js',
      'packages/frontend/src/b.ts',
    ])
    expect(strip_line_selector('packages/frontend/src/app.tsx:12-19')).toBe('packages/frontend/src/app.tsx')
    expect(strip_line_selector('packages/frontend/src/app.tsx:12,20,31')).toBe('packages/frontend/src/app.tsx')
  })

  test('collects root, repo-qualified, and suffix code citations plus local Markdown links', () => {
    const markdown = [
      '`README.md`',
      '`packages/frontend/src/app.tsx:12-19`',
      '`game/core/report.js`',
      '`seed/mainnet/missing.json`',
      '[guide](./guide.md#usage)',
      '[remote](https://example.com/missing.md)',
      '`@aresrpg/frontend` `/v1/fights` `app.tsx`',
      '`.missing-root-config.json`',
    ].join('\n')
    expect(collect_references(markdown, 'docs/readme.md')).toEqual([
      {
        cited_path: 'README.md',
        doc_path: 'docs/readme.md',
        kind: 'repo',
        line: 1,
      },
      {
        cited_path: 'packages/frontend/src/app.tsx:12-19',
        doc_path: 'docs/readme.md',
        kind: 'repo',
        line: 2,
      },
      {
        cited_path: 'game/core/report.js',
        doc_path: 'docs/readme.md',
        kind: 'repo-suffix',
        line: 3,
      },
      {
        cited_path: 'seed/mainnet/missing.json',
        doc_path: 'docs/readme.md',
        kind: 'repo-suffix',
        line: 4,
      },
      {
        cited_path: './guide.md',
        doc_path: 'docs/readme.md',
        kind: 'document',
        line: 5,
      },
      {
        cited_path: 'app.tsx',
        doc_path: 'docs/readme.md',
        kind: 'repo-basename',
        line: 7,
      },
      {
        cited_path: '.missing-root-config.json',
        doc_path: 'docs/readme.md',
        kind: 'repo',
        line: 8,
      },
    ])
  })

  test('collects arbitrary file extensions, bare file names, and Windows host paths', () => {
    const markdown = [
      '`src/missing.svelte`',
      '`seed/missing.csv`',
      '`game/missing.py`',
      '`game/missing.svg`',
      '`new-root-config.json`',
      '`C:\\repo\\missing.ts`',
    ].join('\n')

    const references = collect_references(markdown, 'docs/guide.md')
    expect(references.map(({ cited_path, kind }) => ({ cited_path, kind }))).toEqual([
      { cited_path: 'src/missing.svelte', kind: 'repo-suffix' },
      { cited_path: 'seed/missing.csv', kind: 'repo-suffix' },
      { cited_path: 'game/missing.py', kind: 'repo-suffix' },
      { cited_path: 'game/missing.svg', kind: 'repo-suffix' },
      { cited_path: 'new-root-config.json', kind: 'repo-basename' },
      { cited_path: 'C:\\repo\\missing.ts', kind: 'host-absolute' },
    ])
    expect(
      unresolved_references(references, {
        find_matches,
        path_exists,
        repo_root,
      }).map(({ cited_path, reason }) => ({ cited_path, reason }))
    ).toEqual([
      { cited_path: 'src/missing.svelte', reason: 'missing target' },
      { cited_path: 'seed/missing.csv', reason: 'missing target' },
      { cited_path: 'game/missing.py', reason: 'missing target' },
      { cited_path: 'game/missing.svg', reason: 'missing target' },
      { cited_path: 'new-root-config.json', reason: 'missing target' },
      { cited_path: 'C:\\repo\\missing.ts', reason: 'host-absolute path' },
    ])
  })

  test('suffix citations must resolve to a repository path', () => {
    const references = collect_references(
      ['`game/core/report.js`', '`game/report.js`', '`game/core/missing.js`'].join('\n'),
      'docs/guide.md'
    )
    expect(
      unresolved_references(references, {
        find_matches,
        path_exists,
        repo_root,
      }).map(({ cited_path, reason }) => ({ cited_path, reason }))
    ).toEqual([
      {
        cited_path: 'game/report.js',
        reason: 'missing target',
      },
      {
        cited_path: 'game/core/missing.js',
        reason: 'missing target',
      },
    ])
  })

  test('named repository-root files do not fall back to a same-named package file', () => {
    const references = collect_references(['`README.md`', '`package.json`'].join('\n'), 'docs/guide.md')
    expect(
      unresolved_references(references, {
        find_matches: (reference_pattern) =>
          reference_pattern === '**/package.json' ? ['packages/frontend/package.json'] : [],
        path_exists,
        repo_root,
      }).map(({ cited_path, reason }) => ({ cited_path, reason }))
    ).toEqual([
      {
        cited_path: 'package.json',
        reason: 'missing target',
      },
    ])
  })

  test('ignores fenced examples while preserving source line numbers', () => {
    const markdown = ['```sh', 'cat packages/missing.js', '```', '', '`scripts/check.sh`'].join('\n')
    expect(strip_fenced_blocks(markdown).split('\n')).toHaveLength(5)
    expect(collect_references(markdown, 'docs/guide.md')).toEqual([
      {
        cited_path: 'scripts/check.sh',
        doc_path: 'docs/guide.md',
        kind: 'repo',
        line: 5,
      },
    ])
  })

  test('requires all brace arms and at least one glob match', () => {
    const references = collect_references(
      [
        '`packages/frontend/src/{a.js,b.ts}`',
        '`packages/frontend/src/*.tsx`',
        '`packages/frontend/src/{a.js,missing.ts}`',
      ].join('\n'),
      'docs/guide.md'
    )
    expect(
      unresolved_references(references, {
        find_matches,
        path_exists,
        repo_root,
      })
    ).toEqual([
      {
        cited_path: 'packages/frontend/src/{a.js,missing.ts}',
        doc_path: 'docs/guide.md',
        kind: 'repo',
        line: 3,
        reason: 'missing target (packages/frontend/src/missing.ts)',
      },
    ])
  })

  test('rejects missing links, repository escapes, host paths, and split citations', () => {
    const markdown = [
      '[missing](./missing.md)',
      '[escape](../../outside.md)',
      '`/home/alice/packages/frontend/src/app.tsx`',
      '`/workspace/repo/packages/frontend/src/app.tsx`',
      '`packages/frontend/src/app.',
      'tsx`',
      '`game/core/missing.',
      'js`',
    ].join('\n')
    expect(
      unresolved_references(collect_references(markdown, 'docs/guide.md'), {
        find_matches,
        path_exists,
        repo_root,
      }).map(({ cited_path, reason }) => ({ cited_path, reason }))
    ).toEqual([
      {
        cited_path: './missing.md',
        reason: 'missing target',
      },
      {
        cited_path: '../../outside.md',
        reason: 'path escapes repository',
      },
      {
        cited_path: '/home/alice/packages/frontend/src/app.tsx',
        reason: 'host-absolute path',
      },
      {
        cited_path: '/workspace/repo/packages/frontend/src/app.tsx',
        reason: 'host-absolute path',
      },
      {
        cited_path: 'packages/frontend/src/app',
        reason: 'missing target',
      },
      {
        cited_path: 'packages/frontend/src/app.\ntsx',
        reason: 'path is split across lines',
      },
      {
        cited_path: 'game/core/missing.\njs',
        reason: 'path is split across lines',
      },
    ])
  })

  test('allowlists only an exact deliberate example in its named document', () => {
    const references = [
      ...collect_references('`assets/env-*.js`', 'docs/CSP.md'),
      ...collect_references('`assets/env-*.js`', 'docs/guide.md'),
    ]
    expect(
      unresolved_references(references, {
        find_matches,
        path_exists,
        repo_root,
      }).map(({ cited_path, doc_path }) => ({ cited_path, doc_path }))
    ).toEqual([
      {
        cited_path: 'assets/env-*.js',
        doc_path: 'docs/guide.md',
      },
    ])
  })
})
