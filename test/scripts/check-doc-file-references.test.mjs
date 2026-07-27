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
  '/repo/docs/guide.md',
  '/repo/packages/frontend/src/app.tsx',
  '/repo/packages/frontend/src/a.js',
  '/repo/packages/frontend/src/b.ts',
  '/repo/scripts/check.sh',
])
const path_exists = (absolute_path) => known_paths.has(absolute_path)
const find_matches = (reference_pattern) =>
  reference_pattern === 'packages/frontend/src/*.tsx' ? ['packages/frontend/src/app.tsx'] : []

describe('docs file-reference gate', () => {
  test('expands every brace arm and strips source line selectors', () => {
    expect(expand_braces('packages/frontend/src/{a.js,b.ts}')).toEqual([
      'packages/frontend/src/a.js',
      'packages/frontend/src/b.ts',
    ])
    expect(strip_line_selector('packages/frontend/src/app.tsx:12-19')).toBe('packages/frontend/src/app.tsx')
    expect(strip_line_selector('packages/frontend/src/app.tsx:12,20,31')).toBe('packages/frontend/src/app.tsx')
  })

  test('collects repo-qualified code citations and local Markdown links', () => {
    const markdown = [
      '`packages/frontend/src/app.tsx:12-19`',
      '[guide](./guide.md#usage)',
      '[remote](https://example.com/missing.md)',
      '`@aresrpg/frontend` `/v1/fights` `app.tsx`',
      '`.missing-root-config.json`',
    ].join('\n')
    expect(collect_references(markdown, 'docs/readme.md')).toEqual([
      {
        cited_path: 'packages/frontend/src/app.tsx:12-19',
        doc_path: 'docs/readme.md',
        kind: 'repo',
        line: 1,
      },
      {
        cited_path: './guide.md',
        doc_path: 'docs/readme.md',
        kind: 'document',
        line: 2,
      },
      {
        cited_path: '.missing-root-config.json',
        doc_path: 'docs/readme.md',
        kind: 'repo',
        line: 5,
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
      '`/Users/dev/repo/packages/frontend/src/app.tsx`',
      '`packages/frontend/src/app.',
      'tsx`',
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
        cited_path: '/Users/dev/repo/packages/frontend/src/app.tsx',
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
    ])
  })
})
