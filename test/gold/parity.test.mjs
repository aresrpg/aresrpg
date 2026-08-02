// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2035 REGRESSION — the SEED-PARITY gate counted `<REPO>/seed/mainnet` unconditionally while the seeder it is
// asserting against (packages/move/scripts/seed_full_corpus.mjs) resolves `ARES_SEED_DIR` → sibling seed
// checkout → merged in-repo copy. Post content-split, a checkout with no in-repo `seed/` seeded a full corpus
// fine and then died at `corpus_counts('mainnet')` with a bare ENOENT: the gate was unreachable from the very
// layout the seeder was taught to support.
//
// The seeder's resolver cannot simply be imported here — its module graph resolves a SIGNER at import
// (scripts/client.js runs `load_signer()` at module scope), and parity.mjs is a signer-free counter driven by a
// standalone CLI. So the candidate ladder is mirrored, and the last test PINS THE TWO LISTS EQUAL: the
// duplication is mechanically policed rather than trusted.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, expect, test } from 'bun:test'

import { corpus_counts, pick_corpus_dir, seed_dir_candidates } from './parity.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// `process.env` is process-global and bun runs a directory's test files in one process — never leak this file's
// throwaway key or its synthetic corpus into a sibling suite.
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

test('THE FIX (#2035): corpus_counts("mainnet") counts the ARES_SEED_DIR corpus, not a hardcoded in-repo path', () => {
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
  // resolves a signer at import (scripts/client.js), so a throwaway key keeps this off the developer's CLI
  // keystore; no client construction performs a request, so nothing here touches a chain. @mysten/sui is a
  // workspace dep of packages/move and is not hoisted to the root that test/gold resolves from, hence the
  // explicit resolve through that package.
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
