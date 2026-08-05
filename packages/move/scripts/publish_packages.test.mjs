// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PUBLISH_PACKAGES TEST — the ceremony's package graph is hand-WRITTEN but never hand-TRUSTED.
//
// publish_packages.mjs is the one home for "which Move packages exist and what each depends on"; everything
// downstream (publishOrder's topological sort, the release-pin set, the release manifest) derives from it. A
// hand-maintained list is only as good as whoever remembers to update it — #2229 is what that costs: a
// package graph and its serialized artifact drifted apart for three weeks and the ceremony's own suite could
// not say so. So every row here is pinned to the Move.toml files on disk, which are the compiler's truth:
// add a package directory or a `local = "../sibling"` edge without telling the graph and this goes red.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test, expect } from 'bun:test'

import { TICKET_ORDER, PKG_DEPS } from './publish_packages.mjs'

const MOVE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..') // packages/move

/** Every subdirectory of packages/move that is itself a Move package (has a Move.toml). */
const move_package_dirs = () =>
  readdirSync(MOVE_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(MOVE_DIR, e.name, 'Move.toml')))
    .map((e) => e.name)

/** The sibling packages a Move.toml links against (`local = "../<dir>"`) — framework/git deps are not ours. */
const local_deps = (pkg) =>
  [...readFileSync(join(MOVE_DIR, pkg, 'Move.toml'), 'utf8').matchAll(/^\s*local\s*=\s*"\.\.\/([\w-]+)"/gm)].map(
    (m) => m[1]
  )

test('the graph lists exactly the Move packages that exist on disk', () => {
  const on_disk = move_package_dirs()
  expect(on_disk.length).toBeGreaterThan(0) // positive control: the scan found packages at all
  expect([...TICKET_ORDER].sort()).toEqual([...on_disk].sort())
})

test('every PKG_DEPS row is its Move.toml local dependency set, edge for edge', () => {
  expect(local_deps('aresrpg').length).toBeGreaterThan(0) // positive control: the toml scan parses edges at all
  for (const pkg of TICKET_ORDER)
    expect({ [pkg]: [...PKG_DEPS[pkg]].sort() }).toEqual({
      [pkg]: [...new Set(local_deps(pkg))].sort(),
    })
})
