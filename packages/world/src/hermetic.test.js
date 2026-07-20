// W1 HERMETICITY GATE (node-side twin of the depcruise world-core-hermetic rule, the @aresrpg/fight idiom):
// the package's ENTIRE src import graph resolves inside {itself, @aresrpg/sdk, zustand/vanilla, node:*} —
// zero DOM, zero React, zero three.js, zero frontend reach-back. Runs with the package suite, so a
// hermeticity break fails IN the package before any repo-level gate sees it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

const src_dir = path.dirname(fileURLToPath(import.meta.url))
const pkg_dir = path.resolve(src_dir, '..')

const src_files = fs
  .readdirSync(src_dir)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map((f) => path.join(src_dir, f))

const ALLOWED = /^(\.\/|@aresrpg\/sdk(\/|$)|zustand\/vanilla$|node:)/
const import_specifiers = (text) =>
  [...text.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('@aresrpg/world hermeticity (D769 MODULE LAW)', () => {
  test('every src import specifier is inside the fence — zero exemptions', () => {
    const violations = []
    for (const file of src_files)
      for (const spec of import_specifiers(fs.readFileSync(file, 'utf8')))
        if (!ALLOWED.test(spec)) violations.push(`${path.basename(file)} → ${spec}`)
    expect(violations).toEqual([])
  })

  test('zero browser/render vocabulary in src (DOM, React, three, storage, timer effects)', () => {
    const BANNED =
      /from\s*['"](react|react-dom|three|@aresrpg\/engine3)['"/]|\b(document\.|sessionStorage|localStorage|window\.location|setTimeout|setInterval)\b/
    const hits = []
    for (const file of src_files) {
      const text = fs.readFileSync(file, 'utf8')
      if (BANNED.test(text)) hits.push(path.basename(file))
    }
    expect(hits).toEqual([])
  })

  test('package.json dependencies are exactly the fence (sdk, zustand)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkg_dir, 'package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@aresrpg/sdk', 'zustand'])
    expect(pkg.devDependencies).toBeUndefined()
  })

  test('the whole surface imports clean in node (no lazy browser reference at module scope)', async () => {
    const surface = await import('./index.js')
    expect(typeof surface.create_session_gate_store).toBe('function')
    expect(typeof surface.reduce_session_gate).toBe('function')
    expect(typeof surface.plan_scene).toBe('function')
    expect(typeof surface.handle_character_click).toBe('function')
  })
})
