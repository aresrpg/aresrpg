// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'
import ts from 'typescript'

const source_root = resolve(import.meta.dir, '../../src')

const source_files = async (directory: string): Promise<readonly string[]> =>
  (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) return source_files(path)
        return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
      })
    )
  ).flat()

describe('frontend source boundaries', () => {
  test('active source imports neither deprecated code nor Sui plumbing', async () => {
    const violations = (
      await Promise.all(
        (await source_files(source_root)).map(async (file) => {
          const source = await readFile(file, 'utf8')
          return /(?:from\s*|import\s*\(|require\s*\()\s*["'](?:[^"']*deprecated|@mysten\/)/.test(source) ? [file] : []
        })
      )
    ).flat()
    expect(violations).toEqual([])
  })

  test('Zustand selectors return cached store slices instead of allocating snapshots', async () => {
    const allocating_methods = new Set(['filter', 'flatMap', 'map', 'slice', 'toReversed', 'toSorted'])
    const allocates = (node: ts.Expression): boolean =>
      ts.isArrayLiteralExpression(node) ||
      ts.isObjectLiteralExpression(node) ||
      ts.isNewExpression(node) ||
      (ts.isCallExpression(node) &&
        ((ts.isPropertyAccessExpression(node.expression) && allocating_methods.has(node.expression.name.text)) ||
          node.expression.getText() === 'Object.freeze'))
    const violations = (
      await Promise.all(
        (await source_files(source_root)).map(async (file) => {
          const source = await readFile(file, 'utf8')
          const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
          const rows: string[] = []
          const visit = (node: ts.Node): void => {
            if (
              ts.isCallExpression(node) &&
              node.expression.getText(parsed) === 'useAppStore' &&
              node.arguments[0] &&
              ts.isArrowFunction(node.arguments[0]) &&
              ts.isExpression(node.arguments[0].body) &&
              allocates(node.arguments[0].body)
            ) {
              const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1
              rows.push(`${file}:${line}`)
            }
            ts.forEachChild(node, visit)
          }
          visit(parsed)
          return rows
        })
      )
    ).flat()

    expect(violations).toEqual([])
  })
})
