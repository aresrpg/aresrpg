// DISPOSABLE PROBE — red→green proof for the silent kit-truncation defect.
// Census-proven: the three five-spell bosses (ts_voiddragon / oc_velkarion / hc_seraph) minted with their 5th
// spell CUT — seed_full_corpus.mjs's PHASE 5 kit builder used to close with `.slice(0, 4)`, citing a stale
// mob_template.move bound (Move's real bound is MAX_SPELLS = 5, widened for elite/dungeon_boss tiers — see
// packages/move/aresrpg/sources/mob_template.move). The slice is now deleted; a kit exceeding the Move bound
// fails LOUD at mint (ETooManySpells) instead of shrinking quietly.
//
// Loads the REAL corpus the same way loadCorpus() does (walk seed/mainnet/<biome>/mobs.json), extracts the
// live `const kit = …` expression as SOURCE TEXT from the on-disk seed_full_corpus.mjs, and evaluates it
// against the three real authored boss rows. No chain calls, no client.js import, no network.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.resolve(__dir, '..') // packages/move/scripts
const REPO = path.resolve(SCRIPTS, '..', '..', '..') // repo root
const SEED_DIR = path.join(REPO, 'seed', 'mainnet')
const SCRIPT_PATH = path.join(SCRIPTS, 'seed_full_corpus.mjs')

const TARGETS = ['ts_voiddragon', 'oc_velkarion', 'hc_seraph']
const EXPECT = 5

// ── load every mob row exactly like loadCorpus() does (seed_full_corpus.mjs) ──────────────────────────────
function loadMobs() {
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
  const biomes = readdirSync(SEED_DIR)
    .filter((d) => /^\d/.test(d) && statSync(path.join(SEED_DIR, d)).isDirectory())
    .sort()
  const mobs = []
  for (const b of biomes) {
    const f = path.join(SEED_DIR, b, 'mobs.json')
    if (existsSync(f)) for (const m of readJson(f)) mobs.push(m)
  }
  return mobs
}

// ── extract the live kit-building expression as source text (proves we test what actually ships) ──────────
function extractKitExpr(source) {
  const start = source.indexOf('const kit =')
  const end = source.indexOf('\n      const spells = levelVec(')
  if (start === -1 || end === -1)
    throw new Error('probe: anchor markers not found — file shape moved, update the probe')
  return source.slice(start, end)
}

function buildKitFn(source) {
  const body = `'use strict'\n${extractKitExpr(source)}\nreturn kit`
  // eslint-disable-next-line no-new-func -- disposable local probe, evaluates trusted in-repo source only
  return new Function('m', body)
}

const mobs = loadMobs()
const source = readFileSync(SCRIPT_PATH, 'utf8')
const kitFor = buildKitFn(source)

console.log(`--- corpus loaded: ${mobs.length} mob rows across ${SEED_DIR} ---`)

let fail = false
for (const key of TARGETS) {
  const m = mobs.find((r) => r.key === key)
  if (!m) {
    console.error(`${key}: NOT FOUND in corpus`)
    fail = true
    continue
  }
  const kit = kitFor(m)
  const ok = kit.length === EXPECT
  console.log(
    `${key}: authored spells=${(m.spells || []).length} → kit.length=${kit.length} (want ${EXPECT}) ${ok ? 'PASS' : 'FAIL'}`
  )
  if (!ok) fail = true
}

if (fail) {
  console.error('\nPROBE FAILED')
  process.exit(1)
}
console.log('\nPROBE PASSED')
