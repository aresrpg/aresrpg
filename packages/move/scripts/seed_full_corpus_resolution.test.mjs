// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1302 REGRESSION — seed_full_corpus.mjs resolved its corpus root at MODULE SCOPE ("the first ancestor
// holding BOTH seed/mainnet AND packages/move"), true in the monorepo era and impossible since the content
// split. The throw therefore happened at module EVALUATION: `import('./seed_full_corpus.mjs')` died before a
// single exported function ran, killing seed_testnet.mjs's `--corpus mainnet` delegation AND the DEFAULT gold
// boot (up_gold.mjs's `GOLD_CORPUS ?? 'mainnet'`), while stamp_all.test.mjs's TEXT reads of the same file
// stayed green over the dead module.
//
// Unlike every other test beside seed_full_corpus.mjs, this one drives the module through a REAL import —
// that is the whole point of the row: a text read cannot tell a live module from a corpse.
import { test, expect, afterAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const here = import.meta.dir
const out_dir = path.join(here, 'out')
// `process.env` is process-global and bun runs a directory's test files in one process — never leak this
// file's throwaway key or its synthetic corpus into a sibling suite.
const ENV_BEFORE = {
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  ARES_SEED_DIR: process.env.ARES_SEED_DIR,
}
afterAll(() => {
  for (const [key, value] of Object.entries(ENV_BEFORE))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
})
// client.js (imported by the seeder) resolves a SIGNER at import — a throwaway key keeps this test off the
// developer's CLI keystore. Constructing the gRPC client performs no request, so nothing here touches a chain.
process.env.PRIVATE_KEY ??= Ed25519Keypair.generate().getSecretKey()
// The corpus is UNREACHABLE from here (private sibling repo, absent in CI) — the module must import anyway.
process.env.ARES_SEED_DIR = path.join(os.tmpdir(), 'aresrpg-corpus-that-does-not-exist')

// Snapshotted at file load, BEFORE any import of the seeder: the module used to fold/archive its persisted
// manifest at module scope, so merely importing it could RENAME a tracked file on the reader's disk.
const out_snapshot = () =>
  fs.existsSync(out_dir)
    ? fs
        .readdirSync(out_dir)
        .sort()
        .map((f) => {
          const p = path.join(out_dir, f)
          return `${f}:${fs.statSync(p).isDirectory() ? 'dir' : fs.statSync(p).mtimeMs}`
        })
    : []
const OUT_BEFORE = out_snapshot()

const load_seeder = () => import('./seed_full_corpus.mjs')

/** A synthetic corpus: the shape loadCorpus walks (numbered biome dirs + the optional top-level files). */
const write_corpus = (rows) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-corpus-'))
  fs.mkdirSync(path.join(dir, '01_test_biome'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '01_test_biome', 'items.json'),
    JSON.stringify(rows)
  )
  return dir
}

test('THE FIX (#1302): the seeder IMPORTS with no corpus on disk — the module is not a corpse', async () => {
  const seeder = await load_seeder() // pre-fix: throws "could not locate the repo root" right here
  expect(typeof seeder.seed_full_corpus).toBe('function')
  expect(typeof seeder.loadCorpus).toBe('function')
  expect(typeof seeder.resolve_seed_dir).toBe('function')
})

test('importing has NO filesystem side effect — out/ is byte-identical after the import', async () => {
  await load_seeder()
  expect(out_snapshot()).toEqual(OUT_BEFORE)
})

test('resolution is LAZY: the failure lands on the CALL, with an actionable ARES_SEED_DIR message', async () => {
  const { resolve_seed_dir } = await load_seeder()
  expect(() => resolve_seed_dir()).toThrow(/ARES_SEED_DIR/)
})

test('ARES_SEED_DIR is the first candidate; the defaults are the sibling seed checkout, then the merged copy', async () => {
  const { seed_dir_candidates } = await load_seeder()
  const override = path.join(os.tmpdir(), 'explicit-corpus')
  process.env.ARES_SEED_DIR = override
  const overridden = seed_dir_candidates()
  expect(overridden[0]).toBe(override)
  expect(overridden.length).toBe(3)

  delete process.env.ARES_SEED_DIR
  const defaults = seed_dir_candidates()
  process.env.ARES_SEED_DIR = override // restore for the tests below
  expect(defaults.length).toBe(2)
  // sibling checkout (the seed repo's own ARES_MOVE_DIR idiom, pointed the other way), then the merged layout
  expect(defaults[0].endsWith(path.join('aresrpg-seed', 'seed', 'mainnet'))).toBe(
    true
  )
  expect(defaults[1]).toBe(path.resolve(here, '..', '..', '..', 'seed', 'mainnet'))
})

test('a candidate qualifies only when it HOLDS numbered biome directories', async () => {
  const { pick_corpus_dir } = await load_seeder()
  const corpus = write_corpus([])
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-empty-'))
  fs.writeFileSync(path.join(empty, '01_not_a_directory.json'), '[]') // a numbered FILE is not a corpus
  const missing = path.join(os.tmpdir(), 'ares-absent-corpus-dir')

  const a_file = path.join(empty, '01_not_a_directory.json') // a path that exists but is not a directory

  expect(pick_corpus_dir([empty, corpus])).toBe(corpus) // skips the non-corpus dir
  expect(pick_corpus_dir([a_file, corpus])).toBe(corpus) // a file candidate is skipped, never an ENOTDIR crash
  expect(pick_corpus_dir([corpus, write_corpus([])])).toBe(corpus) // first holder wins
  expect(() => pick_corpus_dir([empty, missing])).toThrow(/ARES_SEED_DIR/)
  expect(() => pick_corpus_dir([])).toThrow(/no authored corpus found/)
})

test('loadCorpus() reads the ARES_SEED_DIR corpus at CALL time (the republish-blocking door)', async () => {
  const { loadCorpus } = await load_seeder()
  process.env.ARES_SEED_DIR = write_corpus([
    { slug: 'test_bread', category: 'CONSUMABLE', heal: 10 },
  ])
  const corpus = loadCorpus()
  expect(corpus.biomes).toEqual(['01_test_biome'])
  expect(corpus.items.map((i) => i.slug)).toEqual(['test_bread'])
  expect(corpus.items[0].category).toBe('consumable') // the mint-boundary lowercase still applies
})
