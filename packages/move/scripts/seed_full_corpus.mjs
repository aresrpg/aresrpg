// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEED_FULL_CORPUS — the FULL authored-corpus seeder for the CURRENT Move lineage (out/ceremony_manifest.json).
// Closes the localnet seed-parity gap (DECISIONS 07-11): "local seeds represent the EXACT mainnet gameplay."
// Walks seed/mainnet/** and mints EVERYTHING through the live admin PTBs: item templates, mob templates (incl.
// loot vectors), recipes, worlds (dials + spawn tables + dungeons), shop, spells, and the core class floor.
// SHAPE-DRIVEN (reads whatever the corpus holds at run time — never count-hardcoded).
//
// LINEAGE: every id retargets the live ceremony manifest; every entry signature was read from the CURRENT
// packages/move sources. PTB builders mirror seed_testnet.mjs (the living example of the admin signatures).
//
// MONEY LAW: reuses ceremony_lib's `run` — dryRun-derived budget ×1.5, NO retry of an EXECUTED failure. Each
// tx dry-runs BEFORE it signs (ZERO gas burned on a bad PTB); the manifest persists after every tx/batch.
// PHASE 2/5/8 BATCH N rows/PTB (N probed per-phase — ceremony_lib.probeBatchSize; ceiling batch_size×0.03 SUI).
//
// LOCALNET / GATE ONLY. REFUSES a remote chain (remote full seeds stay owner-gated — standing law) unless
// SUI_RPC is a localnet OR `SEED_CONFIRM_REMOTE=<network>` is set.
//
// RUN: PRIVATE_KEY=<key> NETWORK=testnet SUI_RPC=http://127.0.0.1:9100 node packages/move/scripts/seed_full_corpus.mjs
// Or via the gold boot: GOLD_CORPUS=mainnet node test/gold/up_gold.mjs  (seed_testnet.mjs delegates here).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import { keypair, sui_client } from './client.js'
import { canonical_map, canonical_rows, mob_level_of } from './corpus_canon.mjs'
import {
  run,
  netGas,
  probeBatchSize,
  resolveBatch,
  claimCreated,
  multiGetObjectsChunked,
  planFixedKeyAdds,
  existingTableKeys,
  getReceipt,
  runPreflightedBatches,
} from './ceremony_lib.mjs'
import {
  sui_to_sale_mist,
  resolve_required_job,
  damage_lines,
  pack_qty_for_job,
} from './seed_economy.mjs'
import { seed_mob_stat_values } from './seed_mob_stats.mjs'
import { encode_effect_value } from './spell_wire.mjs'
import { mobEffect } from './mob_effect.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))

// CORPUS DIRECTORY — resolved at the first CALL that reads the corpus, NEVER at module scope: importing this
// module must not depend on a corpus being on disk (#1302 — a module-scope throw killed seed_testnet's
// `--corpus mainnet` delegation and the DEFAULT gold boot before a single exported function ran).
// Post-split the authored corpus lives in the PRIVATE seed repo, so `ARES_SEED_DIR` is the override and the
// default is the sibling checkout — the same idiom the seed repo already uses in the other direction
// (its ceremony_lib's `ARES_MOVE_DIR` → ../aresrpg/packages/move). The monorepo/merged-gold-copy layout
// (<root>/seed/mainnet) stays a candidate so an assembled copy still resolves without the env.
// A candidate HOLDS the corpus when it carries numbered biome directories — exactly what loadCorpus walks.
const holds_corpus = (dir) =>
  fs.existsSync(dir) &&
  fs.statSync(dir).isDirectory() &&
  fs
    .readdirSync(dir)
    .some((d) => /^\d/.test(d) && fs.statSync(path.join(dir, d)).isDirectory())
export const seed_dir_candidates = () =>
  [
    process.env.ARES_SEED_DIR,
    path.resolve(
      __dir,
      '..',
      '..',
      '..',
      '..',
      'aresrpg-seed',
      'seed',
      'mainnet'
    ),
    path.resolve(__dir, '..', '..', '..', 'seed', 'mainnet'),
  ].filter(Boolean)
export const pick_corpus_dir = (candidates) => {
  const found = candidates.find(holds_corpus)
  if (!found)
    throw new Error(
      `seed_full_corpus: no authored corpus found — set ARES_SEED_DIR to the seed repo's seed/mainnet directory. Tried: ${candidates.join(', ') || '(none)'}`
    )
  return found
}
// The ONE home for the resolved corpus path; the seeder only ever reads it through `seed_dir()`.
export const resolve_seed_dir = () => pick_corpus_dir(seed_dir_candidates())
let seed_dir_memo = null
const seed_dir = () => (seed_dir_memo ??= resolve_seed_dir())
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dir, 'out', 'ceremony_manifest.json'), 'utf8')
)
const OUT_PATH = path.join(__dir, 'out', 'seed_manifest.json')
const CEIL = 1 // refuse any tx whose derived budget exceeds 1 SUI (money law)
const SHIFT = 32768 // item_stats + mob resistances are centered here

// ── Live lineage (retargeted ids; items/game/fight all alias the single aresrpg pkg) ──────────
const FND = MANIFEST.foundation.pkg
const ITEMS = MANIFEST.items.pkg
const SPELLS = MANIFEST.spells.pkg
const GAME = MANIFEST.game.pkg
const FIGHT = MANIFEST.fight.pkg
// CALL ids (re-mint wave, 2026-07-13): after an in-place UPGRADE, `<pkg>.latest` (stamped by
// ceremony_upgrade.mjs) is the only package id whose code passes assert_latest — every moveCall TARGET
// routes there. TYPE TAGS and the LINEAGE_STAMP stay on the ORIGINAL `.pkg` (the defining ids: types
// canonicalize to where they were first published, and the stamp flipping would archive the manifest and
// re-mint the world). No `.latest` yet (never upgraded) → the original id IS the latest.
const CALL = (e) => e.latest ?? e.pkg
const CFND = CALL(MANIFEST.foundation)
const CITEMS = CALL(MANIFEST.items)
const CSPELLS = CALL(MANIFEST.spells)
const CGAME = CALL(MANIFEST.game)
const CFIGHT = CALL(MANIFEST.fight)
// 2026-07-13 gifting split: creation.move / loot_box.move (and their shared Creation/LootRegistry) moved to
// the aresrpg_gifting sibling — their call targets + shared ids resolve THERE now (re-key consumer sweep).
const CGIFT = CALL(MANIFEST.gifting)
// LINEAGE STAMP (mirrors seed_testnet.mjs's proven fix): binds the manifest to the EXACT package set it
// minted against — a DEAD-lineage resume treats recorded labels as "already seeded" against a catalog that
// never got them (07-12: aborted 104 items in, EUnknownCategory). Mismatch → archived, fresh start.
const LINEAGE_STAMP = [FND, ITEMS, SPELLS, GAME, FIGHT].join(',')
const CAP = {
  items: MANIFEST.items.admin,
  spells: MANIFEST.spells.admin,
  game: MANIFEST.game.admin,
  fight: MANIFEST.fight.admin,
}
const VER = {
  items: MANIFEST.items.version,
  spells: MANIFEST.spells.version,
  game: MANIFEST.game.version,
}
const SH = {
  catalog: MANIFEST.items.shared.Catalog,
  creation: MANIFEST.gifting.shared.Creation, // gifting split: shared by aresrpg_gifting's init
  spellReg: MANIFEST.spells.shared.SpellRegistry,
  lootRegistry: MANIFEST.gifting.shared.LootRegistry, // gifting split: loot_box.move lives there
}
const T = {
  loot: `${FIGHT}::mob::MobLootEntry`,
  istats: `${ITEMS}::item_stats::ItemStatistics`,
  idmg: `${ITEMS}::item_damages::ItemDamages`,
  effect: `${FND}::spell_effect::Effect`,
  level: `${FND}::spell_effect::SpellLevel`,
}
const ME = keypair.getPublicKey().toSuiAddress()
const CORE_CLASSES = ['senshi', 'yajin', 'tomoda', 'shugo'] // owner core-class floor (07-11) — always pickable
// [world-mob-size 2026-07-12 · groups DOUBLED 2026-07-13] fresh-lineage spawn density. create_world defaults
// 3-8 groups / 8-16 nodes were dialed live to 12-24 / 16-28, then baked ≈1.5× → 18-36 groups / 24-42 nodes.
// The mob-group density floor doubled 2026-07-13 ("at LEAST double the amount of mob groups"): a literal 2× max (72) breaches world.move's
// DENSITY_MAX=64 hard rail, so the min carries the difference — RULED band 48-64 (avg 27→56 = 2.07×, strictly
// ≥2× within the frozen cap). Nodes UNCHANGED (groups-only ask). world.json may override per-world via W.density.
const DENSITY = { minGroups: 48, maxGroups: 64, minNodes: 24, maxNodes: 42 }

