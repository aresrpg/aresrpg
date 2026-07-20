// SEED_TIER1_BOOTSTRAP — S-21 additive QA seed closing the CORRECTED tier-1 tool loop. DISPOSABLE, TESTNET ONLY.
//
// CORRECTION to the original jade_pickaxe plan: jade is a tier-3/level-20 production MINER resource (seed/gathering/
// miner/base_resources.json) — NOT the game's tier-1 bootstrap tool. The real tier-1 tool is "Basic Pickaxe"
// (seed/crafts/gear/generated/items_L01_L20.json id=basic_pickaxe, level 1, HANDYMAN recipe = crude_branch×2 —
// ratified 2026-07-11, see the recipe site). This script mirrors that recipe on the QA/testnet chain.
//
// Adds the full craft-loop proof (no more "materials exist but nothing crafts them"):
//   1. two RESOURCE item templates: "Crude Branch" and "Diamond" (neither existed on-chain — confirmed via
//      /v1/encyclopedia, 2026-07-11)
//   2. a "Basic Pickaxe" item template (category tool_farmer — reuses the existing QA gathering-tool category from
//      the Sickle precedent; level 1, no stats/dmg, HANDYMAN craft output)
//   3. a Recipe object (aresrpg::crafting::create_recipe): crude_branch×2 → Basic Pickaxe×1 (bare-hand bootstrap)
//   4. a "Test Brute" mats-variant mob (loot = Crude Branch @ 80%) + a "Test Archer" mats-variant mob
//      (loot = Diamond @ 80%) — same minimal-mob shape as seed_gather_tool.mjs's tool_brute (new MobTemplate
//      objects; mob_template.move has no loot-mutator, so an existing mob's loot can only be extended by minting
//      a new template + a new world spawn entry, never by editing the original)
//   5. two world mob-entries spawning each SOLO (group 1/1, weight 8000) so a 1v1 fight is easy to find
//
// Math: recipe needs 2 crude_branch, dropped 1-2 per Test Brute kill @80% (matching the existing iron_ore 80%
// precedent rate). One kill often yields 2; two kills give ≥2 with ~0.98 probability — well inside the 2-4-fight
// bar, and with ZERO gather/mining step (the whole point of this correction).
//
// Reuses the ceremony_lib `run()` money choke: EVERY tx is dryRun-derived (budget ×1.5) under a hard 0.1-SUI
// ceiling, and an EXECUTED failure is NEVER retried.
//
// RUN (JSON-RPC on the public fullnode is dead → publicnode):
//   env $(grep VITE_DEV_KEY ../../.env | sed 's/VITE_DEV_KEY/PRIVATE_KEY/') \
//     NETWORK=testnet SUI_RPC=https://sui-testnet-rpc.publicnode.com \
//     node packages/move/scripts/seed_tier1_bootstrap.mjs [--dry]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import { keypair, sui_client } from './client.js'
import { run, deriveBudget, netGas } from './ceremony_lib.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const M = JSON.parse(fs.readFileSync(path.join(__dir, 'out', 'ceremony_manifest.json'), 'utf8'))
const SEED = JSON.parse(fs.readFileSync(path.join(__dir, 'out', 'seed_manifest.json'), 'utf8'))
const OUT_PATH = path.join(__dir, 'out', 'tier1_bootstrap_manifest.json')
const DRY = process.argv.includes('--dry')
const CEIL = 0.1 // task law: refuse any tx whose derived budget exceeds 0.1 SUI

// Live lineage (S-46 merge: items==game==aresrpg; fight==engine)
const ARES = M.items.pkg
const FND = M.foundation.pkg
const FIGHT = M.fight.pkg
const CAP = M.items.admin
const VER = M.items.version
const CATALOG = M.items.shared.Catalog
const WORLD = SEED.world.id
const SHIFT = 32768

const T = { loot: `${FIGHT}::mob::MobLootEntry`, idmg: `${ARES}::item_damages::ItemDamages` }

