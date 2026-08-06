// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs'])
const TEST_FILE = /\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs)$/

/** Recursively lists shipped source files without making static scans reread colocated test support. */
export function production_source_paths(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name === 'test_helpers') return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return production_source_paths(path)
    return SOURCE_EXTENSIONS.has(extname(entry.name)) && !TEST_FILE.test(entry.name) ? [path] : []
  })
}
