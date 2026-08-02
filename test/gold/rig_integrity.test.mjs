// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The gold rig's integrity gate as a plain bun unit (`ares test unit` — the sole testing gate): the localnet
// dependency closure AND the browser dynamic-import audit. RED-FIRST provenance (FIGHT_ENTRY_SEAM 2026-07-18):
// M1a moved src/fight/ into packages/fight and the driven-gate helpers kept importing '/src/fight/index.js' —
// the dev server 404'd it, `snapshot()`'s poll swallowed the rejection (`.catch(() => false)`), and five
// composite driven-gate attempts read as "the fight store never receives the fight" while the app pipeline was
// green the whole time (attempt-5 trace: GET /src/fight/index.js → 404). This gate makes the class un-shippable.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, test } from 'bun:test'

import * as lib_gold from './lib_gold.mjs'
import { repoint_kiosk_dependency } from './kiosk_manifest.mjs'
import { missing_rig_paths, stale_browser_imports } from './rig_integrity.mjs'
import { corpus_counts, pick_corpus_dir, seed_dir_candidates } from './parity.mjs'

const social_manifest_path = fileURLToPath(new URL('../../packages/move/social/Move.toml', import.meta.url))
const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('gold rig integrity (node twin of specs/rig_integrity.spec.ts)', () => {
  test('the localnet dependency closure exists', () => {
    expect(missing_rig_paths()).toEqual([])
  })

  test('every browser dynamic-import literal resolves on THIS tree', () => {
    const stale = stale_browser_imports()
    expect(
      stale.map((row) => `${row.file}:${row.line} → import('${row.url}')`),
      'stale rig imports 404 on the dev server at drive time and the polling helpers swallow it — re-point them ' +
        '(moved workspace code is served under /@id/@aresrpg/<pkg>, the house precedent)'
    ).toEqual([])
  })
})

describe('gold Kiosk manifest repoint (#1577)', () => {
  test('the current pinned-SHA rev line is matched by key, not value', () => {
    const source = fs.readFileSync(social_manifest_path, 'utf8')
    const current_dependency =
      '[dependencies.Kiosk]\n' +
      'git = "https://github.com/MystenLabs/apps.git"\n' +
      'subdir = "kiosk"\n' +
      'rev = "a1cd20107340bf8f6e6913ed20b9fafe92fe3d03"\n'
    expect(source).toContain(current_dependency)

    const result = repoint_kiosk_dependency(source)
    expect(result).toEqual({
      ok: true,
      manifest: source.replace(current_dependency, '[dependencies.Kiosk]\nlocal = "../kiosk"\n'),
    })

    const repinned = source.replace(
      'rev = "a1cd20107340bf8f6e6913ed20b9fafe92fe3d03"',
      'rev = "ffffffffffffffffffffffffffffffffffffffff"'
    )
    expect(repoint_kiosk_dependency(repinned).ok).toBe(true)
  })
})