const ME = keypair.getPublicKey().toSuiAddress()
const OUT = fs.existsSync(OUT_PATH)
  ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
  : {
      _note: 'DISPOSABLE tier-1 bootstrap QA seed — corrected target: Basic Pickaxe, not jade_pickaxe',
      _signer: ME,
      digests: {},
      crude_branch_template: null,
      diamond_template: null,
      pickaxe_template: null,
      recipe: null,
      brute_mats: null,
      archer_mats: null,
    }
const persist = () => fs.writeFileSync(OUT_PATH, JSON.stringify(OUT, null, 2))
const createdId = (r, suffix) => (r.objectChanges || []).find((c) => c.type === 'created' && (c.objectType || '').endsWith(suffix))?.objectId

// ── PTB builders (faithful copies of seed_gather_tool.mjs / seed_testnet.mjs) ────
const optNone = (tx, tag) => tx.moveCall({ target: '0x1::option::none', typeArguments: [tag], arguments: [] })
function elements(tx) {
  const cache = new Map()
  return (name) => { if (!cache.has(name)) cache.set(name, tx.moveCall({ target: `${FND}::spell::${name}` })); return cache.get(name) }
}
const dmgFx = (tx, elHandle, base) => tx.moveCall({ target: `${FND}::spell_effect::damage`, arguments: [elHandle, tx.pure.u64(base)] })
const fxVec = (tx, effects) => tx.makeMoveVec({ type: `${FND}::spell_effect::Effect`, elements: effects })
const spellLevel = (tx, o, fx, crit) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_spell_level`,
    arguments: [
      tx.pure.u16(o.min_cl), tx.pure.u64(o.ap), tx.pure.u64(o.rmin), tx.pure.u64(o.rmax),
      tx.pure.bool(!!o.mod), tx.pure.bool(!!o.line), tx.pure.bool(o.los !== false), tx.pure.bool(!!o.free),
      tx.pure.u8(o.cpt ?? 255), tx.pure.u8(o.cpta ?? 255), tx.pure.u8(o.cd ?? 0), tx.pure.u64(o.crit ?? 0),
      tx.pure.bool(false), tx.pure.vector('u16', []), tx.pure.vector('u16', []),
      fxVec(tx, fx), fxVec(tx, crit),
    ],
  })
const levelVec = (tx, levels) => tx.makeMoveVec({ type: `${FND}::spell_effect::SpellLevel`, elements: levels })
const mobStats = (tx, s) =>
  tx.moveCall({ target: `${FND}::spell::new_stats`, arguments: [s.str, s.int, s.chance, s.agility, s.raw, s.crit, s.range, SHIFT, SHIFT, SHIFT, SHIFT].map((v) => tx.pure.u64(v || 0)) })
const lootEntry = (tx, itemId, chance, min, max) =>
  tx.moveCall({ target: `${FIGHT}::mob::new_loot_entry`, arguments: [tx.pure.id(itemId), tx.pure.u16(chance), tx.pure.u16(min), tx.pure.u16(max)] })
const lootVec = (tx, entries) => tx.makeMoveVec({ type: T.loot, elements: entries })

const itemTemplate = (tx, name, slug, category) => {
  const smin = optNone(tx, `${ARES}::item_stats::ItemStatistics`)
  const smax = optNone(tx, `${ARES}::item_stats::ItemStatistics`)
  const dmg = tx.makeMoveVec({ type: T.idmg, elements: [] })
  const eff = optNone(tx, `${ARES}::consumable_effect::ConsumableEffect`)
  return tx.moveCall({
    target: `${ARES}::admin::create_template`,
    arguments: [tx.object(CAP), tx.object(CATALOG), tx.pure.string(name), tx.pure.string(slug), tx.pure.string(category), tx.pure.u16(1), smin, smax, dmg, eff, tx.object(VER)],
  })
}

// ── one dryRun-guarded exec (skips if the digest is already recorded) ─────────────
async function exec(label, build) {
  if (OUT.digests[label]) { console.log(`  [${label}] SKIP (${OUT.digests[label].slice(0, 8)}…)`); return { skipped: true } }
  const tx = new Transaction()
  const capture = build(tx)
  if (DRY) {
    const budget = await deriveBudget(sui_client, keypair, tx, label, CEIL)
    console.log(`  [${label}] DRY ok — derived budget ${budget} MIST (${(budget / 1e9).toFixed(4)} SUI)`)
    return { dry: true }
  }
  const r = await run(sui_client, keypair, label, tx, { ceilingSui: CEIL })
  OUT.digests[label] = r.digest
  persist()
  return { r, ids: capture ? capture(r) : null }
}

async function main() {
  console.log(`\n=== SEED TIER1 BOOTSTRAP · signer=${ME} · ${DRY ? 'DRY-RUN' : 'EXECUTE'} · world=${WORLD.slice(0, 10)}… ===`)

  // 1) Crude Branch (resource)
  const cRes = await exec('item:crude_branch', (tx) => {
    itemTemplate(tx, 'Crude Branch', 'crude_branch', 'resource')
    return (r) => { OUT.crude_branch_template = createdId(r, '::item::ItemTemplate'); persist() }
  })
  if (cRes?.r && !OUT.crude_branch_template) throw new Error('crude_branch: no ItemTemplate created')
  const CRUDE = OUT.crude_branch_template
  console.log(`  crude_branch_template = ${CRUDE ?? '(dry)'}`)

  // 2) Diamond (resource)
  const dRes = await exec('item:diamond', (tx) => {
    itemTemplate(tx, 'Diamond', 'diamond', 'resource')
    return (r) => { OUT.diamond_template = createdId(r, '::item::ItemTemplate'); persist() }
  })
  if (dRes?.r && !OUT.diamond_template) throw new Error('diamond: no ItemTemplate created')
  const DIAMOND = OUT.diamond_template
  console.log(`  diamond_template = ${DIAMOND ?? '(dry)'}`)

  // 3) Basic Pickaxe (category tool_farmer — reuses the existing QA gathering-tool category)
  const pRes = await exec('item:basic_pickaxe', (tx) => {
    itemTemplate(tx, 'Basic Pickaxe', 'basic_pickaxe', 'tool_farmer')
    return (r) => { OUT.pickaxe_template = createdId(r, '::item::ItemTemplate'); persist() }
  })
  if (pRes?.r && !OUT.pickaxe_template) throw new Error('basic_pickaxe: no ItemTemplate created')
  const PICKAXE = OUT.pickaxe_template
  console.log(`  pickaxe_template = ${PICKAXE ?? '(dry)'}`)

  // 4) Recipe: crude_branch×2 → Basic Pickaxe×1
  //    RULING 2026-07-11: a STARTER tool must be craftable BARE-HANDED. The old crude_branch×1+diamond×1
  //    was an un-bootstrappable deadlock — diamond is a MINER-gathered gem (seed/gathering/miner/base_resources
  //    .json tier-1) and gathering.move:145 hard-requires an equipped MINER tool (ENoTool), i.e. the very pickaxe
  //    this recipe makes. crude_branch drops @80% from Test Brute (mob loot, no tool) — two kills craft the pickaxe
  //    with zero mining. Diamond stays a resource (Test Archer still drops it) but is NO LONGER a recipe input.
  const rRes = await exec('recipe:basic_pickaxe', (tx) => {
    tx.moveCall({
      target: `${ARES}::crafting::create_recipe`,
      arguments: [
        tx.object(CAP), tx.object(VER),
        tx.pure.vector('id', [CRUDE ?? '0x0']),
        tx.pure.vector('u64', [2]),
        tx.pure.id(PICKAXE ?? '0x0'),
        tx.pure.u64(1),
      ],
    })
    return (r) => { OUT.recipe = createdId(r, '::crafting::Recipe'); persist() }
  })
  if (rRes?.r && !OUT.recipe) throw new Error('recipe:basic_pickaxe: no Recipe created')
  console.log(`  recipe = ${OUT.recipe ?? '(dry)'}`)

  // 5) "Test Brute" mats-variant (hp 20, earth, ONE weak spell; loot = Crude Branch @ 80%, qty 1-2)
  const bRes = await exec('mob:brute_mats', (tx) => {
    const el = elements(tx)
    const spells = [spellLevel(tx, { min_cl: 1, ap: 4, rmin: 1, rmax: 1, los: true, crit: 0 }, [dmgFx(tx, el('el_earth'), 6)], [])]
    const loot = lootVec(tx, [lootEntry(tx, CRUDE ?? '0x0', 8000, 1, 2)])
    tx.moveCall({
      target: `${ARES}::mob_template::mint`,
      arguments: [
        tx.object(CAP), tx.object(VER), tx.pure.string('Test Brute'), tx.pure.u16(1), tx.pure.u16(5),
        tx.pure.u64(20), tx.pure.u64(6), tx.pure.u64(3), el('el_earth'), mobStats(tx, { str: 15, agility: 5 }),
        levelVec(tx, spells), loot, tx.pure.u64(50),
      ],
    })
    return (r) => { OUT.brute_mats = createdId(r, '::mob_template::MobTemplate'); persist() }
  })
  if (bRes?.r && !OUT.brute_mats) throw new Error('brute_mats: no MobTemplate created')
  console.log(`  brute_mats = ${OUT.brute_mats ?? '(dry)'}`)

  // 6) world mob-entry: spawn the mats-brute SOLO (group 1/1)
  await exec('world:add_brute_mats', (tx) => {
    tx.moveCall({
      target: `${ARES}::world::add_mob_entry`,
      arguments: [tx.object(CAP), tx.object(WORLD), tx.pure.id(OUT.brute_mats ?? '0x0'), tx.pure.u16(8000), tx.pure.u16(1), tx.pure.u16(1), tx.object(VER)],
    })
  })

  // 7) "Test Archer" mats-variant (hp 20, water, ONE weak spell; loot = Diamond @ 80%, qty 1-2)
  const aRes = await exec('mob:archer_mats', (tx) => {
    const el = elements(tx)
    const spells = [spellLevel(tx, { min_cl: 1, ap: 4, rmin: 1, rmax: 3, los: true, crit: 0 }, [dmgFx(tx, el('el_water'), 5)], [])]
    const loot = lootVec(tx, [lootEntry(tx, DIAMOND ?? '0x0', 8000, 1, 2)])
    tx.moveCall({
      target: `${ARES}::mob_template::mint`,
      arguments: [
        tx.object(CAP), tx.object(VER), tx.pure.string('Test Archer'), tx.pure.u16(1), tx.pure.u16(5),
        tx.pure.u64(20), tx.pure.u64(6), tx.pure.u64(3), el('el_water'), mobStats(tx, { str: 10, agility: 10 }),
        levelVec(tx, spells), loot, tx.pure.u64(50),
      ],
    })
    return (r) => { OUT.archer_mats = createdId(r, '::mob_template::MobTemplate'); persist() }
  })
  if (aRes?.r && !OUT.archer_mats) throw new Error('archer_mats: no MobTemplate created')
  console.log(`  archer_mats = ${OUT.archer_mats ?? '(dry)'}`)

  // 8) world mob-entry: spawn the mats-archer SOLO (group 1/1)
  await exec('world:add_archer_mats', (tx) => {
    tx.moveCall({
      target: `${ARES}::world::add_mob_entry`,
      arguments: [tx.object(CAP), tx.object(WORLD), tx.pure.id(OUT.archer_mats ?? '0x0'), tx.pure.u16(8000), tx.pure.u16(1), tx.pure.u16(1), tx.object(VER)],
    })
  })

  console.log(`\n=== ${DRY ? 'DRY-RUN OK (nothing signed)' : 'SEED COMPLETE'} ===`)
  if (!DRY) console.log(`crude_branch=${CRUDE} diamond=${DIAMOND} pickaxe=${PICKAXE} recipe=${OUT.recipe}\nmanifest → ${OUT_PATH}`)
}

main().catch((e) => { if (!DRY) persist(); console.error(`\nSEED STOPPED: ${e.message}`); process.exit(1) })
