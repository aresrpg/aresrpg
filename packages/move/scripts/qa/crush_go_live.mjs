// CRUSH GO-LIVE — full rune-registry seed + real-crush gas measurement (release-blocking).
// Signs with VITE_DEV_KEY (goofy-sphene = AdminCap owner + player). DISPOSABLE testnet op, resumable.
//   env $(grep '^VITE_DEV_KEY=' ../../../.env | sed 's/VITE_DEV_KEY/PRIVATE_KEY/') \
//     NETWORK=testnet SUI_RPC=https://sui-testnet-rpc.publicnode.com \
//     node packages/move/scripts/qa/crush_go_live.mjs <registry|gear|crush|verify>
//
// MONEY LAW: dry-runnable txs go through ceremony_lib `run` (dryRun ×1.5 budget, ceiling, NO retry of an executed
// failure). The two &Random txs (buy, crush) are UN-simulatable → explicit budget, executed ONCE, no auto-retry;
// an executed crush failure STOPS the run (failure-latch). Crush budget ≤ 0.1 SUI ceiling.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transaction } from '@mysten/sui/transactions'
import { KioskClient } from '@mysten/kiosk'
import { keypair, sui_client } from '../client.js'
import { run } from '../ceremony_lib.mjs'
import { buy_ptb } from '../../../sdk/src/sui/write/items_shop.js'
import { create_character_paid_ptb } from '../../../sdk/src/sui/write/items_creation.js'
import { crush_ptb } from '../../../sdk/src/game.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dir, '..', 'out')
const M = JSON.parse(fs.readFileSync(path.join(OUT, 'ceremony_manifest.json'), 'utf8'))
const S = JSON.parse(fs.readFileSync(path.join(OUT, 'seed_manifest.json'), 'utf8'))
const STATE_PATH = path.join(OUT, 'crush_registry.json')

const L = M.forgemagie?.pkg ?? M.aresrpg.pkg // 07-12 split: forgemagie doors live in the sibling package
const CAP = M.aresrpg.admin
const VER = M.aresrpg.version
const CATALOG = M.aresrpg.shared.Catalog
const CREATION = M.aresrpg.shared.Creation
const BOARD = S.crushBoard
const ADDR = keypair.getPublicKey().toSuiAddress()
const network = 'testnet'
const CEIL_CRUSH_MIST = 100_000_000 // 0.1 SUI hard ceiling (task law)
const CRUSH_BUDGET_MIST = 99_000_000 // measurement run: high cap (≤ ceiling); pay only what's used

// ── the 35-rune catalog truth (rune_catalog.move has_rune): 10 multi-tier stats × 3 + 5 single-tier majors ──
const MULTI = [0, 1, 2, 3, 4, 5, 13, 14, 15, 16]
const SINGLE = [6, 7, 8, 10, 11]
const RUNES = []
for (const s of MULTI) for (const t of [1, 2, 3]) RUNES.push([s, t])
for (const s of SINGLE) RUNES.push([s, 1]) // 30 + 5 = 35
const STAT_NAME = ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility', 'range', 'movement', 'action', 'critical', 'raw_damage', 'critical_chance', 'critical_outcomes', 'earth_resistance', 'fire_resistance', 'water_resistance', 'air_resistance']
const TIER_NAME = { 1: 'Ba', 2: 'Pa', 3: 'Ra' }
const key = (s, t) => `${s}:${t}`

// ── state (resumable) ──
const ST = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {}
ST.runeTemplates ??= { '2:1': S.items.rune_might, '13:1': S.items.rune_guard } // the 2 pre-seeded runes
ST.mintDigests ??= {}
ST.registerDigests ??= {}
ST.registered ??= { '2:1': true, '13:1': true } // already on-chain (board_bootstrap)
ST.gear ??= {}
ST.crush ??= {}
const persist = () => fs.writeFileSync(STATE_PATH, JSON.stringify(ST, null, 2))

const createdId = (r, suffix) => (r.objectChanges || []).find(c => c.type === 'created' && (c.objectType || '').endsWith(suffix))?.objectId
const createdIdIncl = (r, needle) => (r.objectChanges || []).find(c => c.type === 'created' && (c.objectType || '').includes(needle))?.objectId

