// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

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

  test('active source exposes no retired sponsorship surface', async () => {
    const violations = (
      await Promise.all(
        (await source_files(source_root)).map(async (file) => {
          const source = await readFile(file, 'utf8')
          return /sponsor(?:ed|ship)?/i.test(source) ? [file] : []
        })
      )
    ).flat()
    expect(violations).toEqual([])
  })

  test('the mounted session observer exclusively owns remembered-auth restoration', async () => {
    const [entry, session] = await Promise.all([
      readFile(resolve(source_root, 'main.tsx'), 'utf8'),
      readFile(resolve(source_root, 'modules/session.ts'), 'utf8'),
    ])
    expect(entry).not.toContain("type: 'auth/connecting'")
    expect(session).toContain('read_auth_wallet(storage)')
  })
})