// ── Accumulating manifest (SAME shape lib_gold.readManifests + up_gold consume: world.id/items/mobs/recipes) ──
const OUT = {
  _network: MANIFEST._network,
  _signer: ME,
  _lineage: 'ceremony_manifest.json',
  _stamp: LINEAGE_STAMP,
  _corpus: 'seed/mainnet',
  _seededAt: new Date().toISOString(),
  _note:
    'FULL authored-corpus seed for localnet/gate parity (DECISIONS 07-11). Not an autonomous mainnet seed.',
  categories: [],
  classes: [],
  items: {},
  mobs: {},
  spells: {},
  recipes: [],
  shop: [],
  world: null,
  worlds: [],
  skipped: [],
  digests: {},
  pendingDigests: {}, // executed batch digests awaiting per-row resolution (backfilled on resume — train #3)
  gas: { totalMist: 0, totalSui: 0 },
}
// RESUME (lineage-guarded): fold the persisted partial ONLY if its stamp matches the current lineage;
// else archive it aside (never delete) and start fresh — dead ids never fold in as "already seeded".
// Runs when the SEED runs, never at import: as module-scope code a bare `import()` of this file renamed a
// tracked manifest on the reader's disk (#1302 — imports read nothing, seeds do).
function resume_from_disk() {
  if (!fs.existsSync(OUT_PATH)) return
  let prev = null
  try {
    prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
  } catch {
    /* no prior manifest — fresh run */
  }
  if (prev && prev._stamp === LINEAGE_STAMP) Object.assign(OUT, prev)
  else if (prev) {
    const archiveDir = path.join(__dir, 'out', 'archive')
    fs.mkdirSync(archiveDir, { recursive: true })
    const stampHead = String(prev._stamp || 'unknown')
      .replace(/^0x/, '')
      .slice(0, 10)
    const archived = path.join(
      archiveDir,
      `seed_manifest_${stampHead}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    )
    fs.renameSync(OUT_PATH, archived)
    console.log(
      `  [resume] manifest stamp ≠ current lineage → archived ${path.relative(__dir, archived)}; starting FRESH`
    )
  }
}
const persist = () => fs.writeFileSync(OUT_PATH, JSON.stringify(OUT, null, 2))

// ── tx helpers (mirror seed_testnet: skip-if-seeded, dryRun-gated, gas accounting) ──
let gasMist = 0
function account(label, r) {
  gasMist += netGas(r.effects.gasUsed)
  OUT.digests[label] = r.digest
  OUT.gas.totalMist = gasMist
  OUT.gas.totalSui = gasMist / 1e9
}
async function exec(label, build) {
  if (OUT.digests?.[label]) {
    console.log(
      `  [${label}] SKIP (already: ${OUT.digests[label].slice(0, 8)}…)`
    )
    return { r: null, skipped: true }
  }
  const tx = new Transaction()
  build(tx)
  const r = await run(sui_client, keypair, label, tx, { ceilingSui: CEIL })
  account(label, r)
  return { r }
}
const createdId = (r, suffix) =>
  (r.objectChanges || []).find(
    (c) => c.type === 'created' && (c.objectType || '').endsWith(suffix)
  )?.objectId

// ONE probe knob; the clearing SIZE differs per phase (command density per row shape — probeBatchSize doc).
// `execBatch`: ceiling scaled to the batch, NO skip-if-digest (resume safety is ROW-level / a chain read —
// immune to batch-size drift). `richest` probes the densest rows so the size holds for every real batch. ──
const BATCH_PROBE = { start: 50, cap: 100, step: 10, ceilingSuiPerItem: 0.03 }
const richest = (rows, n) =>
  [...rows]
    .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
    .slice(0, Math.min(n, rows.length))
async function execBatch(label, n, build, track = true) {
  const tx = new Transaction()
  build(tx)
  const r = await run(sui_client, keypair, label, tx, {
    ceilingSui: n * BATCH_PROBE.ceilingSuiPerItem,
  })
  account(label, r)
  // Crash-safe (train #3): the digest hits pendingDigests + DISK the instant the tx executes; resolution
  // deletes it; a crash between = backfilled next run. track=false for row-less phases (categories/classes).
  if (track) OUT.pendingDigests[label] = r.digest
  persist()
  return r
}

// PTB INPUT CAP (burial reseed, 2026-07-13): the protocol rejects >2048 tx inputs, and the SDK does NOT
// dedupe pure inputs — a 60-row gear batch carries ~37 pures/row ≈ 2235 inputs (the exact attempt-1 refusal;
// zero gas, dryRun-stage). Gas-probed sizes are input-blind (`richest` sorts by JSON bytes, not input count),
// so every REAL batch is trimmed to the largest prefix whose LOCALLY-built tx stays under the cap — an exact
// count via Transaction.getData(), free, no chain call. 1900 leaves headroom for gas/object inputs.
const INPUT_CAP = 1900
const countInputs = (rows, buildInto) => {
  const tx = new Transaction()
  const skippedLen = OUT.skipped.length
  buildInto(tx, rows)
  OUT.skipped.length = skippedLen // count-builds are throwaway: revert builder side effects (mob-loot skips)
  return tx.getData().inputs.length
}
const fitByInputs = (rows, buildInto) => {
  let n = rows.length
  while (n > 1 && countInputs(rows.slice(0, n), buildInto) > INPUT_CAP)
    n = Math.max(1, Math.floor(n * 0.8))
  return n
}
// REFUSE-THEN-MINT PHASE GUARD: the initial richest-row probe chooses a target size; this second pass simulates
// every exact, input-fitted batch before runPreflightedBatches permits the first signature. Census: all three
// probed phases in this file (2 items, 5 mobs, 8 spells) use this same guard.
const preflightExactBatch = (rows, buildInto, opts = BATCH_PROBE) =>
  probeBatchSize(
    sui_client,
    ME,
    rows,
    (batch) => {
      const tx = new Transaction()
      const skippedLen = OUT.skipped.length
      try {
        buildInto(tx, batch)
        return tx
      } finally {
        // Probe builds are disposable. Mob builders record unresolved loot while composing; only the real mint
        // may persist that accounting, never a read-only simulation.
        OUT.skipped.length = skippedLen
      }
    },
    { ...opts, start: rows.length, cap: rows.length, step: 1 }
  )

// BACKFILL (train #3): a batch EXECUTED but resolution crashed (publicnode 50-id read cap) → live templates,
// zero manifest rows → naive resume double-mints. Re-fetch the tx, resolve created→rows, land, clear.
async function backfillPending(prefix, createdOf, claim) {
  for (const [label, digest] of Object.entries(OUT.pendingDigests)) {
    if (!label.startsWith(prefix)) continue
    console.log(
      `  [${label}] BACKFILL executed-but-unresolved digest ${digest.slice(0, 8)}…`
    )
    const txb = await getReceipt(sui_client, digest)
    claim(await createdOf(txb))
    delete OUT.pendingDigests[label]
    persist()
  }
}

// ── PTB builders (copied from seed_testnet — the living example of the current admin signatures) ──
const optSome = (tx, tag, v) =>
  tx.moveCall({
    target: '0x1::option::some',
    typeArguments: [tag],
    arguments: [v],
  })
const optNone = (tx, tag) =>
  tx.moveCall({
    target: '0x1::option::none',
    typeArguments: [tag],
    arguments: [],
  })
// consumableJson.type → the frozen §17.15 vocabulary's public accessor fn name (consumable_effect.move).
// Only the types with a real on-chain kind are listed; anything else (ADD_STATS/STAMINA_REGEN/SOUL_REGEN —
// docs/RESEED_RULINGS_SEAT_2026-07-19.md §③ C-5/C-6, no vocabulary kind) is intentionally absent.
const CJSON_KIND = {
  LIFE_REGEN: 'heal', // C-2
  RANDOM_ITEMS: 'bag_open', // C-4 — kind 3 is TRAIN CARGO; mints inert-but-honest ahead of the consume door
  RESET_STATS: 'stat_reset', // C-7
  RESET_SPELLS: 'spell_reset', // C-7
}
// One authored item row → { fn, amount } for the ConsumableEffect PTB call, or null (effect-less). gacha BOX >
// plain numeric heal (seed_testnet-proven) > richer consumableJson authoring; null when none of the three are
// authored, OR when consumableJson names a type with no frozen-vocabulary kind (see CJSON_KIND above).
const resolveConsumableEffect = (it) => {
  if (it.gacha) return { fn: 'gacha_roll', amount: 0 }
  if (it.heal != null) return { fn: 'heal', amount: it.heal }
  if (it.consumableJson) {
    const cj = JSON.parse(it.consumableJson)
    const fn = CJSON_KIND[cj.type]
    if (fn) return { fn, amount: cj.amount ?? 0 }
  }
  return null
}
// 17-field ItemStatistics centered at SHIFT; `ov` overrides are RAW deltas added onto SHIFT.
const FIELDS = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'critical_chance',
  'critical_outcomes',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
]
const statsBlock = (tx, ov = {}) =>
  tx.moveCall({
    target: `${CITEMS}::item_stats::new`,
    arguments: FIELDS.map((f) => tx.pure.u16(SHIFT + (ov[f] || 0))),
  })
// xp is authored by the ONE home (seed/generators/mob_xp_derive.mjs → derive_mob_xp). The old
// `m.xp ?? Math.max(20, maxLevel*10)` fallback minted an IMMUTABLE linear-20 placeholder for any
// un-authored mob (bug ⑨ / BALANCE_REVIEW P0-1). A missing/invalid xp is now a HARD ERROR — the
// ceremony refuses rather than silently mint a wrong, forever value. Run the sweep before seeding.
const mob_xp_required = (m) => {
  const xp = Number(m.xp)
  if (!Number.isFinite(xp) || xp <= 0)
    throw new Error(
      `mob '${m.key ?? m.name}' has xp=${String(m.xp)} — every mob must author xp>0 via seed/generators/mob_xp_derive.mjs before seeding (E/P0-1: no linear-20 fallback)`
    )
  return xp
}
const dmgLine = (tx, from, to, type, element) =>
  tx.moveCall({
    target: `${CITEMS}::item_damages::new`,
    arguments: [
      tx.pure.u16(from),
      tx.pure.u16(to),
      tx.pure.string(type),
      tx.pure.string(element),
    ],
  })
function elements(tx) {
  const cache = new Map()
  return (name) => {
    if (!cache.has(name))
      cache.set(name, tx.moveCall({ target: `${CFND}::spell::${name}` }))
    return cache.get(name)
  }
}
const fxVec = (tx, effects) =>
  tx.makeMoveVec({ type: T.effect, elements: effects })
// Universal effect envelope (PHASE 8): all 22 corpus effect kinds are defined discriminants ≤ 29, so
// `new_effect` builds them all and `is_legal` admits each (engine kinds the resolver doesn't yet READ mint
// fine as data — balance C-6 FOLLOWUPS). element null→255; `value`/`flags` ride spell_wire.mjs's
// `encode_effect_value` (#1250 — CENTERED for alter_stat/alter_resist, magnitude passthrough otherwise);
// `phase` per kind (glyph/dot tick at turn START, else on-enter=0) — signature in foundation spell_effect.
const KIND_PHASE = { 20: 1, 21: 1 } // K_PLACE_GLYPH / K_APPLY_DOT → PHASE_START; all else PHASE_ON_ENTER
const effectFx = (tx, e) => {
  const { value, flags } = encode_effect_value(e.kind, e.value ?? 0, e.flags ?? 0)
  return tx.moveCall({
    target: `${CFND}::spell_effect::new_effect`,
    arguments: [
      tx.pure.u8(e.kind),
      tx.pure.u8(e.element ?? 255),
      tx.pure.u64(value),
      tx.pure.u8(e.area_shape ?? 0),
      tx.pure.u64(e.area_size ?? 0),
      tx.pure.u8(e.target_filter ?? 0),
      tx.pure.u8(e.chance ?? 100),
      tx.pure.u8(e.turns ?? 0),
      tx.pure.u8(e.stat ?? 0),
      tx.pure.u8(flags),
      tx.pure.u8(KIND_PHASE[e.kind] ?? 0),
    ],
  })
}
// new_spell_level(min_cl,ap,rmin,rmax,mod,line,los,free,cpt,cpta,cd,crit_rate,ends,req[],forb[],fx[],crit_fx[])
const spellLevel = (tx, o, fx, crit) =>
  tx.moveCall({
    target: `${CFND}::spell_effect::new_spell_level`,
    arguments: [
      tx.pure.u16(o.min_cl),
      tx.pure.u64(o.ap),
      tx.pure.u64(o.rmin),
      tx.pure.u64(o.rmax),
      tx.pure.bool(!!o.mod),
      tx.pure.bool(!!o.line),
      tx.pure.bool(o.los !== false),
      tx.pure.bool(!!o.free),
      tx.pure.u8(o.cpt ?? 255),
      tx.pure.u8(o.cpta ?? 255),
      tx.pure.u8(o.cd ?? 0),
      tx.pure.u64(o.crit ?? 0),
      tx.pure.bool(false),
      tx.pure.vector('u16', []),
      tx.pure.vector('u16', []),
      fxVec(tx, fx),
      fxVec(tx, crit),
    ],
  })
const levelVec = (tx, levels) =>
  tx.makeMoveVec({ type: T.level, elements: levels })
// foundation spell::new_stats fields in canonical order; resistances are centered.
const mobStats = (tx, s) =>
  tx.moveCall({
    target: `${CFND}::spell::new_stats`,
    arguments: seed_mob_stat_values(s, SHIFT).map((value) =>
      tx.pure.u64(value)
    ),
  })
const lootEntry = (tx, itemId, chance, min, max) =>
  tx.moveCall({
    target: `${CFIGHT}::mob::new_loot_entry`,
    arguments: [
      tx.pure.id(itemId),
      tx.pure.u16(chance),
      tx.pure.u16(min),
      tx.pure.u16(max),
    ],
  })
const lootVec = (tx, entries) =>
  tx.makeMoveVec({ type: T.loot, elements: entries })

// ── corpus shape → builder-input adapters ─────────────────────────────────────────────────────
const elMove = (name) =>
  name === 'neutral' || name === 'none' || !name ? 'el_none' : `el_${name}`
const bp = (rate) =>
  Math.min(10000, Math.max(0, Math.round((rate ?? 0) * 10000))) // float prob 0..1 → basis points
const world_seed = (id) => {
  let h = 5381
  for (const c of String(id)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return h || 1
}

export function loadCorpus() {
  const corpus_dir = seed_dir()
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
  const biomes = fs
    .readdirSync(corpus_dir)
    .filter(
      (d) => /^\d/.test(d) && fs.statSync(path.join(corpus_dir, d)).isDirectory()
    )
    .sort()
  const items = [],
    resources = [],
    mobs = [],
    recipes = [],
    worlds = [],
    shop = []
  // top-level shop.json is an OBJECT { _meta, cosmetics, pets } — flatten both row sets. Optional.
  const topShop = path.join(corpus_dir, 'shop.json')
  if (fs.existsSync(topShop)) {
    const cat = readJson(topShop)
    for (const s of [...(cat.cosmetics || []), ...(cat.pets || [])])
      shop.push(s)
  }
  for (const b of biomes) {
    const f = (n) => path.join(corpus_dir, b, n)
    const g = (n) => (fs.existsSync(f(n)) ? readJson(f(n)) : [])
    for (const it of g('items.json')) items.push(it)
    for (const r of g('resources.json')) resources.push(r)
    for (const m of g('mobs.json')) mobs.push(m)
    for (const rc of g('recipes.json')) recipes.push(rc)
    for (const s of g('shop.json')) shop.push(s) // per-biome priced catalog; optional (skip-if-absent)
    if (fs.existsSync(f('world.json'))) worlds.push(readJson(f('world.json')))
  }
  // pet loot-boxes (seed/mainnet/pet_boxes.json, optional) — box-exclusive pool pets mint like items (an
  // already-present slug is REUSED via PHASE 2's slug dedupe); gacha boxes fold into `shop` (KIND_GACHA_ROLL
  // rides `gacha:true`). `petBoxes` keeps the pools for the post-mint loot-table phase (PHASE 7b).
  const petBoxes = []
  const petBoxFile = path.join(corpus_dir, 'pet_boxes.json')
  if (fs.existsSync(petBoxFile)) {
    const pb = readJson(petBoxFile)
    for (const p of pb.pets || []) items.push(p)
    for (const b of pb.boxes || []) {
      shop.push(b)
      petBoxes.push(b)
    }
  }
  // CEREMONY-BLOCKER FIX (07-11) — canonical category case = LOWERCASE: the IMMUTABLE contract + sdk compare
  // lowercase bytes with zero case-folding (uppercase on-chain ⇒ gathering dead / stackables never mint /
  // gear never equips) ⇒ lowercase at THIS mint boundary. Offline validators .toUpperCase() — green either way.
  for (const row of [...items, ...resources, ...shop])
    if (typeof row?.category === 'string')
      row.category = row.category.toLowerCase()
  return { biomes, items, resources, mobs, recipes, worlds, shop, petBoxes }
}

// ════════════════════════════════════ PHASES ════════════════════════════════════
export async function seed_full_corpus() {
  // FIRST — before any throwing guard: the CLI catch below persists OUT, so a run that dies early must
  // already hold the persisted partial (an unfolded OUT would clobber it with an empty skeleton).
  resume_from_disk()
  guard_network()
  const C = loadCorpus()
  console.log(
    `\n=== SEED FULL CORPUS · network=${MANIFEST._network} · grpc=${process.env.SUI_GRPC_URL || '(default)'} · signer=${ME} ===`
  )
  console.log(
    `corpus: ${C.biomes.length} worlds · ${C.items.length} items · ${C.resources.length} resources · ${C.mobs.length} mobs · ${C.recipes.length} recipes · ${C.shop.length} shop`
  )

  // Preflight: the AdminCap(s) must be owned by the signer (else every authoring tx aborts unverified).
  for (const id of [...new Set(Object.values(CAP))]) {
    const { object } = await sui_client.getObject({ objectId: id })
    if (object?.owner?.AddressOwner !== ME)
      throw new Error(
        `PREFLIGHT: AdminCap ${id} not owned by signer (${JSON.stringify(object?.owner)})`
      )
  }
  console.log('preflight OK — AdminCap owned by signer\n')

  // ── PHASE 1 · categories (every distinct item + resource + shop category) — IDEMPOTENT (07-12 live-train
  //    fix): `catalog.add` = Table.add, ABORTS EFieldAlreadyExists on a duplicate, and crush_go_live had
  //    already seeded `rune` into this lineage's Catalog. Pre-flight read the live Table, add ONLY the
  //    missing — the CHAIN read (not a manifest digest) is the idempotence (planFixedKeyAdds doc). ──
  const cats = [
    ...new Set([
      ...C.items.map((i) => i.category),
      ...C.resources.map((r) => r.category),
      ...C.shop.map((s) => s.category),
    ]),
  ]
  const catPlan = planFixedKeyAdds(
    cats,
    await existingTableKeys(sui_client, SH.catalog, 'categories')
  )
  console.log(
    `  categories: ${catPlan.existingCount} existing skipped, ${catPlan.missing.length} adding`
  )
  if (!catPlan.skip)
    await execBatch(
      'categories',
      catPlan.missing.length,
      (tx) => {
        for (const c of catPlan.missing)
          tx.moveCall({
            target: `${CITEMS}::admin::add_category`,
            arguments: [
              tx.object(CAP.items),
              tx.object(SH.catalog),
              tx.pure.string(c),
              tx.object(VER.items),
            ],
          })
      },
      false
    )
  OUT.categories = cats
  persist()

  // ── PHASE 2 · item templates (gear + resources + shop cosmetics/pets) — BATCHED PTBs (the ~1,850-row
  //    one-per-tx target). ID CAPTURE (no order assumption): `TemplateCreated` only carries `item_type` (not
  //    unique) → read back CONTENT (key name+description+item_type+category+level = the create_template args)
  //    via chunked multiGetObjects, HARD-matched (resolveBatch halts on mismatch). Shop rows mint here too. ──
  const buildItemCreate = (tx, it) => {
    const has = it.stats && it.stats.min && it.stats.max
    const smin = has
      ? optSome(tx, T.istats, statsBlock(tx, it.stats.min))
      : optNone(tx, T.istats)
    const smax = has
      ? optSome(tx, T.istats, statsBlock(tx, it.stats.max))
      : optNone(tx, T.istats)
    // dmg: single line OBJECT or ARRAY (gear law 1/2/3/4 lines by level) — one normalizer decides.
    const dmg = tx.makeMoveVec({
      type: T.idmg,
      elements: damage_lines(it.dmg).map((d) =>
        dmgLine(tx, d.from, d.to, d.type, d.element)
      ),
    })
    // Consumable effect → the frozen §17.15 vocabulary (consumable_effect.move KIND_HEAL/STAT_RESET/SPELL_RESET/
    // BAG_OPEN/GACHA_ROLL). Precedence mirrors seed_testnet.mjs's proven item() builder: gacha BOX (amount 0 —
    // the pool is the loot table) > plain numeric heal > richer consumableJson authoring. consumableJson.type
    // maps per docs/RESEED_RULINGS_SEAT_2026-07-19.md §③: C-2 LIFE_REGEN, C-4 RANDOM_ITEMS, C-7 RESET_STATS/
    // RESET_SPELLS. ADD_STATS/STAMINA_REGEN/SOUL_REGEN carry NO vocabulary kind (C-5/C-6 — "the effect data
    // dies", reclassified→resource in a separate data lane) and correctly resolve to null here — not a bug.
    const ceff = resolveConsumableEffect(it)
    const eff = ceff
      ? optSome(
          tx,
          `${ITEMS}::consumable_effect::ConsumableEffect`,
          tx.moveCall({
            target: `${CITEMS}::consumable_effect::new`,
            arguments: [
              tx.moveCall({
                target: `${CITEMS}::consumable_effect::${ceff.fn}`,
              }),
              tx.pure.u64(ceff.amount),
            ],
          })
        )
      : optNone(tx, `${ITEMS}::consumable_effect::ConsumableEffect`)
    tx.moveCall({
      target: `${CITEMS}::admin::create_template`,
      arguments: [
        tx.object(CAP.items),
        tx.object(SH.catalog),
        tx.pure.string(it.name),
        tx.pure.string(it.description ?? ''),
        tx.pure.string(it.itemType),
        tx.pure.string(it.category),
        tx.pure.u16(it.level ?? 1),
        smin,
        smax,
        dmg,
        eff,
        tx.object(VER.items),
      ],
    })
  }
  const itemRowKey = (it) =>
    JSON.stringify([
      it.name,
      it.description ?? '',
      it.itemType,
      it.category,
      String(it.level ?? 1),
    ])
  const itemContentKey = (f) =>
    JSON.stringify([
      f.name,
      f.description,
      f.item_type,
      f.category,
      String(f.level),
    ])
  const itemCreatedOf = async (r) => {
    const ids = (r.objectChanges || [])
      .filter(
        (c) =>
          c.type === 'created' &&
          (c.objectType || '').endsWith('::item::ItemTemplate')
      )
      .map((c) => c.objectId)
    const objs = ids.length
      ? await multiGetObjectsChunked(sui_client, ids, { showContent: true })
      : []
    return objs.map((o) => ({
      id: o.data.objectId,
      key: itemContentKey(o.data.content.fields),
    }))
  }

  // Dedupe by slug, first wins (a biome pet reused by pet_boxes would otherwise double-mint).
  const seenSlugs = new Set()
  const itemRows = [...C.items, ...C.resources, ...C.shop].filter(
    (it) => !seenSlugs.has(it.slug) && seenSlugs.add(it.slug)
  )
  await backfillPending('items:', itemCreatedOf, (created) => {
    for (const { row, id } of claimCreated(
      itemRows.filter((it) => !OUT.items[it.slug]),
      itemRowKey,
      created
    ))
      OUT.items[row.slug] = id
  })
  const pendingItems = itemRows.filter((it) => !OUT.items[it.slug])
  if (pendingItems.length) {
    const buildItemsInto = (tx, rows) => {
      for (const it of rows) buildItemCreate(tx, it)
    }
    const { size } = await probeBatchSize(
      sui_client,
      ME,
      richest(pendingItems, BATCH_PROBE.cap),
      (rows) => {
        const tx = new Transaction()
        buildItemsInto(tx, rows)
        return tx
      },
      BATCH_PROBE
    )
    console.log(
      `  items: batch size ${size} (${pendingItems.length} pending → ${Math.ceil(pendingItems.length / size)} txs)`
    )
    await runPreflightedBatches(
      pendingItems,
      size,
      (candidate) => fitByInputs(candidate, buildItemsInto),
      (batch) => preflightExactBatch(batch, buildItemsInto),
      async (batch, offset) => {
        const label = `items:${offset}`
        const r = await execBatch(label, batch.length, (tx) =>
          buildItemsInto(tx, batch)
        )
        for (const { row, id } of resolveBatch(
          batch,
          itemRowKey,
          await itemCreatedOf(r)
        ))
          OUT.items[row.slug] = id
        delete OUT.pendingDigests[label]
        persist()
      }
    )
  }

  // ── PHASE 3 · creation gate — whitelist the CORE class floor (bot slice creates a senshi). IDEMPOTENT
  //    like PHASE 1: `Creation.classes` is the identical Table.add abort class. ──
  const classPlan = planFixedKeyAdds(
    CORE_CLASSES,
    await existingTableKeys(sui_client, SH.creation, 'classes')
  )
  console.log(
    `  classes: ${classPlan.existingCount} existing skipped, ${classPlan.missing.length} adding`
  )
  if (!classPlan.skip)
    await execBatch(
      'add_classes',
      classPlan.missing.length,
      (tx) => {
        for (const c of classPlan.missing)
          tx.moveCall({
            target: `${CGIFT}::creation::add_class`,
            arguments: [
              tx.object(CAP.items),
              tx.object(SH.creation),
              tx.pure.string(c),
              tx.object(VER.items),
            ],
          })
      },
      false
    )
  OUT.classes = CORE_CLASSES
  persist()

  // ── PHASE 4 · crafting recipes — RUNS AFTER PHASE 6 since the burial reseed (2026-07-13): worlds' spawn
  //    tables are the ghost-kill (stale zone tables spawn old-generation mobs until re-stamped), so the
  //    ~125 recipe txs must never sit between mobs and worlds. Recipes read ONLY OUT.items (minted in
  //    PHASE 2); nothing before PHASE 7 reads OUT.recipes — a pure block move, zero logic change. ──
  const CHUNK = 12
  const seed_recipes = async () => {
    // create_recipe (crafting.move:120) needs `required_job: u8` + `craft_xp: u64` — sourced per row (numeric
    // or job slug; craft_xp/craftXp). PHANTOM job / missing xp = CONTENT gap → skip + count, NEVER invent.
    const valid = []
    for (const rc of C.recipes) {
      const bad = rc.inputs.filter((i) => !OUT.items[i.slug]).map((i) => i.slug)
      if (bad.length || !OUT.items[rc.output]) {
        OUT.skipped.push({
          kind: 'recipe',
          slug: rc.label,
          why: `unminted refs: ${[...bad, OUT.items[rc.output] ? '' : rc.output].filter(Boolean).join(',')}`,
        })
        continue
      }
      const required_job = resolve_required_job(rc.required_job ?? rc.job)
      const craft_xp = rc.craft_xp ?? rc.craftXp
      if (required_job == null || craft_xp == null) {
        const miss = [
          required_job == null
            ? `required_job(job=${JSON.stringify(rc.job ?? rc.required_job)})`
            : null,
          craft_xp == null ? 'craft_xp' : null,
        ]
          .filter(Boolean)
          .join('+')
        OUT.skipped.push({
          kind: 'recipe',
          slug: rc.label,
          why: `content gap: missing ${miss}`,
        })
        continue
      }
      valid.push({ ...rc, required_job, craft_xp })
    }
    for (let i = 0; i < valid.length; i += CHUNK) {
      const batch = valid.slice(i, i + CHUNK)
      const { r } = await exec(`recipes:${i}`, (tx) => {
        for (const rc of batch)
          tx.moveCall({
            target: `${CGAME}::crafting::create_recipe`,
            arguments: [
              tx.object(CAP.game),
              tx.object(VER.game),
              tx.pure.vector(
                'id',
                rc.inputs.map((x) => OUT.items[x.slug])
              ),
              tx.pure.vector(
                'u64',
                rc.inputs.map((x) => x.qty)
              ),
              tx.pure.id(OUT.items[rc.output]),
              tx.pure.u64(rc.outQty ?? 1),
              tx.pure.u8(rc.required_job),
              tx.pure.u64(rc.craft_xp),
            ],
          })
      })
      if (r)
        for (const rc of batch)
          OUT.recipes.push({
            label: rc.label,
            output: OUT.items[rc.output],
            outQty: rc.outQty ?? 1,
            required_job: rc.required_job,
            craft_xp: rc.craft_xp,
          })
      persist()
    }
  } // seed_recipes — invoked after PHASE 6 (see the PHASE 4 header)

  // ── PHASE 5 · mob templates (fight bounds: ≤4 spells, ≤16 loot; loot = faithful MobLootEntry vectors).
  //    Corpus mob spell kits are param-less stubs → each mob gets ONE canonical element-damage SpellLevel
  //    (enough for a real, settleable fight). BATCHED like PHASE 2; `MobTemplateCreated` only carries `name`
  //    (not unique across ~250 mobs) → CONTENT read-back (name+levels+hp+ap+mp+xp key), chunked. ──
  const buildMobsInto = (tx, rows) => {
    const el = elements(tx) // ONE cache per batch tx — mobs sharing an element (common) emit el_xxx ONCE
    for (const m of rows) {
      const loot = (m.loot || []).slice(0, 16).filter((l) => {
        if (!OUT.items[l.item]) {
          OUT.skipped.push({
            kind: 'mob-loot',
            slug: `${m.key}:${l.item}`,
            why: 'unminted loot item',
          })
          return false
        }
        return true
      })
      const elH = el(elMove(m.element))
      const kit = (
        m.spells && m.spells.length
          ? m.spells
          : [
              {
                ap: 4,
                rmin: 1,
                rmax: 4,
                los: true,
                crit: 50,
                effects: [
                  { kind: 0, element: m.element, base: 6 + (m.minLevel ?? 1) },
                ],
                crit_effects: [
                  { kind: 0, element: m.element, base: 11 + (m.minLevel ?? 1) },
                ],
              },
            ]
      ).slice(0, 4) // MAX_SPELLS = 4 (mob_template.move §17.21)
      const spells = levelVec(
        tx,
        kit.map((sp) =>
          spellLevel(
            tx,
            {
              min_cl: 1,
              ap: sp.ap ?? 4,
              rmin: sp.rmin ?? 1,
              rmax: sp.rmax ?? 4,
              mod: sp.mod,
              line: sp.line,
              los: sp.los,
              free: sp.free,
              cpt: sp.cpt,
              cpta: sp.cpta,
              cd: sp.cd,
              crit: sp.crit,
            },
            (sp.effects ?? []).map((e) => mobEffect(tx, CFND, e)),
            (sp.crit_effects ?? []).map((e) => mobEffect(tx, CFND, e))
          )
        )
      )
      tx.moveCall({
        target: `${CGAME}::mob_template::mint`,
        arguments: [
          tx.object(CAP.game),
          tx.object(VER.game),
          tx.pure.string(m.name),
          tx.pure.u16(m.minLevel ?? 1),
          tx.pure.u16(m.maxLevel ?? m.minLevel ?? 1),
          tx.pure.u64(m.hp ?? 30),
          tx.pure.u64(m.ap ?? 6),
          tx.pure.u64(m.mp ?? 3),
          elH,
          mobStats(tx, m.stats || {}),
          spells,
          lootVec(
            tx,
            loot.map((l) =>
              lootEntry(
                tx,
                OUT.items[l.item],
                bp(l.chance),
                l.min ?? 1,
                l.max ?? 1
              )
            )
          ),
          tx.pure.u64(mob_xp_required(m)),
        ],
      })
    }
  }
  const mobRowKey = (m) =>
    JSON.stringify([
      m.name,
      String(m.minLevel ?? 1),
      String(m.maxLevel ?? m.minLevel ?? 1),
      String(m.hp ?? 30),
      String(m.ap ?? 6),
      String(m.mp ?? 3),
      String(mob_xp_required(m)),
    ])
  const mobContentKey = (f) =>
    JSON.stringify([
      f.name,
      String(f.min_level),
      String(f.max_level),
      String(f.base_hp),
      String(f.ap),
      String(f.mp),
      String(f.xp_reward),
    ])
  const mobCreatedOf = async (r) => {
    const ids = (r.objectChanges || [])
      .filter(
        (c) =>
          c.type === 'created' &&
          (c.objectType || '').endsWith('::mob_template::MobTemplate')
      )
      .map((c) => c.objectId)
    const objs = ids.length
      ? await multiGetObjectsChunked(sui_client, ids, { showContent: true })
      : []
    return objs.map((o) => ({
      id: o.data.objectId,
      key: mobContentKey(o.data.content.fields),
    }))
  }
  const landMob = ({ row, id }) => {
    OUT.mobs[row.key] = { id, name: row.name, role: row.role }
  }

  // corpus-dupe dedupe, FIRST WINS — one home in `corpus_canon.mjs`, shared with the reseed planner so the
  // mint and a later reseed can never disagree about what a duplicated key means.
  const mobRows = canonical_rows(C.mobs)
  await backfillPending('mobs:', mobCreatedOf, (created) =>
    claimCreated(
      mobRows.filter((m) => !OUT.mobs[m.key]),
      mobRowKey,
      created
    ).forEach(landMob)
  )
  const pendingMobs = mobRows.filter((m) => !OUT.mobs[m.key])
  if (pendingMobs.length) {
    const { size } = await probeBatchSize(
      sui_client,
      ME,
      richest(pendingMobs, BATCH_PROBE.cap),
      (rows) => {
        const tx = new Transaction()
        buildMobsInto(tx, rows)
        return tx
      },
      BATCH_PROBE
    )
    console.log(
      `  mobs: batch size ${size} (${pendingMobs.length} pending → ${Math.ceil(pendingMobs.length / size)} txs)`
    )
    await runPreflightedBatches(
      pendingMobs,
      size,
      (candidate) => fitByInputs(candidate, buildMobsInto),
      (batch) => preflightExactBatch(batch, buildMobsInto),
      async (batch, offset) => {
        const label = `mobs:${offset}`
        const r = await execBatch(label, batch.length, (tx) =>
          buildMobsInto(tx, batch)
        )
        resolveBatch(batch, mobRowKey, await mobCreatedOf(r)).forEach(landMob)
        delete OUT.pendingDigests[label]
        persist()
      }
    )
  }

  // ── PHASE 6 · worlds (create + author: required_level, resource/mob spawn tables, dungeon key + rooms) ──
  // PHASE 5 mints duplicate keys first-wins; project the level from that SAME canonical row.
  const mob_level_by_key = canonical_map(C.mobs, mob_level_of)
  for (const W of C.worlds) {
    const label = `world:${W.id}`
    const { r: wr } = await exec(`${label}:create`, (tx) => {
      tx.moveCall({
        target: `${CGAME}::world::create_world`,
        arguments: [
          tx.object(CAP.game),
          tx.object(VER.game),
          tx.pure.u64(world_seed(W.id)),
          tx.pure.string(W.biome || 'plains'),
        ],
      })
    })
    const WID = wr
      ? createdId(wr, '::world::World')
      : OUT.worlds.find((w) => w.wid === W.id)?.id
    if (!WID) {
      OUT.skipped.push({
        kind: 'world',
        slug: W.id,
        why: `no World created in ${wr?.digest}`,
      })
      continue
    }
    const rooms = (W.dungeonRooms || [])
      .map((room) => room.map((k) => OUT.mobs[k]?.id).filter(Boolean))
      .filter((room) => room.length)
    await exec(`${label}:author`, (tx) => {
      const g = (fn, args) =>
        tx.moveCall({ target: `${CGAME}::world::${fn}`, arguments: args })
      const d = W.density ?? DENSITY // dense-from-minute-one; per-world override via world.json W.density
      g('set_density', [
        tx.object(CAP.game),
        tx.object(WID),
        tx.pure.u16(d.minGroups),
        tx.pure.u16(d.maxGroups),
        tx.pure.u16(d.minNodes),
        tx.pure.u16(d.maxNodes),
        tx.object(VER.game),
      ])
      if (Array.isArray(W.band) && W.band[0])
        g('set_required_level', [
          tx.object(CAP.game),
          tx.object(WID),
          tx.pure.u16(W.band[0]),
          tx.object(VER.game),
        ])
      // NODE CHARGES (07-12 tuning: "spawn packs of 10-20 wheat, less herbs, less ores"): min/max qty from
      // pack_qty_for_job's band (farmer 10-20 / herbalist 4-8 / miner 2-4); authored min/max overrides
      // per-row. Yield AMOUNT per gather stays the job-level roll, untouched.
      for (const res of W.resources || []) {
        if (!OUT.items[res.slug]) continue
        // protector = Option<ID>: unset → None; authored → its MINTED mob id STRING (the {id,name,role}
        // object tripped Address→toHex→bytes.reduce). Authored-but-unminted → COUNTED, then dialed None.
        let protector = null
        if (res.protector) {
          protector = OUT.mobs[res.protector]?.id ?? null
          if (!protector)
            OUT.skipped.push({
              kind: 'protector',
              slug: `${W.id}/${res.slug}`,
              why: `unminted protector mob '${res.protector}'`,
            })
        }
        const pack = pack_qty_for_job(res.job ?? 0, res.min_qty, res.max_qty)
        g('add_resource_entry', [
          tx.object(CAP.game),
          tx.object(WID),
          tx.pure.id(OUT.items[res.slug]),
          tx.pure.u16(bp(res.rate)),
          tx.pure.u16(pack.min),
          tx.pure.u16(pack.max),
          tx.pure.u8(res.job ?? 0),
          tx.pure.u8(res.tier ?? 1),
          tx.object(VER.game),
        ])
        // Protector pin = the ProtectorKey DF door (COMPATIBLE-upgrade law: the retired 10-arg
        // add_resource_entry param was a publish-time compat reject). Fresh worlds carry no stale
        // pins → fired only when the resolution above lands Some.
        if (protector)
          g('set_resource_protector', [
            tx.object(CAP.game),
            tx.object(WID),
            tx.pure.id(OUT.items[res.slug]),
            tx.pure.option('id', protector),
            tx.object(VER.game),
          ])
      }
      for (const grp of W.mobGroups || []) {
        if (OUT.mobs[grp.mob]) {
          g('add_mob_entry', [
            tx.object(CAP.game),
            tx.object(WID),
            tx.pure.id(OUT.mobs[grp.mob].id),
            tx.pure.u16(bp(grp.rate)),
            tx.pure.u16(2),
            tx.pure.u16(3),
            tx.object(VER.game),
          ])
          // DISTANCE DIFFICULTY: project the template's authored maxLevel into the World's MobLevelKey DF.
          // zone_comp filters the weighted table by this eligibility ceiling; weights stay untouched (D743).
          g('set_mob_level', [
            tx.object(CAP.game),
            tx.object(WID),
            tx.pure.id(OUT.mobs[grp.mob].id),
            tx.pure.u16(mob_level_by_key.get(grp.mob) ?? 1),
            tx.object(VER.game),
          ])
        }
      }
      // THE BOSS MASK (#1110): the mob-table row indexes whose authored role is `boss`. `zone_comp` reads it to
      // keep a boss group single-spec — without it every format-3 boss can be mixed with adds. Written AFTER all
      // add_mob_entry rows in the SAME PTB, because the mask indexes the table BY POSITION: mask and table are
      // committed together or a reseed could fence the wrong species. Wholesale overwrite, empty is meaningful.
      {
        const boss_rows = (W.mobGroups || [])
          .filter((grp) => OUT.mobs[grp.mob])
          .map((grp, index) => (OUT.mobs[grp.mob].role === 'boss' ? index : -1))
          .filter((index) => index >= 0)
        if (boss_rows.length)
          g('set_boss_mask', [
            tx.object(CAP.game),
            tx.object(WID),
            tx.pure.vector('u16', boss_rows),
            tx.object(VER.game),
          ])
      }
      if (W.dungeonKey && OUT.items[W.dungeonKey])
        g('set_dungeon_key', [
          tx.object(CAP.game),
          tx.object(WID),
          tx.pure.id(OUT.items[W.dungeonKey]),
          tx.object(VER.game),
        ])
      for (const room of rooms)
        g('add_dungeon_room', [
          tx.object(CAP.game),
          tx.object(WID),
          tx.pure.vector('id', room),
          tx.object(VER.game),
        ])
    })
    const resourcePacks = (W.resources || []).map((res) => {
      const pack = pack_qty_for_job(res.job ?? 0, res.min_qty, res.max_qty)
      return {
        slug: res.slug,
        job: res.job ?? 0,
        tier: res.tier ?? 1,
        min: pack.min,
        max: pack.max,
      }
    })
    const entry = {
      wid: W.id,
      id: WID,
      biome: W.biome,
      requiredLevel: W.band?.[0] ?? 1,
      resources: (W.resources || []).length,
      resourcePacks,
      mobGroups: (W.mobGroups || []).length,
      rooms: rooms.length,
    }
    // resume guard (2026-07-13): a skip-resume run used to push a DUPLICATE entry per world (40-row manifest
    // → the frontend projection would otherwise expose the world twice); one entry per wid, ever.
    if (!OUT.worlds.find((w) => w.wid === W.id)) OUT.worlds.push(entry)
    if (!OUT.world)
      OUT.world = { id: WID, biome: W.biome, seed: world_seed(W.id) } // primary world (up_gold adminDials + bot slice)
    persist()
  }

  // PHASE 4 (recipes) fires HERE — after the PHASE 6 spawn tables (the ghost-kill) are live on-chain.
  await seed_recipes()

  // ── PHASE 7 · shop sales (the REAL priced catalog — law: NO synthetic shop items). Shape-
  //    driven + skip-if-absent (seed/mainnet[/<biome>]/shop.json); sale ids aren't referenced → chunked.
  //    Prices authored in SUI; create_sale takes per-item MIST — sui_to_sale_mist converts ×1e9 BigInt-exact
  //    with a coherent-range REFUSE (a raw-SUI price would list the catalog for dust — money-path law).
  //    SHOP FRESHNESS (rider 2026-07-13): a concurrent lane may append shop rows mid-run (phases 2-6 take
  //    ~20 min) — re-read the corpus at THIS phase's start so the catalog is current-file truth. A row whose
  //    template never minted in PHASE 2 skips+records (row-level resume tops it up later) — never blocks. ──
  const FRESH = loadCorpus()
  const sales = []
  for (const s of FRESH.shop) {
    const slug = s.slug || s.item || s.template
    if (!OUT.items[slug]) {
      OUT.skipped.push({
        kind: 'shop',
        slug: String(slug),
        why: 'unminted sale template',
      })
      continue
    }
    sales.push({
      slug,
      price_mist: sui_to_sale_mist(s.price_sui ?? s.price),
      supply: s.supply ?? s.stock,
    })
  }
  for (let i = 0; i < sales.length; i += CHUNK) {
    const batch = sales.slice(i, i + CHUNK)
    await exec(`shop:${i}`, (tx) => {
      for (const s of batch) {
        const supply =
          s.supply != null
            ? optSome(tx, 'u64', tx.pure.u64(s.supply))
            : optNone(tx, 'u64')
        tx.moveCall({
          target: `${CITEMS}::shop::create_sale`,
          arguments: [
            tx.object(CAP.items),
            tx.pure.id(OUT.items[s.slug]),
            tx.pure.u64(s.price_mist),
            supply,
            tx.object(VER.items),
          ],
        })
      }
    })
    persist()
  }
  OUT.shop = sales.map((s) => ({
    template: OUT.items[s.slug],
    price_mist: s.price_mist.toString(),
    supply: s.supply ?? null,
  }))
  persist()

  // ── PHASE 7b · pet loot-box tables — POST-mint so pool slugs resolve from THIS run's mint map; an
  //    unminted pool pet = content gap → skip + record (NEVER set a broken pool). One tx per box.
  //    Reads the SAME phase-7 fresh corpus snapshot (box + pool rows stay mutually consistent). ──
  for (const box of FRESH.petBoxes || []) {
    const box_id = OUT.items[box.slug]
    const pool = (box.pool || []).map((p) => ({ ...p, id: OUT.items[p.pet] }))
    const missing = pool.filter((p) => !p.id).map((p) => p.pet)
    if (!box_id || !pool.length || missing.length) {
      OUT.skipped.push({
        kind: 'loot_table',
        slug: String(box.slug),
        why: `unminted refs: ${[box_id ? '' : box.slug, ...missing].filter(Boolean).join(',')}`,
      })
      continue
    }
    const { r } = await exec(`loot_table:${box.slug}`, (tx) => {
      tx.moveCall({
        target: `${CGIFT}::loot_box::admin_set_loot_table`,
        arguments: [
          tx.object(CAP.game),
          tx.object(SH.lootRegistry),
          tx.pure.id(box_id),
          tx.pure.vector(
            'id',
            pool.map((p) => p.id)
          ),
          tx.pure.vector(
            'u64',
            pool.map((p) => p.weight)
          ),
          tx.object(VER.game),
        ],
      })
    })
    if (r) {
      OUT.petBoxes = OUT.petBoxes || []
      OUT.petBoxes.push({
        box: box_id,
        pool: pool.map((p) => ({ pet: p.id, weight: p.weight })),
      })
    }
    persist()
  }

  // ── PHASE 8 · spells — the FULL 276-spell corpus (spells/<class>.json: 12 classes × 23 × 6 levels) →
  //    one (class, unlock, name=sp.id slug) shared SpellTemplate each. (B,P)=(10,9) is the corpus DESIGN
  //    budget (seed/generators/spells_classes_1_6.mjs:44) — testnet's {40,5} over-runs the band on 303
  //    levels; at (10,9) all 1656 are in-band. mint_spell re-validates + `run` dry-runs first (ZERO gas on a
  //    stray field). Manifest key class:unlock:id. BATCHED like PHASE 2/5; resolution is FREE (zero extra
  //    RPC): `SpellMinted` carries the identity the chain enforces unique (derived claim). Spell rows are
  //    the most command-dense shape (~31 cmd/row) so their probed size lands well below items/mobs. ──
  const SPELL_B = 30,
    SPELL_P = 9
  const spellsDir = path.join(seed_dir(), 'spells')
  const spellFiles = fs.existsSync(spellsDir)
    ? fs
        .readdirSync(spellsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : []
  const buildSpellsInto = (tx, rows) => {
    for (const sp of rows) {
      // SPELL_KITS Law 5: the corpus authors the per-level targeting bits — thread them to the mint
      // verbatim (`los` keeps its !==false default for resilience; the kit gate enforces presence).
      const levels = sp.levels.map((lvl) =>
        spellLevel(
          tx,
          {
            min_cl: lvl.min_char_level,
            ap: lvl.ap_cost,
            rmin: lvl.range_min,
            rmax: lvl.range_max,
            mod: lvl.modifiable_range,
            line: lvl.line_launch,
            los: lvl.line_of_sight,
            free: lvl.free_cell,
            cpt: lvl.casts_per_turn,
            cpta: lvl.casts_per_target,
            cd: lvl.cooldown_turns,
            crit: lvl.crit_rate,
          },
          (lvl.effects ?? []).map((e) => effectFx(tx, e)),
          (lvl.crit_effects ?? []).map((e) => effectFx(tx, e))
        )
      )
      tx.moveCall({
        target: `${CSPELLS}::spell_template::mint_spell`,
        arguments: [
          tx.object(CAP.spells),
          tx.object(SH.spellReg),
          tx.pure.string(sp.classType),
          tx.pure.u16(sp.unlock),
          tx.pure.string(sp.id),
          levelVec(tx, levels),
          tx.pure.u64(SPELL_B),
          tx.pure.u64(SPELL_P),
          tx.object(VER.spells),
        ],
      })
    }
  }
  const spellRowKey = (sp) => `${sp.classType}:${sp.unlock}:${sp.id}`
  const spellCreatedOf = (r) =>
    (r.events || [])
      .filter((e) => (e.type || '').endsWith('::spell_template::SpellMinted'))
      .map((e) => {
        const j = e.parsedJson ?? e.json ?? e.contents
        return { id: j.spell, key: `${j.class}:${j.unlock_level}:${j.name}` }
      })
  const landSpell = ({ row, id }) => {
    OUT.spells[spellRowKey(row)] = {
      id,
      name: row.name,
      class: row.classType,
      unlock: row.unlock,
      slot: row.slot ?? 0,
      role: row.role,
      element: row.element,
      description_key: row.description_key,
    }
  }

  const allSpells = []
  for (const file of spellFiles)
    for (const sp of JSON.parse(
      fs.readFileSync(path.join(spellsDir, file), 'utf8')
    ))
      allSpells.push(sp)
  const seenSpellKeys = new Set() // corpus-dupe dedupe — a dup (class,unlock,id) would abort the derived claim
  const spellRows = allSpells.filter(
    (sp) =>
      !seenSpellKeys.has(spellRowKey(sp)) && seenSpellKeys.add(spellRowKey(sp))
  )
  await backfillPending('spells:', spellCreatedOf, (created) =>
    claimCreated(
      spellRows.filter((sp) => !OUT.spells[spellRowKey(sp)]),
      spellRowKey,
      created
    ).forEach(landSpell)
  )
  const pendingSpells = spellRows.filter((sp) => !OUT.spells[spellRowKey(sp)])
  if (pendingSpells.length) {
    const spellProbe = { ...BATCH_PROBE, start: 6, step: 1 }
    const { size } = await probeBatchSize(
      sui_client,
      ME,
      richest(pendingSpells, BATCH_PROBE.cap),
      (rows) => {
        const tx = new Transaction()
        buildSpellsInto(tx, rows)
        return tx
      },
      // 2026-07-15: the kit sweep's zone-rich effects fattened spell rows to ~600 PTB inputs each
      // (10 rows = 6,035 inputs > the 2,048 cap) — BATCH_PROBE's floor (step 10) never probed lower
      // and the phase refused. Spells probe small: 3 rows ≈ 1,800 inputs clears both caps.
      spellProbe
    )
    console.log(
      `  spells: batch size ${size} (${pendingSpells.length} pending → ${Math.ceil(pendingSpells.length / size)} txs)`
    )
    await runPreflightedBatches(
      pendingSpells,
      size,
      (candidate) => fitByInputs(candidate, buildSpellsInto),
      (batch) => preflightExactBatch(batch, buildSpellsInto, spellProbe),
      async (batch, offset) => {
        const label = `spells:${offset}`
        const r = await execBatch(label, batch.length, (tx) =>
          buildSpellsInto(tx, batch)
        )
        resolveBatch(batch, spellRowKey, spellCreatedOf(r)).forEach(landSpell)
        delete OUT.pendingDigests[label]
        persist()
      }
    )
  }

  // ── Summary ──
  console.log(`\n=== FULL CORPUS SEED COMPLETE ===`)
  console.log(
    `items:${Object.keys(OUT.items).length} mobs:${Object.keys(OUT.mobs).length} spells:${Object.keys(OUT.spells).length} recipes:${OUT.recipes.length} shop:${OUT.shop.length} worlds:${OUT.worlds.length} categories:${OUT.categories.length}`
  )
  if (OUT.skipped.length)
    console.log(
      `SKIPPED (shape drift) x${OUT.skipped.length}: ${JSON.stringify(OUT.skipped.slice(0, 20))}`
    )
  console.log(
    `gas: ${OUT.gas.totalSui.toFixed(4)} SUI (${gasMist} MIST) · manifest → ${OUT_PATH}`
  )
  return OUT
}

// ── LOCALNET-ONLY guard: refuse a remote chain without an explicit confirmation env (gated by design) ──
function guard_network() {
  const grpc = process.env.SUI_GRPC_URL || ''
  const local = /(127\.0\.0\.1|localhost|0\.0\.0\.0|::1)/.test(grpc)
  const confirm = process.env.SEED_CONFIRM_REMOTE
  if (local) return
  if (confirm && (process.env.NETWORK || 'testnet') === confirm) {
    console.warn(
      `\n⚠️  seed_full_corpus: REMOTE seed authorized — SUI_GRPC_URL=${grpc || '(default fullnode)'} · SEED_CONFIRM_REMOTE=${confirm}\n`
    )
    return
  }
  throw new Error(
    `seed_full_corpus is LOCALNET/gate-only. REFUSING to seed a remote chain (SUI_GRPC_URL=${grpc || '(default public fullnode)'}). ` +
      `Testnet/mainnet full seeds stay owner-gated. Override: SUI_GRPC_URL=<localnet> OR SEED_CONFIRM_REMOTE=<network> matching NETWORK.`
  )
}

// CLI auto-run (skipped when imported by seed_testnet's --corpus delegation)
if (import.meta.url === `file://${process.argv[1]}`) {
  seed_full_corpus().catch((e) => {
    persist()
    console.error(`\nFULL CORPUS SEED STOPPED: ${e.message}`)
    console.error(
      `partial manifest persisted → ${OUT_PATH} (digests: ${Object.keys(OUT.digests).length})`
    )
    process.exit(1)
  })
}
