// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RELEASE_PREPARE TEST — proves the release manifest the admin RELEASE page loads is a faithful serialization
// of the real publish ceremony (the "manifest is the ceremony serialized for the browser" claim), so the page
// can never silently advertise a step the ceremony doesn't actually run:
//   1. the manifest's publish order === ceremony_lib.publishOrder() (same topological source both drive from)
//   2. every package carries base64 bytecode + a byte size; the six-package shape holds; aresrpg is the core
//   3. DRIFT GUARD — every policy/enable target the page's step catalog shows appears (at module::fn level) in
//      ceremony.mjs's OWN --dry-run output. If someone renames/removes a policy fn in the ceremony, this fails.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { test, expect } from 'bun:test'

import { publishOrder, TICKET_ORDER } from './ceremony_lib.mjs'
import { POLICY_STEPS, ENABLE_STEPS } from './release_prepare.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const MANIFEST = join(__dir, '../../../packages/frontend/public/release_manifest.json')

// module::fn (drop the package-id prefix — the ceremony's synthetic ids differ from the catalog's symbolic
// `core::`/`rules::` labels, but the module + function are the load-bearing identity of the call).
const mod_fn = (t) => t.split('::').slice(-2).join('::')

test('manifest exists (run `bun run release:prepare` first)', () => {
  expect(existsSync(MANIFEST)).toBe(true)
})

test('manifest publish order === ceremony topological order (all 7 packages, exact sequence)', () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  expect(m._kind).toBe('aresrpg-release-manifest')
  expect(m.publishOrder).toEqual(publishOrder().order)
  expect(m.publishOrder.length).toBe(TICKET_ORDER.length)
  expect(m.publishOrder.length).toBe(7) // the 07-11/12 splits: kolizeum + forgemagie are their own packages
  // every sibling that must publish before the core is present + ordered before aresrpg
  for (const dep of ['foundation', 'spells', 'social', 'engine'])
    expect(m.publishOrder.indexOf(dep)).toBeLessThan(m.publishOrder.indexOf('aresrpg'))
  // kolizeum + forgemagie depend on aresrpg → publish after it
  for (const sib of ['kolizeum', 'forgemagie'])
    expect(m.publishOrder.indexOf(sib)).toBeGreaterThan(m.publishOrder.indexOf('aresrpg'))
})

test('every package carries base64 bytecode + a byte size; aresrpg is the biggest (the core) + under the cap', () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  for (const name of m.publishOrder) {
    const p = m.packages[name]
    expect(p).toBeTruthy()
    expect(Array.isArray(p.modules)).toBe(true)
    expect(p.modules.length).toBe(p.moduleCount)
    expect(typeof p.modules[0]).toBe('string') // base64
    expect(p.byteSize).toBeGreaterThan(0)
  }
  const biggest = m.publishOrder.reduce((a, b) => (m.packages[a].byteSize >= m.packages[b].byteSize ? a : b))
  expect(biggest).toBe('aresrpg')
  // the Sui single-package publish cap — a ceremony blocker if the core ever crosses it (kolizeum/forgemagie
  // were split out precisely to keep aresrpg under this).
  expect(m.packages.aresrpg.byteSize).toBeLessThanOrEqual(102_400)
  expect(m.seedPlan.total).toBeGreaterThan(0)
})

test('manifest carries the move-sources staleness hash (64-hex sha256)', () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  expect(m.moveSourcesHash).toMatch(/^[0-9a-f]{64}$/)
})

test('DRIFT GUARD — every catalog policy/enable target is a real ceremony PTB call (module::fn)', () => {
  // ceremony.mjs --dry-run prints every wiring/enable moveCall target as `→ pkg::module::fn` (zero chain calls,
  // no key needed). Parse them and prove the page's step catalog is a subset — no invented/drifted targets.
  const out = execFileSync('node', [join(__dir, 'ceremony.mjs'), '--dry-run'], { encoding: 'utf8' })
  const ceremony_targets = new Set(
    out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('→'))
      .map((l) => mod_fn(l.replace(/^→\s*/, '')))
  )
  expect(ceremony_targets.size).toBeGreaterThan(0)
  const catalog = [...POLICY_STEPS.flatMap((s) => s.targets), ...ENABLE_STEPS.flatMap((s) => s.targets)]
  const missing = catalog.filter((t) => !ceremony_targets.has(mod_fn(t)))
  expect(missing).toEqual([])
})
