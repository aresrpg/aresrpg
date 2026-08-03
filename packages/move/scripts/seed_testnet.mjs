// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEED_TESTNET — S-21-seed. The DISPOSABLE minimal-E2E content seed for the FRESHLY-PUBLISHED testnet lineage
// (scripts/out/ceremony_manifest.json). SANCTIONED, TESTNET ONLY — none of this survives (real content is
// redeployed manually later). Authoring runs while the packages are DARK (every door gates on
// `assert_latest`, which passes pre-enable BY DESIGN); this script NEVER flips an enable flag or touches mainnet.
//
// Every id is retargeted to the LIVE lineage; every entry signature was read from the CURRENT
// packages/move/*/sources today (the module layout changed vs the old seed_*.js — spells now live-tunable per
// (class,unlock_level); mobs in fight::mob; dungeon = a game::world with rooms + a key; item stats/damages/effect
// are typed DFs built in-PTB). Content SHAPES mirror the retired seed_spells.js / seed_content.mjs.
//
// MONEY LAW: reuses ceremony_lib's `run` — dryRun-derived budget ×1.5, a hard 1-SUI/tx ceiling, and NO retry of
// an EXECUTED failure (a digest = gas burned). Each tx is dry-run BEFORE it signs, so a bad PTB stops the run
// with ZERO gas burned. The seed manifest is persisted after EVERY tx, so a mid-run stop loses no captured id.
//
// RUN (JSON-RPC on the public fullnode is disabled → use a working RPC):
//   env $(grep VITE_DEV_KEY ../../.env | sed 's/VITE_DEV_KEY/PRIVATE_KEY/') \
//     NETWORK=testnet SUI_RPC=https://sui-testnet-rpc.publicnode.com \
//     node packages/move/scripts/seed_testnet.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import { ITEM_STAT_SHIFT as SHIFT } from '../../sim/src/equipment_stats.js'

import { keypair, sui_client } from './client.js'
import { run, netGas } from './ceremony_lib.mjs'
import { damage_lines, pack_qty_for_job } from './seed_economy.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dir, 'out', 'ceremony_manifest.json'), 'utf8'))
const OUT_PATH = path.join(__dir, 'out', 'seed_manifest.json')
// S-21 single-source content (SPEC §12.8 / §7 pipeline): ALL content lives in seed_content.json,
// validated pre-mint by packages/validation (`bunx aresrpg-validate seed packages/move/scripts/seed_content.json`).
const SEED = JSON.parse(fs.readFileSync(path.join(__dir, 'seed_content.json'), 'utf8'))
const CEIL = 1 // refuse any tx whose derived budget exceeds 1 SUI (task law)

// ── Live lineage (retargeted ids) ─────────────────────────────────────────────
const FND = MANIFEST.foundation.pkg
const ITEMS = MANIFEST.items.pkg
const SPELLS = MANIFEST.spells.pkg
const GAME = MANIFEST.game.pkg
const FIGHT = MANIFEST.fight.pkg
// LINEAGE STAMP (root fix for the stale-resume class): the manifest is BOUND to the EXACT package set it minted
// against. A persisted manifest whose stamp ≠ the current ceremony is from a DEAD lineage — its object ids point
// at packages that no longer exist, so folding it as "resume" SKIPS live items as already-seeded (07-12 incident:
// 45 old-lineage digests skipped → those items MISSING from the fresh lineage). A mismatched manifest is ARCHIVED
// aside (renamed, never deleted) and the run starts fresh — the stale-resume is made unrepresentable.
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
  fight: MANIFEST.fight.version,
}
// 2026-07-13 gifting/dungeon split: creation.move + loot_box.move (and their shared Creation/LootRegistry) live
// in the REAL `aresrpg_gifting` sibling now — their ids come off the manifest's own `gifting` entry, and their
// admin doors are CALL-TARGETED at the gifting package (the AdminCap stays core's — one super cap).
const GIFTING = MANIFEST.gifting.pkg
const SH = {
  catalog: MANIFEST.items.shared.Catalog,
  creation: MANIFEST.gifting.shared.Creation,
  scribe: MANIFEST.items.shared.ScribeConfig,
  spellReg: MANIFEST.spells.shared.SpellRegistry,
  gameConfig: MANIFEST.game.shared.GameConfig,
  petFeed: MANIFEST.game.shared.PetFeedConfig,
  lootRegistry: MANIFEST.gifting.shared.LootRegistry,
}

