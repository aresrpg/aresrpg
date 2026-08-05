// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RELEASE_PREPARE TEST — proves the release manifest the admin RELEASE page loads is a faithful serialization
// of the real publish ceremony (the "manifest is the ceremony serialized for the browser" claim), so the page
// can never silently advertise a step the ceremony doesn't actually run:
//   1. the manifest's publish order === ceremony_lib.publishOrder(), the same package SET, and every
//      dependency edge respected — all derived from the graph, never a hand-listed count or pair (#2229)
//   2. every package carries base64 bytecode + a byte size; aresrpg is the core
//   3. DRIFT GUARD — every policy/enable target the page's step catalog shows appears (at module::fn level) in
//      ceremony.mjs's OWN --dry-run output. If someone renames/removes a policy fn in the ceremony, this fails.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { test, expect } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'

import { aresrpg_deployment, character_type } from '../../sdk/src/deployment/aresrpg.js'

import { publishOrder, TICKET_ORDER, PKG_DEPS } from './ceremony_lib.mjs'
import {
  PARTY_CHARACTER_TYPE_TARGET,
  PartyCharacterTypePinMismatchError,
  PartyCharacterTypePinMissingError,
  assert_party_character_type_pin,
} from './party_character_type_pin.mjs'
import { POLICY_STEPS, ENABLE_STEPS } from './release_prepare.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const MANIFEST = join(__dir, '../../../packages/frontend/public/release_manifest.json')

// module::fn (drop the package-id prefix — the ceremony's synthetic ids differ from the catalog's symbolic
// `core::`/`rules::` labels, but the module + function are the load-bearing identity of the call).
const mod_fn = (t) => t.split('::').slice(-2).join('::')

function ceremony_targets() {
  const out = execFileSync('node', [join(__dir, 'ceremony.mjs'), '--dry-run'], { encoding: 'utf8' })
  return new Set(
    out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('→'))
      .map((l) => mod_fn(l.replace(/^→\s*/, '')))
  )
}

test('manifest exists (run `bun run release:prepare` first)', () => {
  expect(existsSync(MANIFEST)).toBe(true)
})

test('the ceremony is the only executable marketplace-policy composition', () => {
  expect(existsSync(join(__dir, 'setup_policies.js'))).toBe(false)
})

test('manifest publish order === ceremony topological order (every package, exact sequence)', () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  expect(m._kind).toBe('aresrpg-release-manifest')
  expect(m.publishOrder).toEqual(publishOrder().order)
  // The manifest's package SET is the graph's, entry for entry — in BOTH directions. #2229: the graph gained
  // gifting + dungeon on 07-13 and this serialized artifact stayed at 7 packages for three weeks, so a ceremony
  // walking the manifest would have skipped two packages outright. No literal count lives here: the graph is the
  // one home for how many packages exist, and a count written twice is the drift it took to notice.
  expect([...m.publishOrder].sort()).toEqual([...TICKET_ORDER].sort())
  expect(Object.keys(m.packages).sort()).toEqual([...TICKET_ORDER].sort())
  // Every dependency edge, derived from the graph — a package publishes only after everything it depends on.
  // Hand-listed pairs went stale on every split; this cannot.
  for (const [pkg, deps] of Object.entries(PKG_DEPS))
    for (const dep of deps)
      expect({ [`${dep} before ${pkg}`]: m.publishOrder.indexOf(dep) < m.publishOrder.indexOf(pkg) }).toEqual({
        [`${dep} before ${pkg}`]: true,
      })
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

test('social wiring plan pins Party to the deployment Character type', () => {
  const targets = ceremony_targets()
  const social = ENABLE_STEPS.find((step) => step.pkg === 'social')
  expect(social?.targets.map(mod_fn)).toContain(PARTY_CHARACTER_TYPE_TARGET)
  expect(targets).toContain(PARTY_CHARACTER_TYPE_TARGET)
})

const testnet_deployment = aresrpg_deployment('testnet')
const pin_manifest = {
  aresrpg: { pkg: testnet_deployment.PACKAGE_ID },
  social: {
    pkg: testnet_deployment.SOCIAL_PACKAGE_ID,
    version: testnet_deployment.SOCIAL_VERSION,
  },
}
const pin_key = {
  type: `${pin_manifest.social.pkg}::version::PartyCharacterTypeKey`,
  bcs: new Uint8Array(),
}

function pin_reader(value) {
  return {
    async listDynamicFields() {
      return { dynamicFields: [{ name: pin_key }], hasNextPage: false, cursor: null }
    },
    async getDynamicField() {
      return { dynamicField: { value: { bcs: value } } }
    },
  }
}

test('party-pin gate accepts only the deployment Character TypeName bytes', async () => {
  const expected = character_type({ PACKAGE_ID: pin_manifest.aresrpg.pkg }).replace(/^0x/, '')
  const pinned = await assert_party_character_type_pin(
    pin_reader(bcs.string().serialize(expected).toBytes()),
    pin_manifest
  )
  expect(pinned).toBe(character_type({ PACKAGE_ID: pin_manifest.aresrpg.pkg }))
})

test('party-pin gate throws a named error when the dynamic field is absent', async () => {
  const reader = {
    async listDynamicFields() {
      return { dynamicFields: [], hasNextPage: false, cursor: null }
    },
  }
  await expect(assert_party_character_type_pin(reader, pin_manifest)).rejects.toBeInstanceOf(
    PartyCharacterTypePinMissingError
  )
})

test('party-pin gate throws when the dynamic-field bytes name another type', async () => {
  await expect(
    assert_party_character_type_pin(pin_reader(bcs.string().serialize('u8').toBytes()), pin_manifest)
  ).rejects.toBeInstanceOf(PartyCharacterTypePinMismatchError)
})

// Cold node spawn over the @mysten/sui ESM graph can stall under contention; the dry-run itself is ~0.13s.
test('DRIFT GUARD — every catalog policy/enable target is a real ceremony PTB call (module::fn)', () => {
  // ceremony.mjs --dry-run prints every wiring/enable moveCall target as `→ pkg::module::fn` (zero chain calls,
  // no key needed). Parse them and prove the page's step catalog is a subset — no invented/drifted targets.
  const targets = ceremony_targets()
  expect(targets.size).toBeGreaterThan(0)
  const catalog = [...POLICY_STEPS.flatMap((s) => s.targets), ...ENABLE_STEPS.flatMap((s) => s.targets)]
  const missing = catalog.filter((t) => !targets.has(mod_fn(t)))
  expect(missing).toEqual([])
}, 30_000)