// ════════════════════════════ PHASE: registry (mint 33 templates + register 35) ════════════════════════════
async function phase_registry() {
  console.log(`\n=== REGISTRY · ${RUNES.length} runes · signer=${ADDR.slice(0, 12)}… ===`)
  // P1 — mint every missing rune ItemTemplate (category "rune": stackable, no stats). One per tx (id capture).
  for (const [s, t] of RUNES) {
    const k = key(s, t)
    if (ST.runeTemplates[k]) continue
    const name = `Rune ${STAT_NAME[s]} ${TIER_NAME[t]}`
    const r = await run(sui_client, keypair, `mint_rune:${k}`, (() => {
      const tx = new Transaction()
      const none_stats = tx.moveCall({ target: '0x1::option::none', typeArguments: [`${L}::item_stats::ItemStatistics`] })
      const none_stats2 = tx.moveCall({ target: '0x1::option::none', typeArguments: [`${L}::item_stats::ItemStatistics`] })
      const none_eff = tx.moveCall({ target: '0x1::option::none', typeArguments: [`${L}::consumable_effect::ConsumableEffect`] })
      const dmg = tx.makeMoveVec({ type: `${L}::item_damages::ItemDamages`, elements: [] })
      tx.moveCall({
        target: `${L}::admin::create_template`,
        arguments: [tx.object(CAP), tx.object(CATALOG), tx.pure.string(name), tx.pure.string(`rune_${STAT_NAME[s]}_${TIER_NAME[t]}`), tx.pure.string('rune'), tx.pure.u16(1), none_stats, none_stats2, dmg, none_eff, tx.object(VER)],
      })
      return tx
    })(), { ceilingSui: 0.05 })
    const id = createdId(r, '::item::ItemTemplate')
    if (!id) throw new Error(`mint_rune ${k}: no ItemTemplate created in ${r.digest}`)
    ST.runeTemplates[k] = id
    ST.mintDigests[k] = r.digest
    persist()
    console.log(`  minted ${k} (${name}) = ${id.slice(0, 12)}…`)
  }

  // P2 — register every rune not yet on-chain (batch 8/tx; register_rune asserts cat::has_rune). Skip the 2 pre-seeded.
  const todo = RUNES.filter(([s, t]) => !ST.registered[key(s, t)])
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8)
    const label = `register:${batch.map(([s, t]) => key(s, t)).join(',')}`
    const r = await run(sui_client, keypair, label, (() => {
      const tx = new Transaction()
      for (const [s, t] of batch)
        tx.moveCall({ target: `${L}::forgemagie::register_rune`, arguments: [tx.object(CAP), tx.object(BOARD), tx.pure.id(ST.runeTemplates[key(s, t)]), tx.pure.u8(s), tx.pure.u8(t), tx.object(VER)] })
      return tx
    })(), { ceilingSui: 0.05 })
    for (const [s, t] of batch) { ST.registered[key(s, t)] = true; ST.registerDigests[key(s, t)] = r.digest }
    persist()
    console.log(`  registered ${batch.length}: ${batch.map(([s, t]) => key(s, t)).join(',')}`)
  }
  console.log(`\nregistry done — ${Object.keys(ST.runeTemplates).length} templates, ${Object.values(ST.registered).filter(Boolean).length} registered`)
}

// ════════════════════════════ PHASE: gear (fresh char+kiosk + throwaway L20 gear item) ════════════════════════════
const SHIFT = 32768
const FIELDS = ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility', 'range', 'movement', 'action', 'critical', 'raw_damage', 'critical_chance', 'critical_outcomes', 'earth_resistance', 'fire_resistance', 'water_resistance', 'air_resistance']
// REPRESENTATIVE-HEAVY L20 block (raw deltas onto SHIFT): 7 runeable lines at LOW values (each yields ~1 unit ⇒
// ~1 stack). Measured cost model (fit to real runs): peak ≈ 12.5M + 6.8M × stacks — so 7 stacks ≈ 60M peak,
// ×1.5 ≈ 90M budget covers ~11 stacks = realistic L120+ endgame gear (vit/wis/4 resistances/primaries). Kept
// under the 0.1 SUI ceiling; rich/low-level gear (values high enough to spread each line across Ba/Pa/Ra tiers →
// up to 35 stacks) exceeds any per-item constant and needs an explicit gas_budget_mist override (documented).
const GEAR_STATS = { strength: 20, intelligence: 20, agility: 20, vitality: 70, earth_resistance: 18, fire_resistance: 18 }
const statsBlock = tx => tx.moveCall({ target: `${L}::item_stats::new`, arguments: FIELDS.map(f => tx.pure.u16(SHIFT + (GEAR_STATS[f] || 0))) })

