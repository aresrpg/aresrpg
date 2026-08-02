// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEED-PARITY GATE (docs/GOLD_STANDARD_SUITE.md §4 — the skeleton gap B0 owns closing). The SEED-PARITY LAW:
// localnet must seed a corpus whose CONTENT matches production (only the DIALS differ), so every balance finding
// transfers 1:1 to mainnet. Enforcement (verbatim law): "up_gold's seed step drives the full-corpus seeder,
// then asserts PARITY via /v1/encyclopedia counts == the corpus manifest counts — a shortfall FAILS the boot,
// never a silent partial seed."
//
// This module is that assertion. It compares the CORPUS manifest (what SHOULD be live) against /v1/encyclopedia
// (what the indexer actually projected — the display truth a player sees) and FAILS on any shortfall.
//
// CORPUS SOURCES:
//   active  (default) — the content the current-lineage seeder (seed_testnet.mjs → seed_content.json) actually
//                       mints. A healthy boot PASSES (positive proof): every seeded template reaches /v1.
//   mainnet           — the FULL authored corpus, resolved through `ARES_SEED_DIR` exactly like the seeder
//                       (see the candidate ladder below). The law's target. Against today's minimal
//                       seeder this correctly FAILS (the honest partial-seed detection) — the gate that flips
//                       green the moment a full-corpus seeder for the current lineage lands.
//   <file>            — an explicit corpus-manifest JSON (used for the deliberate-break negative proof).
//
// Encyclopedia serves items/mobs/worlds (spells are resolved client-side, not an encyclopedia view — the
// handler documents this), so parity is asserted on those three kinds.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const KINDS = ['items', 'mobs', 'worlds']

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const len = (v) => (Array.isArray(v) ? v.length : 0)

// CORPUS DIRECTORY (#2035) — the authored corpus lives in the PRIVATE seed repo post-split, so this gate must
// resolve it the way the seeder it is asserting against does: `ARES_SEED_DIR` overrides, the sibling checkout is
// the default, and the merged copy (<root>/seed/mainnet) stays a candidate so an assembled tree resolves with no
// env. Hardcoding the merged path made the gate ENOENT on exactly the layout the seeder was taught to support.
// The seeder's own resolver is NOT importable here: its graph resolves a SIGNER at import (scripts/client.js),
// and this module is a signer-free counter with a standalone CLI. parity.test.mjs's DRIFT GATE pins the two
// ladders equal instead — the duplication is policed, never trusted.
// A candidate HOLDS the corpus when it carries numbered biome directories — exactly what corpus_counts walks.
const holds_corpus = (dir) =>
  fs.existsSync(dir) &&
  fs.statSync(dir).isDirectory() &&
  fs.readdirSync(dir).some((d) => /^\d/.test(d) && fs.statSync(path.join(dir, d)).isDirectory())
export const seed_dir_candidates = () =>
  [
    process.env.ARES_SEED_DIR,
    path.resolve(REPO, '..', 'aresrpg-seed', 'seed', 'mainnet'),
    path.join(REPO, 'seed', 'mainnet'),
  ].filter(Boolean)
export const pick_corpus_dir = (candidates) => {
  const found = candidates.find(holds_corpus)
  if (!found)
    throw new Error(
      `parity: no authored corpus found — set ARES_SEED_DIR to the seed repo's seed/mainnet directory. ` +
        `Tried: ${candidates.join(', ') || '(none)'}`
    )
  return found
}
/** The ONE home for this module's corpus path — resolved at the CALL that reads it, never at module scope. */
export const resolve_seed_dir = () => pick_corpus_dir(seed_dir_candidates())

/** Count a corpus <biome> directory's item/mob/world contribution. */
function mainnet_biome_counts(dir) {
  const f = (name) => path.join(dir, name)
  return {
    items: fs.existsSync(f('items.json')) ? len(readJson(f('items.json'))) : 0,
    mobs: fs.existsSync(f('mobs.json')) ? len(readJson(f('mobs.json'))) : 0,
    worlds: fs.existsSync(f('world.json')) ? 1 : 0,
  }
}

/**
 * Resolve the corpus counts for `source`. Returns { source, counts:{items,mobs,worlds}, detail }.
 * @param {'active'|'mainnet'|string} source
 */