// ── Move type tags (for typed Options / MoveVecs) ─────────────────────────────
const T = {
  effect: `${FND}::spell_effect::Effect`,
  level: `${FND}::spell_effect::SpellLevel`,
  loot: `${FIGHT}::mob::MobLootEntry`,
  istats: `${ITEMS}::item_stats::ItemStatistics`,
  idmg: `${ITEMS}::item_damages::ItemDamages`,
  ceff: `${ITEMS}::consumable_effect::ConsumableEffect`,
}
// [world-mob-size 2026-07-12 · groups DOUBLED 2026-07-13] fresh-lineage spawn density. create_world defaults are a
// sparse 3-8 groups / 8-16 nodes; the 07-11 live dial raised them to 12-24 / 16-28; baked ≈1.5× → 18-36 / 24-42.
// The mob-group density floor doubled 2026-07-13 ("at LEAST double the mob groups"): literal 2× max (72) breaches DENSITY_MAX=64, so the min
// carries it — RULED band 48-64 (avg 27→56 = 2.07×, strictly ≥2×). Lock-step with seed_full_corpus.mjs's DENSITY.
const DENSITY = { minGroups: 48, maxGroups: 64, minNodes: 24, maxNodes: 42 }

// ── Accumulating output manifest (persisted after every phase) ────────────────
const ME = keypair.getPublicKey().toSuiAddress()
const OUT = {
  _network: MANIFEST._network,
  _signer: ME,
  _lineage: 'ceremony_manifest.json',
  _stamp: LINEAGE_STAMP,
  _seededAt: new Date().toISOString(),
  _note: 'DISPOSABLE testnet QA seed (S-21). Not for mainnet.',
  categories: [],
  items: {},
  scribeBands: [],
  class: null,
  spells: {},
  recipes: [],
  petFood: null,
  mobs: {},
  world: null,
  digests: {},
  gas: { totalMist: 0, totalSui: 0 },
}
// RESUME (lineage-guarded): fold the persisted partial ONLY if its stamp matches the current lineage. A manifest
// from a superseded publish is ARCHIVED aside (never deleted) and the run starts fresh — dead ids can never be
// folded in as "already seeded" (the digest guard would otherwise skip live items into a broken lineage).
if (fs.existsSync(OUT_PATH)) {
  let prev = null
  try {
    prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
  } catch {
    /* no prior manifest — fresh run */
  }
  if (prev && prev._stamp === LINEAGE_STAMP) Object.assign(OUT, prev)
  else if (prev) {
    const archived = OUT_PATH.replace(/\.json$/, `.stale-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.renameSync(OUT_PATH, archived)
    console.log(`  [resume] manifest stamp ≠ current lineage → archived ${path.basename(archived)}; starting FRESH`)
  }
}
const persist = () => fs.writeFileSync(OUT_PATH, JSON.stringify(OUT, null, 2))

// ── tx helpers ────────────────────────────────────────────────────────────────
// TRANSIENT pre-consensus errors from a laggy multi-node RPC (publicnode is a load-balanced pool): the signer runs
// on a SINGLE gas coin, so its version advances by one per tx — a read that lands on a lagging pool node returns the
// pre-mutation version and the fullnode rejects the tx as "unavailable for consumption" BEFORE it enters consensus
// (no digest, no gas burned). Rebuilding against a fresh gas-coin read is the fix. MONEY LAW: only this pre-flight
// class is retried — an EXECUTED failure throws 'FAILED (executed)' from ceremony_lib.run and NEVER matches here.
const TRANSIENT =
  /unavailable for consumption|not available for consumption|needs to be rebuilt|reserved for another transaction|ObjectVersionUnavailable|equivocat|Cannot find gas coin/i
let gasMist = 0
async function exec(label, build, tries = 5) {
  if (OUT.digests?.[label]) {
    console.log(`  [${label}] SKIP (already seeded: ${OUT.digests[label].slice(0, 8)}…)`)
    return { r: null, skipped: true }
  }
  for (let attempt = 1; ; attempt++) {
    const tx = new Transaction()
    const captured = build(tx)
    try {
      const r = await run(sui_client, keypair, label, tx, { ceilingSui: CEIL })
      gasMist += netGas(r.effects.gasUsed)
      OUT.digests[label] = r.digest
      OUT.gas.totalMist = gasMist
      OUT.gas.totalSui = gasMist / 1e9
      return { r, ids: captured ? captured(r) : null }
    } catch (e) {
      if (attempt < tries && TRANSIENT.test(e.message || '')) {
        const backoff = 2000 * attempt
        console.log(
          `  [${label}] transient pre-flight (gas-coin version race) — rebuild+retry ${attempt}/${tries - 1} in ${backoff}ms`
        )
        await new Promise((res) => setTimeout(res, backoff))
        continue
      }
      throw e
    }
  }
}
const createdId = (r, suffix) =>
  (r.objectChanges || []).find((c) => c.type === 'created' && (c.objectType || '').endsWith(suffix))?.objectId

// ── PTB builders ──────────────────────────────────────────────────────────────
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

// A centered 17-field ItemStatistics (defaults SHIFT; `ov` overrides are RAW deltas added onto SHIFT).
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
    target: `${ITEMS}::item_stats::new`,
    arguments: FIELDS.map((f) => tx.pure.u16(SHIFT + (ov[f] || 0))),
  })
const dmgLine = (tx, from, to, type, element) =>
  tx.moveCall({
    target: `${ITEMS}::item_damages::new`,
    arguments: [tx.pure.u16(from), tx.pure.u16(to), tx.pure.string(type), tx.pure.string(element)],
  })

// Per-tx memoized foundation element getters (zero magic numbers for spell-effect elements).
function elements(tx) {
  const cache = new Map()
  const el = (name) => {
    if (!cache.has(name)) cache.set(name, tx.moveCall({ target: `${FND}::spell::${name}` }))
    return cache.get(name)
  }
  return el
}
const dmgFx = (tx, elHandle, base) =>
  tx.moveCall({
    target: `${FND}::spell_effect::damage`,
    arguments: [elHandle, tx.pure.u64(base)],
  })
const healFx = (tx, base) =>
  tx.moveCall({
    target: `${FND}::spell_effect::heal`,
    arguments: [tx.pure.u64(base)],
  })
const fxVec = (tx, effects) => tx.makeMoveVec({ type: T.effect, elements: effects })
// new_spell_level(min_cl,ap,rmin,rmax,mod,line,los,free,cpt,cpta,cd,crit_rate,ends,req[],forb[],fx[],crit_fx[])
const spellLevel = (tx, o, fx, crit) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_spell_level`,
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
const levelVec = (tx, levels) => tx.makeMoveVec({ type: T.level, elements: levels })
// spell::new_stats(str,int,chance,agility,raw,crit,range,fireRes,waterRes,earthRes,airRes) — resistances centered
const mobStats = (tx, s) =>
  tx.moveCall({
    target: `${FND}::spell::new_stats`,
    arguments: [s.str, s.int, s.chance, s.agility, s.raw, s.crit, s.range, SHIFT, SHIFT, SHIFT, SHIFT].map((v) =>
      tx.pure.u64(v || 0)
    ),
  })
const lootEntry = (tx, itemId, chance, min, max) =>
  tx.moveCall({
    target: `${FIGHT}::mob::new_loot_entry`,
    arguments: [tx.pure.id(itemId), tx.pure.u16(chance), tx.pure.u16(min), tx.pure.u16(max)],
  })
const lootVec = (tx, entries) => tx.makeMoveVec({ type: T.loot, elements: entries })

// ── Content mappers (ALL content lives in seed_content.json — the single source of truth) ──
const CLASS = SEED.class
// The core-class FLOOR (law since 07-11): these four MUST always be whitelisted on the creation gate so they
// are never gated behind "coming soon". A floor, not a ceiling — future classes stay gated until explicitly added.
const CORE_CLASSES = ['senshi', 'yajin', 'tomoda', 'shugo']
const { B, P } = SEED.spellBudget // damage-budget dials (spell_bands): value <= B + P*min_cl
const minCl = (unlock) => [1, 20, 40, 60, 80, unlock + 100] // monotone per-level gate, L6 = unlock+100
const elMove = (name) => `el_${name}` // 'fire' → 'el_fire' (foundation spell element getter)
// One authored effect shorthand → a foundation Effect handle. Mirrors seed_schema.ts's resolve_effect
// so the validator and the mint build the IDENTICAL on-chain Effect.
const buildEffect = (tx, el, e) => {
  if (e.op === 'heal') return healFx(tx, e.base)
  if (e.op === 'damage') return dmgFx(tx, el(elMove(e.element)), e.base)
  throw new Error(`seed_content: unsupported effect op '${e.op}'`)
}

// ════════════════════════════ PHASES ════════════════════════════
async function main() {
  // --corpus switch (env, inherited by the gold harness's seed step): `mainnet` delegates to the FULL authored-
  // corpus seeder (seed/mainnet/**) for localnet seed-parity; default (`active`) mints the minimal seed_content.json
  // below. Same out/seed_manifest.json shape either way (world.id/items/mobs/recipes) — all consumers unchanged.
  const CORPUS = process.env.GOLD_CORPUS ?? process.env.SEED_CORPUS ?? 'active'
  if (CORPUS === 'mainnet') {
    const { seed_full_corpus } = await import('./seed_full_corpus.mjs')
    try {
      await seed_full_corpus()
    } catch (e) {
      // The full-corpus seeder persists its OWN partial manifest after every tx — this script's catch would
      // OVERWRITE it with the untouched `active` skeleton (observed: digests:0 clobber). Exit here instead.
      console.error(`\nSEED STOPPED (full-corpus): ${e.message}`)
      process.exit(1)
    }
    return
  }

  console.log(`\n=== SEED TESTNET · network=${MANIFEST._network} · signer=${ME} ===`)
  // Preflight: the 4 super AdminCaps must be owned by the signer (else every authoring tx aborts unverified).
  for (const [k, id] of Object.entries(CAP)) {
    const { object } = await sui_client.getObject({ objectId: id })
    if (object?.owner?.AddressOwner !== ME)
      throw new Error(`PREFLIGHT: ${k} AdminCap ${id} not owned by signer (${JSON.stringify(object?.owner)})`)
  }
  console.log('preflight OK — 4 AdminCaps owned by signer\n')

  // ── PHASE 1 · categories (one PTB; a dup would abort the whole tx, but the Catalog ships empty) ──
  const cats = [...SEED.categories.weaponFamilies, ...SEED.categories.nonWeapon]
  await exec('categories', (tx) => {
    for (const c of cats)
      tx.moveCall({
        target: `${ITEMS}::admin::add_category`,
        arguments: [tx.object(CAP.items), tx.object(SH.catalog), tx.pure.string(c), tx.object(VER.items)],
      })
    return () => {}
  })
  OUT.categories = cats
  persist()

  // ── PHASE 2 · scribe bands — exercises the scribe authoring door ──
  for (const band of SEED.scribeBands || []) {
    await exec(`scribe_band_L${band.level}`, (tx) => {
      tx.moveCall({
        target: `${ITEMS}::scribe::set_band`,
        arguments: [
          tx.object(CAP.items),
          tx.object(SH.scribe),
          tx.pure.u16(band.level),
          statsBlock(tx, band.stats),
          tx.object(VER.items),
        ],
      })
      return () => {}
    })
  }
  OUT.scribeBands = (SEED.scribeBands || []).map((b) => b.level)
  persist()

  // ── PHASE 3 · item templates (one per tx → unambiguous created-id capture) ──
  const item = async (slug, name, itemType, category, opts = {}) => {
    const { r } = await exec(`item:${slug}`, (tx) => {
      const smin = opts.stats ? optSome(tx, T.istats, statsBlock(tx, opts.stats.min)) : optNone(tx, T.istats)
      const smax = opts.stats ? optSome(tx, T.istats, statsBlock(tx, opts.stats.max)) : optNone(tx, T.istats)
      // dmg accepts a single line OBJECT or a multi-line ARRAY via the shared normalizer (one home).
      const dmg = tx.makeMoveVec({
        type: T.idmg,
        elements: damage_lines(opts.dmg).map((d) => dmgLine(tx, d.from, d.to, d.type, d.element)),
      })
      // consumable effect: a gacha BOX (KIND_GACHA_ROLL, amount 0 — the pool is the loot table) or a HEAL (amount).
      const eff = opts.gacha
        ? optSome(
            tx,
            T.ceff,
            tx.moveCall({
              target: `${ITEMS}::consumable_effect::new`,
              arguments: [
                tx.moveCall({
                  target: `${ITEMS}::consumable_effect::gacha_roll`,
                }),
                tx.pure.u64(0),
              ],
            })
          )
        : opts.heal != null
          ? optSome(
              tx,
              T.ceff,
              tx.moveCall({
                target: `${ITEMS}::consumable_effect::new`,
                arguments: [tx.moveCall({ target: `${ITEMS}::consumable_effect::heal` }), tx.pure.u64(opts.heal)],
              })
            )
          : optNone(tx, T.ceff)
      // admin::create_template(cap, catalog, name, DESCRIPTION, item_type, category, level, stats_min, stats_max,
      // damages, effect, version) — the `description` rider (admin.move:91) lands 4th, between name and item_type.
      // seed_content.json carries no descriptions (disposable QA seed) → default ''; matches seed_full_corpus.mjs.
      tx.moveCall({
        target: `${ITEMS}::admin::create_template`,
        arguments: [
          tx.object(CAP.items),
          tx.object(SH.catalog),
          tx.pure.string(name),
          tx.pure.string(opts.description ?? ''),
          tx.pure.string(itemType),
          tx.pure.string(category),
          tx.pure.u16(opts.level ?? 1),
          smin,
          smax,
          dmg,
          eff,
          tx.object(VER.items),
        ],
      })
      return () => {}
    })
    if (!r) return
    const id = createdId(r, '::item::ItemTemplate')
    if (!id) throw new Error(`item ${slug}: no ItemTemplate created in ${r.digest}`)
    OUT.items[slug] = id
    persist()
    return id
  }
  // Every item from the single source: weapons (stats + one damage line), resources, the heal consumable, the
  // dungeon key, runes, the pet — one create_template tx each (unambiguous created-id capture).
  for (const it of SEED.items)
    await item(it.slug, it.name, it.itemType, it.category, {
      description: it.description,
      level: it.level,
      stats: it.stats,
      dmg: it.dmg,
      heal: it.heal,
      gacha: it.gacha,
    })

  // ── PHASE 4 · creation gate — whitelist the CORE class floor ──
  // CORE-CLASS LAW (07-11): senshi/yajin/tomoda/shugo are core classes and MUST ALWAYS be pickable — a fresh
  // publish can NEVER ship with any of them behind the "coming soon" gate (that gate is only for genuinely
  // future classes). We whitelist the mandatory floor, unioned with the seed's configured class, in ONE tx.
  // (Was: whitelisted only `SEED.class` = senshi, which left yajin/tomoda/shugo — and the other roster — gated.)
  const WHITELIST = [...new Set([...CORE_CLASSES, ...[CLASS].filter(Boolean)])]
  await exec('add_classes', (tx) => {
    for (const c of WHITELIST)
      tx.moveCall({
        target: `${GIFTING}::creation::add_class`,
        arguments: [tx.object(CAP.items), tx.object(SH.creation), tx.pure.string(c), tx.object(VER.items)],
      })
    return () => {}
  })
  OUT.class = CLASS
  OUT.classes = WHITELIST
  persist()

  // ── PHASE 5 · crafting recipes (game AdminCap) ──
  // create_recipe(cap, version, input_templates, input_quantities, output_template, output_quantity, required_job,
  // craft_xp) — the `required_job: u8` + `craft_xp: u64` riders (crafting.move:120) land after output_quantity.
  // seed_content.json omits them (minimal QA seed) → job 0 (matches iron_ore's job:0) + 50 xp; matches full_corpus.
  const recipe = async (label, inputs, qtys, output, outQty, requiredJob = 0, craftXp = 50) => {
    const { r } = await exec(`recipe:${label}`, (tx) => {
      tx.moveCall({
        target: `${GAME}::crafting::create_recipe`,
        arguments: [
          tx.object(CAP.game),
          tx.object(VER.game),
          tx.pure.vector('id', inputs),
          tx.pure.vector('u64', qtys),
          tx.pure.id(output),
          tx.pure.u64(outQty),
          tx.pure.u8(requiredJob),
          tx.pure.u64(craftXp),
        ],
      })
      return () => {}
    })
    if (r)
      OUT.recipes.push({
        label,
        recipe: createdId(r, '::crafting::Recipe'),
        output,
        outQty,
      })
    persist()
  }
  for (const rc of SEED.recipes)
    await recipe(
      rc.label,
      rc.inputs.map((i) => OUT.items[i.slug]),
      rc.inputs.map((i) => i.qty),
      OUT.items[rc.output],
      rc.outQty,
      rc.required_job,
      rc.craft_xp
    )

  // ── PHASE 6 · pet feed config ──
  if (SEED.petFood) {
    await exec('pet_food:kibble', (tx) => {
      tx.moveCall({
        target: `${GAME}::pet::set_food_power`,
        arguments: [
          tx.object(CAP.game),
          tx.object(VER.game),
          tx.object(SH.petFeed),
          tx.pure.id(OUT.items[SEED.petFood.slug]),
          tx.pure.u64(SEED.petFood.powerPerUnit),
        ],
      })
      return () => {}
    })
    OUT.petFood = {
      food_template: OUT.items[SEED.petFood.slug],
      power_per_unit: SEED.petFood.powerPerUnit,
    }
    persist()
  }

  // ── PHASE 6b · pet loot-box tables (game AdminCap) — the gacha pool per box, set POST-mint so slugs resolve to
  //    template ids from this run's own mint map. A pool pet that never minted is a content gap → skip + record
  //    (never set a table referencing a missing template — a broken pool would abort open_box on-chain). ──
  for (const box of SEED.petBoxes || []) {
    const box_id = OUT.items[box.box]
    const pool = box.pool.map((p) => ({ ...p, id: OUT.items[p.pet] }))
    const missing = pool.filter((p) => !p.id).map((p) => p.pet)
    if (!box_id || missing.length) {
      OUT.skipped = OUT.skipped || []
      OUT.skipped.push({
        kind: 'loot_table',
        slug: box.box,
        why: `unminted refs: ${[box_id ? '' : box.box, ...missing].filter(Boolean).join(',')}`,
      })
      continue
    }
    const { r: table_r } = await exec(`loot_table:${box.box}`, (tx) => {
      tx.moveCall({
        target: `${GIFTING}::loot_box::admin_set_loot_table`,
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
      return () => {}
    })
    if (table_r) {
      OUT.petBoxes = OUT.petBoxes || []
      OUT.petBoxes.push({
        box: box_id,
        pool: pool.map((p) => ({ pet: p.id, weight: p.weight })),
      })
    }
    persist()
  }

  // ── PHASE 6c · QA box SALE (items AdminCap) — the localnet gate bots BUY the box through the live shop door
  //    (sdk buy_ptb) then open it (loot_box::open_box): the full player path. 1 SUI, UNLIMITED supply — QA
  //    vending only (supply enforcement is shop unit-test-proven; a sellout would only flake repeated gate runs). ──
  for (const box of SEED.petBoxes || []) {
    const box_id = OUT.items[box.box]
    if (!box_id) continue // unminted box — already recorded as a loot_table skip above
    const { r: sale_r } = await exec(`sale:${box.box}`, (tx) => {
      tx.moveCall({
        target: `${ITEMS}::shop::create_sale`,
        arguments: [
          tx.object(CAP.items),
          tx.pure.id(box_id),
          tx.pure.u64(1_000_000_000),
          optNone(tx, 'u64'),
          tx.object(VER.items),
        ],
      })
      return () => {}
    })
    if (sale_r) {
      OUT.sales = OUT.sales || []
      OUT.sales.push({
        label: box.box,
        sale: createdId(sale_r, '::shop::Sale'),
        template: box_id,
        price_mist: '1000000000',
        supply: null,
      })
    }
    persist()
  }

  // ── PHASE 8 · spells — each its own (class,unlock,name) shared SpellTemplate; 6 levels expanded from dmgRows.
  //    `name` (display, unique per class+unlock here) is the mint identity; one spell per (class,unlock) in this
  //    minimal seed, so the manifest key is class:unlock (the fight-bar projection joins on exactly that). ──
  for (const s of SEED.spells) {
    const { r } = await exec(`spell:${s.class}:${s.unlock}`, (tx) => {
      const el = elements(tx)
      const gates = minCl(s.unlock)
      const levels = s.dmgRows.map((base, i) => {
        const min_cl = gates[i]
        if (s.kind === 'heal')
          return spellLevel(tx, { min_cl, ap: 4, rmin: 0, rmax: 4, los: true, crit: 0 }, [healFx(tx, base)], [])
        return spellLevel(
          tx,
          { min_cl, ap: 4, rmin: 1, rmax: 4, los: true, crit: 50 },
          [dmgFx(tx, el(elMove(s.element)), base)],
          [dmgFx(tx, el(elMove(s.element)), base + 10)]
        )
      })
      tx.moveCall({
        target: `${SPELLS}::spell_template::mint_spell`,
        arguments: [
          tx.object(CAP.spells),
          tx.object(SH.spellReg),
          tx.pure.string(s.class),
          tx.pure.u16(s.unlock),
          tx.pure.string(s.name),
          levelVec(tx, levels),
          tx.pure.u64(B),
          tx.pure.u64(P),
          tx.object(VER.spells),
        ],
      })
      return () => {}
    })
    if (r)
      OUT.spells[`${s.class}:${s.unlock}`] = {
        id: createdId(r, '::spell_template::SpellTemplate'),
        name: s.name,
        kind: s.kind,
      }
    persist()
  }

  // ── PHASE 9 · mobs (fight::mob) — melee, ranged, HEALER (ally-inclusive heal kit for E2E coverage) ──
  const mob = async (key, cfg) => {
    const { r } = await exec(`mob:${key}`, (tx) => {
      const el = elements(tx)
      const spells = cfg.spells(tx, el)
      const loot = lootVec(tx, cfg.loot(tx))
      tx.moveCall({
        target: `${GAME}::mob_template::mint`,
        arguments: [
          tx.object(CAP.game),
          tx.object(VER.game),
          tx.pure.string(cfg.name),
          tx.pure.u16(cfg.minL),
          tx.pure.u16(cfg.maxL),
          tx.pure.u64(cfg.hp),
          tx.pure.u64(cfg.ap),
          tx.pure.u64(cfg.mp),
          el(cfg.element),
          mobStats(tx, cfg.stats),
          levelVec(tx, spells),
          loot,
          tx.pure.u64(cfg.xp),
        ],
      })
      return () => {}
    })
    if (r)
      OUT.mobs[key] = {
        id: createdId(r, '::mob_template::MobTemplate'),
        name: cfg.name,
        kit: cfg.kit,
      }
    persist()
  }
  // Mobs from the single source. HEALER kit: heal() bakes in TF_NOT_ENEMY (ally+self — never heals enemies, §8/S-59).
  for (const m of SEED.mobs)
    await mob(m.key, {
      name: m.name,
      minL: m.minLevel,
      maxL: m.maxLevel,
      hp: m.hp,
      ap: m.ap,
      mp: m.mp,
      element: elMove(m.element),
      xp: m.xp,
      stats: m.stats,
      kit: m.key,
      spells: (tx, el) =>
        m.spells.map((sl) =>
          spellLevel(
            tx,
            {
              min_cl: sl.min_cl,
              ap: sl.ap,
              rmin: sl.rmin,
              rmax: sl.rmax,
              los: sl.los,
              crit: sl.crit,
            },
            sl.effects.map((e) => buildEffect(tx, el, e)),
            (sl.crit_effects || []).map((e) => buildEffect(tx, el, e))
          )
        ),
      loot: (tx) => m.loot.map((l) => lootEntry(tx, OUT.items[l.item], l.chance, l.min, l.max)),
    })

  // ── PHASE 10 · world (create + author: resources + mob groups + key + the base dungeon roster) ──
  const W = SEED.world
  const { r: wr } = await exec('world:create', (tx) => {
    tx.moveCall({
      target: `${GAME}::world::create_world`,
      arguments: [tx.object(CAP.game), tx.object(VER.game), tx.pure.u64(W.seed), tx.pure.string(W.biome)],
    })
    return () => {}
  })
  const WORLD = wr ? createdId(wr, '::world::World') : OUT.world?.id
  if (!WORLD) throw new Error(`world create: no World object in ${wr.digest}`)
  OUT.world = {
    id: WORLD,
    biome: W.biome,
    seed: W.seed,
    resources: [],
    mobGroups: [],
    dungeonKey: null,
    dungeonRooms: [],
  }
  // worlds[] alias retained for the plural {wid,id,name}[] shape the full-corpus seed emits.
  // The minimal seed has exactly ONE world → a single-entry array so the SAME stamper pours it into T62_WORLDS[0]
  // (the auto-join default) unchanged. `name` takes precedence over the wid-derivation → label stays 'Testlands'.
  OUT.worlds = [
    {
      wid: `01_${W.biome}`,
      id: WORLD,
      name: W.biome.charAt(0).toUpperCase() + W.biome.slice(1),
    },
  ]
  persist()

  // Rooms WITHOUT the healer = the original roster (world:author, digest-stable). Rooms WITH the healer =
  // the S-59 fix, appended under a NEW label (PHASE 10b) so a RESUMED 2-room world still gains it.
  const roomHasHealer = (room) => room.includes('healer')
  const baseRooms = W.dungeonRooms.filter((room) => !roomHasHealer(room))
  const healerRooms = W.dungeonRooms.filter(roomHasHealer)
  const roomIds = (room) => room.map((k) => OUT.mobs[k].id)

  await exec('world:author', (tx) => {
    const g = (fn, args) => tx.moveCall({ target: `${GAME}::world::${fn}`, arguments: args })
    const d = W.density ?? DENSITY // dense-from-minute-one; seed_content.json world may override via density
    g('set_density', [
      tx.object(CAP.game),
      tx.object(WORLD),
      tx.pure.u16(d.minGroups),
      tx.pure.u16(d.maxGroups),
      tx.pure.u16(d.minNodes),
      tx.pure.u16(d.maxNodes),
      tx.object(VER.game),
    ])
    for (const res of W.resources) {
      // pack sizes by job (07-12 Testlands finding — seed_economy.mjs pack_qty_for_job): farmer 10-20 / herbalist
      // 4-8 / miner 2-4, superseding the flat 1/1 "one gather = one node" default; a row may still author explicit
      // minQty/maxQty to override.
      const pack = pack_qty_for_job(res.job, res.minQty, res.maxQty)
      g('add_resource_entry', [
        tx.object(CAP.game),
        tx.object(WORLD),
        tx.pure.id(OUT.items[res.slug]),
        tx.pure.u16(res.rate),
        tx.pure.u16(pack.min),
        tx.pure.u16(pack.max),
        tx.pure.u8(res.job),
        tx.pure.u8(res.tier),
        tx.object(VER.game),
      ])
      // Protector pin = the ProtectorKey DF door (COMPATIBLE-upgrade law: a struct field / param add on the
      // live add_resource_entry is a publish-time reject). Resolve the minted mob's id STRING — OUT.mobs[key]
      // is { id, name, ... } and the raw object crashes pure.option('id') (seed_full_corpus.test.mjs).
      // Fresh worlds carry no stale pins → fired only when authored + minted.
      const protector = res.protector ? (OUT.mobs?.[res.protector]?.id ?? null) : null
      if (protector)
        g('set_resource_protector', [
          tx.object(CAP.game),
          tx.object(WORLD),
          tx.pure.id(OUT.items[res.slug]),
          tx.pure.option('id', protector),
          tx.object(VER.game),
        ])
    }
    for (const grp of W.mobGroups)
      g('add_mob_entry', [
        tx.object(CAP.game),
        tx.object(WORLD),
        tx.pure.id(OUT.mobs[grp.mob].id),
        tx.pure.u16(grp.rate),
        tx.pure.u16(grp.minGroup),
        tx.pure.u16(grp.maxGroup),
        tx.object(VER.game),
      ])
    g('set_dungeon_key', [
      tx.object(CAP.game),
      tx.object(WORLD),
      tx.pure.id(OUT.items[W.dungeonKey]),
      tx.object(VER.game),
    ])
    for (const room of baseRooms)
      g('add_dungeon_room', [
        tx.object(CAP.game),
        tx.object(WORLD),
        tx.pure.vector('id', roomIds(room)),
        tx.object(VER.game),
      ])
    return () => {}
  })
  OUT.world.resources = W.resources.map((res) => {
    const pack = pack_qty_for_job(res.job, res.minQty, res.maxQty)
    return {
      slug: res.slug,
      template: OUT.items[res.slug],
      job: res.job,
      tier: res.tier,
      pack_min: pack.min,
      pack_max: pack.max,
    }
  })
  OUT.world.mobGroups = W.mobGroups.map((grp) => OUT.mobs[grp.mob].id)
  OUT.world.dungeonKey = OUT.items[W.dungeonKey]
  OUT.world.dungeonRooms = baseRooms.map(roomIds)
  persist()

  // ── PHASE 10b · S-59 HEALER dungeon room(s) — makes the healer AI (heal a wounded ally) REACHABLE in a dungeon
  //    (today's rooms were Brute×2 / Archer×3, no healer). New label ⇒ a resumed 2-room world still gains it.
  if (healerRooms.length) {
    await exec('world:healer_rooms', (tx) => {
      for (const room of healerRooms)
        tx.moveCall({
          target: `${GAME}::world::add_dungeon_room`,
          arguments: [tx.object(CAP.game), tx.object(WORLD), tx.pure.vector('id', roomIds(room)), tx.object(VER.game)],
        })
      return () => {}
    })
    OUT.world.dungeonRooms = [...OUT.world.dungeonRooms, ...healerRooms.map(roomIds)]
    persist()
  }

  // ── Summary ──
  console.log(`\n=== SEED COMPLETE ===`)
  console.log(
    `items:${Object.keys(OUT.items).length} spells:${Object.keys(OUT.spells).length} mobs:${Object.keys(OUT.mobs).length} recipes:${OUT.recipes.length} world:1`
  )
  console.log(`gas: ${OUT.gas.totalSui.toFixed(4)} SUI (${gasMist} MIST)`)
  console.log(`manifest → ${OUT_PATH}`)
}

main().catch((e) => {
  persist()
  console.error(`\nSEED STOPPED: ${e.message}`)
  console.error(`partial manifest persisted → ${OUT_PATH} (digests: ${Object.keys(OUT.digests).length})`)
  process.exit(1)
})