async function phase_gear() {
  console.log(`\n=== GEAR · fresh char + throwaway L20 gear ===`)
  const kc = new KioskClient({ client: sui_client, network, packageIds: { personalKioskRulePackageId: M._rules } })
  const ctx = { network, kiosk_client: kc }

  // 4a — cheap creation price (deterministic; idempotent set)
  if (!ST.gear.setPriceDigest) {
    const r = await run(sui_client, keypair, 'set_create_price', (() => {
      const tx = new Transaction(); tx.moveCall({ target: `${L}::creation::set_price`, arguments: [tx.object(CAP), tx.object(CREATION), tx.pure.u64(10_000_000n), tx.object(VER)] }); return tx
    })(), { ceilingSui: 0.05 })
    ST.gear.setPriceDigest = r.digest; persist()
  }

  // 4b — fresh paid character (guaranteed UNMARKED → no EDirty) + its own personal kiosk
  if (!ST.gear.character) {
    const c_tx = create_character_paid_ptb(ctx)({ name: `crush${Date.now() % 100000}`, class: S.class || 'senshi', male: true, price_mist: 10_000_000 })
    const cr = await run(sui_client, keypair, 'create_char', c_tx, { ceilingSui: 0.3 })
    ST.gear.character = createdIdIncl(cr, '::character::Character')
    ST.gear.kiosk = createdIdIncl(cr, '0x2::kiosk::Kiosk')
    ST.gear.pkcap = (cr.objectChanges || []).find(c => c.type === 'created' && (c.objectType || '').includes('::personal_kiosk::PersonalKioskCap') && c.owner?.AddressOwner === ADDR)?.objectId
    ST.gear.createCharDigest = cr.digest; persist()
    console.log(`  character=${ST.gear.character?.slice(0, 12)}… kiosk=${ST.gear.kiosk?.slice(0, 12)}… pkcap=${ST.gear.pkcap?.slice(0, 12)}…`)
    if (!ST.gear.character || !ST.gear.kiosk || !ST.gear.pkcap) throw new Error(`create_char: missing ids in ${cr.digest}`)
  }

  // 4c — throwaway gear template (category "sword", L20, min==max deterministic broad block)
  if (!ST.gear.template) {
    const r = await run(sui_client, keypair, 'gear_template', (() => {
      const tx = new Transaction()
      const smin = tx.moveCall({ target: '0x1::option::some', typeArguments: [`${L}::item_stats::ItemStatistics`], arguments: [statsBlock(tx)] })
      const smax = tx.moveCall({ target: '0x1::option::some', typeArguments: [`${L}::item_stats::ItemStatistics`], arguments: [statsBlock(tx)] })
      const none_eff = tx.moveCall({ target: '0x1::option::none', typeArguments: [`${L}::consumable_effect::ConsumableEffect`] })
      const dmg = tx.makeMoveVec({ type: `${L}::item_damages::ItemDamages`, elements: [] })
      tx.moveCall({ target: `${L}::admin::create_template`, arguments: [tx.object(CAP), tx.object(CATALOG), tx.pure.string('Crush Test Blade'), tx.pure.string('sword'), tx.pure.string('sword'), tx.pure.u16(20), smin, smax, dmg, none_eff, tx.object(VER)] })
      return tx
    })(), { ceilingSui: 0.05 })
    ST.gear.template = createdId(r, '::item::ItemTemplate'); ST.gear.templateDigest = r.digest; persist()
    console.log(`  gear template = ${ST.gear.template?.slice(0, 12)}…`)
  }

  // 4d — sale for the gear (token price)
  if (!ST.gear.sale) {
    const r = await run(sui_client, keypair, 'gear_sale', (() => {
      const tx = new Transaction()
      const none_supply = tx.moveCall({ target: '0x1::option::none', typeArguments: ['u64'] })
      tx.moveCall({ target: `${L}::shop::create_sale`, arguments: [tx.object(CAP), tx.pure.id(ST.gear.template), tx.pure.u64(1_000n), none_supply, tx.object(VER)] })
      return tx
    })(), { ceilingSui: 0.05 })
    ST.gear.sale = createdIdIncl(r, '::shop::Sale'); ST.gear.saleDigest = r.digest; persist()
    console.log(`  sale = ${ST.gear.sale?.slice(0, 12)}…`)
  }

  // 4e — BUY 1 gear into the fresh kiosk (&Random, explicit budget via buy builder). Executed once.
  if (!ST.gear.item) {
    const b_tx = buy_ptb({ network })({ sale_id: ST.gear.sale, template_id: ST.gear.template, price_mist: 1_000, kiosk_id: ST.gear.kiosk, personal_kiosk_cap_id: ST.gear.pkcap })
    b_tx.setSenderIfNotSet(ADDR)
    const br = await sui_client.signAndExecuteTransaction({ signer: keypair, transaction: b_tx, options: { showEffects: true, showObjectChanges: true } })
    await sui_client.waitForTransaction({ digest: br.digest })
    if (br.effects?.status?.status !== 'success') throw new Error(`buy FAILED (executed, NOT retrying): ${JSON.stringify(br.effects?.status)} digest=${br.digest}`)
    ST.gear.item = createdId(br, '::item::Item'); ST.gear.buyDigest = br.digest; persist()
    console.log(`  bought gear item = ${ST.gear.item?.slice(0, 12)}… digest=${br.digest}`)
    if (!ST.gear.item) throw new Error(`buy: no ::item::Item created in ${br.digest}`)
  }
  console.log(`\ngear ready — item ${ST.gear.item} in kiosk ${ST.gear.kiosk}`)
}

