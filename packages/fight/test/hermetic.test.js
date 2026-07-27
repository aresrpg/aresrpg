// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// M1 HERMETICITY GATE (node-side twin of ares-test fightcore gate a + depcruise fight-core-hermetic):
// the package's ENTIRE src import graph resolves inside {itself, @aresrpg/sim, @aresrpg/sdk, zustand/vanilla,
// node:*} — zero DOM, zero React, zero three.js, zero frontend reach-back. Runs with the package suite, so a
// hermeticity break fails IN the package before any repo-level gate sees it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

const pkg_dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src_dir = path.join(pkg_dir, 'src')

const src_files = fs
  .readdirSync(src_dir)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map((f) => path.join(src_dir, f))

const ALLOWED = /^(\.\/|@aresrpg\/(sim|sdk)(\/|$)|zustand\/vanilla$|node:)/
const import_specifiers = (text) =>
  [...text.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('@aresrpg/fight hermeticity (D769 MODULE LAW)', () => {
  test('every src import specifier is inside the fence — zero exemptions', () => {
    const violations = []
    for (const file of src_files)
      for (const spec of import_specifiers(fs.readFileSync(file, 'utf8')))
        if (!ALLOWED.test(spec)) violations.push(`${path.basename(file)} → ${spec}`)
    expect(violations).toEqual([])
  })

  test('zero browser/render vocabulary in src (DOM, React, three, storage, timers-as-imports)', () => {
    const BANNED =
      /from\s*['"](react|react-dom|three|@aresrpg\/engine3)['"/]|\b(document\.|sessionStorage|localStorage|window\.location)\b/
    const hits = []
    for (const file of src_files) {
      const text = fs.readFileSync(file, 'utf8')
      if (BANNED.test(text)) hits.push(path.basename(file))
    }
    expect(hits).toEqual([])
  })

  test('package.json dependencies are exactly the fence (sim, sdk, zustand)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkg_dir, 'package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@aresrpg/sdk', '@aresrpg/sim', 'zustand'])
    expect(pkg.devDependencies).toBeUndefined()
  })

  test('the whole surface imports clean in node (no lazy browser reference at module scope)', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkg_dir, 'package.json'), 'utf8'))
    const targets = Object.values(pkg.exports).map((entry) => entry.import)
    const loaded = await Promise.all(targets.map((t) => import(path.join(pkg_dir, t))))
    const surface = Object.assign({}, ...loaded)
    expect(typeof surface.create_fight_store).toBe('function')
    expect(typeof surface.pace_segment).toBe('function')
    expect(typeof surface.produce_receipt_render_turns).toBe('function')
  })

  test('raw fight-state decoding has exactly one production importer (renderer seam excluded)', () => {
    const importers = src_files
      .filter((file) => path.basename(file) !== 'fight_render_events.js')
      .filter((file) => import_specifiers(fs.readFileSync(file, 'utf8')).includes('@aresrpg/sdk/fight'))
      .map((file) => path.basename(file))
      .sort()
    expect(importers).toEqual(['core_inbox.js'])
  })
})