// #2035 REGRESSION — the SEED-PARITY gate counted `<REPO>/seed/mainnet` unconditionally while the seeder it is
// asserting against (packages/move/scripts/seed_full_corpus.mjs) resolves `ARES_SEED_DIR` → sibling seed
// checkout → merged in-repo copy. Post content-split, a checkout with no in-repo `seed/` seeded a full corpus
// fine and then died at `corpus_counts('mainnet')` with a bare ENOENT: the gate was unreachable from the very
// layout the seeder was taught to support. That is a rig PATH-RESOLUTION failure, which is this file's subject —
// the same class `missing_rig_paths()` above pins for the localnet closure, hence its home here rather than a
// parity.test.mjs no `ares test <selector>` reaches (the test-reachability gate's orphan class).
//
// The seeder's resolver cannot simply be imported by parity.mjs — its module graph resolves a SIGNER at import
// (scripts/client.js runs `load_signer()` at module scope), and parity.mjs is a signer-free counter driven by a
// standalone CLI. So the candidate ladder is mirrored there, and the last row PINS THE TWO LISTS EQUAL: the
// duplication is mechanically policed rather than trusted.
describe('gold seed-parity corpus resolution (#2035)', () => {
  // `process.env` is process-global and bun runs a directory's test files in one process — never leak this
  // block's throwaway key or its synthetic corpus into a sibling suite.
  const ENV_BEFORE = { PRIVATE_KEY: process.env.PRIVATE_KEY, ARES_SEED_DIR: process.env.ARES_SEED_DIR }
  afterAll(() => {
    for (const [key, value] of Object.entries(ENV_BEFORE))
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
  })

  /** A synthetic corpus in the shape `corpus_counts('mainnet')` walks: numbered biome dirs holding the count files. */
  const write_corpus = (biomes) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-parity-corpus-'))
    for (const [name, { items = [], mobs = [], world = false }] of Object.entries(biomes)) {
      fs.mkdirSync(path.join(dir, name), { recursive: true })
      fs.writeFileSync(path.join(dir, name, 'items.json'), JSON.stringify(items))
      fs.writeFileSync(path.join(dir, name, 'mobs.json'), JSON.stringify(mobs))
      if (world) fs.writeFileSync(path.join(dir, name, 'world.json'), JSON.stringify({ id: name }))
    }
    return dir
  }

  test('THE FIX: corpus_counts("mainnet") counts the ARES_SEED_DIR corpus, not a hardcoded in-repo path', () => {
    process.env.ARES_SEED_DIR = write_corpus({
      '01_plains': { items: [{ slug: 'a' }, { slug: 'b' }], mobs: [{ slug: 'm' }], world: true },
      '02_caves': { items: [{ slug: 'c' }], mobs: [], world: true },
      docs: { items: [{ slug: 'not_a_biome' }] }, // unnumbered → never a biome, before or after the fix
    })
    const { counts, detail } = corpus_counts('mainnet') // pre-fix: ENOENT on <REPO>/seed/mainnet
    expect(counts).toEqual({ items: 3, mobs: 1, worlds: 2 })
    expect(detail.biomes).toEqual(['01_plains', '02_caves'])
  })

  test('no corpus anywhere = an ACTIONABLE throw naming ARES_SEED_DIR, never a bare ENOENT and never a silent 0', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-parity-empty-'))
    const missing = path.join(os.tmpdir(), 'ares-parity-absent-corpus')
    const a_file = path.join(empty, '01_not_a_directory.json')
    fs.writeFileSync(a_file, '[]') // a numbered FILE is not a corpus

    expect(() => pick_corpus_dir([empty, missing])).toThrow(/ARES_SEED_DIR/)
    expect(() => pick_corpus_dir([a_file, missing])).toThrow(/ARES_SEED_DIR/) // ENOTDIR is skipped, never a crash
    expect(() => pick_corpus_dir([])).toThrow(/no authored corpus found/)

    process.env.ARES_SEED_DIR = missing
    expect(() => corpus_counts('mainnet')).toThrow(/ARES_SEED_DIR/)
  })

  test('DRIFT GATE: parity resolves the corpus through the SAME candidate ladder as the seeder it asserts', async () => {
    // A REAL import of the seeder — a text read cannot tell a live module from a corpse (#1302). Its graph
    // resolves a signer at import, so a throwaway key keeps this off the developer's CLI keystore; no client
    // construction performs a request, so nothing here touches a chain. @mysten/sui is a workspace dep of
    // packages/move and is not hoisted to the root that test/gold resolves from, hence the explicit resolve.
    const move_pkg = path.resolve(HERE, '..', '..', 'packages', 'move')
    const { Ed25519Keypair } = await import(Bun.resolveSync('@mysten/sui/keypairs/ed25519', move_pkg))
    process.env.PRIVATE_KEY ??= Ed25519Keypair.generate().getSecretKey()
    const { seed_dir_candidates: seeder_candidates } = await import('../../packages/move/scripts/seed_full_corpus.mjs')

    process.env.ARES_SEED_DIR = path.join(os.tmpdir(), 'explicit-parity-corpus')
    expect(seed_dir_candidates()).toEqual(seeder_candidates())
    expect(seed_dir_candidates()[0]).toBe(process.env.ARES_SEED_DIR)
    expect(seed_dir_candidates().length).toBe(3)

    delete process.env.ARES_SEED_DIR
    expect(seed_dir_candidates()).toEqual(seeder_candidates())
    expect(seed_dir_candidates().length).toBe(2) // sibling seed checkout, then the merged in-repo copy
  })
})

describe('gold compose worktree isolation', () => {
  test('derives stable worktree identity, disjoint port blocks, and honors the compose override', () => {
    const root_a = '/tmp/aresrpg-worktrees/alpha'
    const root_b = '/tmp/aresrpg-worktrees/beta'
    const first = lib_gold.derive_gold_isolation(root_a)
    const repeated = lib_gold.derive_gold_isolation(root_a)
    const second = lib_gold.derive_gold_isolation(root_b)

    expect(repeated).toEqual(first)
    expect(first.project_name).toBe('aresrpg-gold-a5a06a5d')
    expect(second.project_name).toBe('aresrpg-gold-73ebc16b')

    const first_ports = new Set(Object.values(first.ports))
    const second_ports = new Set(Object.values(second.ports))
    expect(first_ports.size).toBe(6)
    expect(second_ports.size).toBe(6)
    expect([...first_ports].filter((port) => second_ports.has(port))).toEqual([])
    expect(first.endpoints).toEqual({
      rpc: `http://127.0.0.1:${first.ports.rpc}`,
      faucet: `http://127.0.0.1:${first.ports.faucet}`,
      api: `http://127.0.0.1:${first.ports.api}`,
      sponsor: `http://127.0.0.1:${first.ports.sponsor}`,
    })
    expect(
      lib_gold.derive_gold_isolation(root_a, {
        COMPOSE_PROJECT_NAME: 'manual-gold-project',
        GOLD_PROJECT: 'legacy-gold-project',
      }).project_name
    ).toBe('manual-gold-project')
  })
})