// ════════════════════════════ PHASE: crush (ONE real crush → measure peak) ════════════════════════════
async function phase_crush() {
  console.log(`\n=== CRUSH · measure gas (budget ${CRUSH_BUDGET_MIST / 1e6}M ≤ ceiling ${CEIL_CRUSH_MIST / 1e6}M) ===`)
  if (ST.crush.digest) { console.log(`  already crushed: ${ST.crush.digest} peak=${ST.crush.peakMist}`); return }
  if (!ST.gear.item) throw new Error('no gear item — run `gear` first')
  const rune_template_ids = RUNES.map(([s, t]) => ST.runeTemplates[key(s, t)])
  if (rune_template_ids.length !== 35 || rune_template_ids.some(x => !x)) throw new Error(`need 35 rune templates, have ${rune_template_ids.filter(Boolean).length}`)

  const build_crush = budget => {
    const tx = crush_ptb({ network })({
      crush_board_id: BOARD, kiosk_id: ST.gear.kiosk, personal_kiosk_cap_id: ST.gear.pkcap,
      character_id: ST.gear.character, gear_template_id: ST.gear.template, gear_item_ids: [ST.gear.item],
      rune_template_ids, filler_template_ids: [], gas_budget_mist: budget,
    })
    tx.setSenderIfNotSet(ADDR)
    return tx
  }

  // FREE pre-flight at a HIGH budget: dry-run runs every gate AND gives a real cost SAMPLE (the &Random yield
  // varies per run, so this is a ballpark, not the truth — that's why we execute). If the sampled peak is already
  // near the ceiling, the gear is too heavy → STOP before spending (no InsufficientGas burn).
  const dbytes = await build_crush(800_000_000).build({ client: sui_client })
  const dr = await sui_client.dryRunTransactionBlock({ transactionBlock: dbytes })
  if (dr.effects?.status?.status !== 'success')
    throw new Error(`crush PRE-FLIGHT dry-run aborted (ZERO gas) — fix before executing: ${JSON.stringify(dr.effects?.status)}`)
  const dg = dr.effects.gasUsed
  const dryPeak = Number(dg.computationCost) + Number(dg.storageCost)
  const dryStacks = (dr.objectChanges || []).filter(c => c.type === 'created' && (c.objectType || '').includes('::item::Item')).length
  console.log(`  pre-flight dry-run: success — sample peak=${dryPeak} (${(dryPeak / 1e9).toFixed(4)} SUI), ${dryStacks} stacks`)
  // Refuse if the SAMPLE derived-budget (dryPeak×1.5) is near/over the 0.1 SUI ceiling: real yield runs ~+1 stack
  // (~+6.8M) over the sample (measured: 7→8 stacks), so keep the sample low enough that real×1.5 stays ≤ ceiling.
  if (dryPeak > 0.56 * CEIL_CRUSH_MIST)
    throw new Error(`crush sample peak ${dryPeak} (×1.5=${Math.ceil(dryPeak * 1.5)}) too near ceiling ${CEIL_CRUSH_MIST} — lighten GEAR_STATS (real yield runs ~1 stack heavier than the sample).`)
  console.log(`  executing for real at ${CRUSH_BUDGET_MIST / 1e6}M cap (≥ ~${(CRUSH_BUDGET_MIST / dryPeak).toFixed(1)}× the sample — absorbs yield variance)`)

  const cr = await sui_client.signAndExecuteTransaction({ signer: keypair, transaction: build_crush(CRUSH_BUDGET_MIST), options: { showEffects: true, showObjectChanges: true, showEvents: true } })
  await sui_client.waitForTransaction({ digest: cr.digest })
  const st = cr.effects?.status?.status
  const g = cr.effects?.gasUsed
  const comp = Number(g.computationCost), storage = Number(g.storageCost), rebate = Number(g.storageRebate)
  const peak = comp + storage, net = comp + storage - rebate
  // Persist BEFORE any throw — the digest is the audit trail (executed = gas burned, NEVER auto-retry).
  ST.crush = { digest: cr.digest, status: st, comp, storage, rebate, netMist: net, peakMist: peak, budgetMist: CRUSH_BUDGET_MIST }
  const runeStacks = (cr.objectChanges || []).filter(c => c.type === 'created' && (c.objectType || '').includes('::item::Item')).map(c => c.objectId)
  ST.crush.runeStackIds = runeStacks
  ST.crush.itemsCrushed = 1
  persist()
  console.log(`  status=${st} digest=${cr.digest}`)
  console.log(`  comp=${comp} storage=${storage} rebate=${rebate} → PEAK(comp+storage)=${peak} net=${net}`)
  console.log(`  rune stacks minted (created ::item::Item): ${runeStacks.length}`)
  if (st !== 'success') throw new Error(`CRUSH FAILED (executed, digest=${cr.digest}) — STOP, do not retry (failure-latch). status=${JSON.stringify(cr.effects?.status)}`)
  const budget15 = Math.ceil(peak * 1.5)
  console.log(`  ⇒ MEASURED_CRUSH_GAS_MIST = ${peak}   (×1.5 per-item budget = ${budget15}, ${(budget15 / 1e9).toFixed(4)} SUI)`)
  if (peak * 1.5 > CEIL_CRUSH_MIST) console.log(`  ⚠ WARNING peak×1.5 (${budget15}) exceeds ceiling ${CEIL_CRUSH_MIST} — reconsider gear before stamping`)
}