export function corpus_counts(source = 'active') {
  if (source === 'active') {
    const c = readJson(path.join(REPO, 'packages', 'move', 'scripts', 'seed_content.json'))
    return {
      source,
      counts: { items: len(c.items), mobs: len(c.mobs), worlds: c.world ? 1 : 0 },
      detail: { recipes: len(c.recipes), spells: len(c.spells) },
    }
  }
  if (source === 'mainnet') {
    const root = resolve_seed_dir()
    const biomes = fs.readdirSync(root).filter((d) => /^\d/.test(d) && fs.statSync(path.join(root, d)).isDirectory())
    const counts = { items: 0, mobs: 0, worlds: 0 }
    for (const b of biomes) {
      const c = mainnet_biome_counts(path.join(root, b))
      counts.items += c.items
      counts.mobs += c.mobs
      counts.worlds += c.worlds
    }
    return { source, counts, detail: { biomes } }
  }
  // explicit manifest file (negative-proof / CI)
  const m = readJson(path.resolve(source))
  return { source, counts: { items: m.items ?? 0, mobs: m.mobs ?? 0, worlds: m.worlds ?? 0 }, detail: m }
}

/** /v1/encyclopedia counts per kind — the indexer's projected display truth. */
export async function v1_counts(api) {
  const out = {}
  for (const kind of KINDS) {
    const r = await (await fetch(`${api}/v1/encyclopedia?kind=${kind}`)).json()
    out[kind] = len(r?.[kind])
  }
  return out
}

/**
 * Assert /v1 has AT LEAST the corpus count for every kind. A shortfall on any kind = parity FAIL. `wait_ms`>0
 * polls the indexer until counts catch up (or timeout) before the final assert — so a healthy boot's indexer
 * lag never false-fails, but a real partial seed still fails.
 * @returns {Promise<{ ok:boolean, source:string, rows:Array<{kind,corpus,v1,ok}>, report:string }>}
 */
export async function assert_parity({ api, source = 'active', wait_ms = 0 }) {
  const { counts: corpus, source: src, detail } = corpus_counts(source)
  let v1 = await v1_counts(api)
  const met = (c) => KINDS.every((k) => c[k] >= corpus[k])
  if (wait_ms > 0) {
    const t0 = Date.now()
    while (!met(v1) && Date.now() - t0 < wait_ms) {
      await new Promise((r) => setTimeout(r, 2000))
      v1 = await v1_counts(api)
    }
  }
  const rows = KINDS.map((k) => ({ kind: k, corpus: corpus[k], v1: v1[k], ok: v1[k] >= corpus[k] }))
  const ok = rows.every((r) => r.ok)
  const report =
    `PARITY [${src}] ${ok ? 'PASS' : 'FAIL'}  ` +
    rows.map((r) => `${r.kind}:${r.v1}/${r.corpus}${r.ok ? '' : ' ✗SHORTFALL'}`).join('  ') +
    (detail ? `  (${JSON.stringify(detail)})` : '')
  return { ok, source: src, rows, corpus, v1, report }
}

/** Write the corpus manifest up_gold consumes (the count baseline the boot gate + CI diff against). */
export function write_corpus_manifest(out_path, source = 'active') {
  const cc = corpus_counts(source)
  fs.writeFileSync(
    out_path,
    JSON.stringify({ ...cc.counts, source: cc.source, detail: cc.detail, at: new Date().toISOString() }, null, 2)
  )
  return cc
}

// ── CLI: `node test/gold/parity.mjs --api http://127.0.0.1:3100 [--source active|mainnet|<file>]` ───────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flag = (k, d) => {
    const i = args.indexOf(`--${k}`)
    return i >= 0 ? args[i + 1] : d
  }
  const api = flag('api', process.env.GOLD_API ?? 'http://127.0.0.1:3100')
  const source = flag('source', 'active')
  assert_parity({ api, source })
    .then((r) => {
      console.log(r.report)
      process.exit(r.ok ? 0 : 1)
    })
    .catch((e) => {
      console.error(`PARITY ERROR: ${e.message}`)
      process.exit(2)
    })
}
