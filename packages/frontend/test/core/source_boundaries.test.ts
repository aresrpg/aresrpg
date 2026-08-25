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
    const allocates = (node: ts.Expression): boolean => {
      if (
        ts.isArrayLiteralExpression(node) ||
        ts.isObjectLiteralExpression(node) ||
        ts.isNewExpression(node) ||
        (ts.isCallExpression(node) &&
          ((ts.isPropertyAccessExpression(node.expression) && allocating_methods.has(node.expression.name.text)) ||
            node.expression.getText() === 'Object.freeze'))
      )
        return true
      let nested = false
      node.forEachChild((child) => {
        if (!nested && ts.isExpression(child) && allocates(child)) nested = true
      })
      return nested
    }
    const function_allocates = (body: ts.ConciseBody): boolean => {
      if (ts.isExpression(body)) return allocates(body)
      let found = false
      const inspect = (node: ts.Node): void => {
        if (found) return
        if (ts.isReturnStatement(node) && node.expression && allocates(node.expression)) found = true
        else ts.forEachChild(node, inspect)
      }
      inspect(body)
      return found
    }
    const documents = await Promise.all(
      (await source_files(source_root)).map(async (file) => {
        const source = await readFile(file, 'utf8')
        return Object.freeze({
          file,
          parsed: ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
        })
      })
    )
    const exported_allocators = new Set<string>()
    const local_allocators = new Map<string, ReadonlySet<string>>()
    documents.forEach(({ file, parsed }) => {
      const names = new Set<string>()
      parsed.forEachChild((node) => {
        const exported =
          ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
        if (ts.isFunctionDeclaration(node) && node.name && node.body && function_allocates(node.body)) {
          names.add(node.name.text)
          if (exported) exported_allocators.add(node.name.text)
        }
        if (ts.isVariableStatement(node))
          node.declarationList.declarations.forEach((declaration) => {
            if (
              !ts.isIdentifier(declaration.name) ||
              !declaration.initializer ||
              (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) ||
              !function_allocates(declaration.initializer.body)
            )
              return
            names.add(declaration.name.text)
            if (exported) exported_allocators.add(declaration.name.text)
          })
      })
      local_allocators.set(file, names)
    })
    const violations = documents.flatMap(({ file, parsed }) => {
      const rows: string[] = []
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(parsed) === 'useAppStore' &&
          node.arguments[0] &&
          ((ts.isArrowFunction(node.arguments[0]) && function_allocates(node.arguments[0].body)) ||
            (ts.isIdentifier(node.arguments[0]) &&
              (local_allocators.get(file)?.has(node.arguments[0].text) ||
                exported_allocators.has(node.arguments[0].text))))
        ) {
          const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1
          rows.push(`${file}:${line}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
      return rows
    })

    expect(violations).toEqual([])
  })
})