// ════════════════════════════ PHASE: verify (kiosk-locked runes + second-crush compose) ════════════════════════════
async function phase_verify() {
  console.log(`\n=== VERIFY ===`)
  // A) minted rune stacks are locked in the fresh kiosk
  const df = await sui_client.getDynamicFields({ parentId: ST.gear.kiosk })
  const items = []
  for (const f of df.data) {
    if ((f.name?.type || '').includes('kiosk::Item')) {
      const oid = f.name?.value?.id || f.objectId
      const o = await sui_client.getObject({ id: oid, options: { showType: true, showContent: true } })
      if ((o.data?.type || '').includes('::item::Item')) items.push({ id: oid, template: o.data?.content?.fields?.template, category: o.data?.content?.fields?.category, amount: o.data?.content?.fields?.amount })
    }
  }
  console.log(`  kiosk ${ST.gear.kiosk.slice(0, 12)}… holds ${items.length} item(s):`)
  const runeSet = new Set(Object.values(ST.runeTemplates))
  let lockedRunes = 0
  for (const it of items) { const isRune = runeSet.has(it.template); if (isRune) lockedRunes++; console.log(`    ${isRune ? 'RUNE' : it.category} template=${(it.template || '').slice(0, 10)}… amount=${it.amount}`) }
  console.log(`  kiosk-locked rune stacks: ${lockedRunes}`)

  // B) a SECOND crush composes with the REAL (stamped) budget — build only, DO NOT execute (no gear to spare)
  try {
    const { MEASURED_CRUSH_GAS_MIST, crush_gas_budget_mist } = await import('../../../sdk/src/game.js')
    if (MEASURED_CRUSH_GAS_MIST == null) { console.log('  second-crush: MEASURED_CRUSH_GAS_MIST still null — stamp game.js first, then re-run verify'); return }
    const budget = crush_gas_budget_mist({ items: 1 })
    const rune_template_ids = RUNES.map(([s, t]) => ST.runeTemplates[key(s, t)])
    const c_tx = crush_ptb({ network })({ crush_board_id: BOARD, kiosk_id: ST.gear.kiosk, personal_kiosk_cap_id: ST.gear.pkcap, character_id: ST.gear.character, gear_template_id: ST.gear.template, gear_item_ids: ['0x' + '0'.repeat(63) + '1'], rune_template_ids, filler_template_ids: [] })
    c_tx.setSenderIfNotSet(ADDR)
    await c_tx.build({ client: sui_client })
    console.log(`  second-crush COMPOSES with real budget = ${budget} MIST (${(budget / 1e9).toFixed(4)} SUI) — build OK, not executed`)
  } catch (e) { console.log(`  second-crush compose error: ${e.message}`) }
}

const phase = process.argv[2]
const run_phase = { registry: phase_registry, gear: phase_gear, crush: phase_crush, verify: phase_verify }[phase]
if (!run_phase) { console.error(`usage: crush_go_live.mjs <registry|gear|crush|verify>`); process.exit(1) }
run_phase().then(() => console.log('\nDONE')).catch(e => { persist(); console.error(`\nSTOPPED: ${e.message}`); process.exit(1) })
