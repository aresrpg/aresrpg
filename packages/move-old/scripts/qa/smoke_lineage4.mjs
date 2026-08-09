// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SMOKE (lineage-4 republish) — DISPOSABLE. Drives the PLAYER doors on the fresh testnet lineage via the REAL
// SDK builders (stamped fresh): admin set cheap price → paid create → join Testlands → search spawn zone →
// gather DRY-RUN against the golden-linked iron_ore. Signs with goofy-sphene (the AdminCap + player wallet).
//   PRIVATE_KEY=<goofy> NETWORK=testnet SUI_RPC=https://sui-testnet-rpc.publicnode.com node qa/smoke_lineage4.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'
import { KioskClient } from '@mysten/kiosk'

import { keypair, sui_client } from '../client.js'
import { run } from '../ceremony_lib.mjs'
import { create_character_paid_ptb, onboard_kiosk_ptb } from '../../../sdk/src/sui/write/items_creation.js'
import { search_zone_ptb, gather_ptb } from '../../../sdk/src/sui/write/game_world.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const M = JSON.parse(fs.readFileSync(path.join(__dir, '..', 'out', 'ceremony_manifest.json'), 'utf8'))
const S = JSON.parse(fs.readFileSync(path.join(__dir, '..', 'out', 'seed_manifest.json'), 'utf8'))
const G = JSON.parse(fs.readFileSync(path.join(__dir, '..', 'out', 'gather_tool_manifest.json'), 'utf8'))

const L = M.aresrpg.pkg // fresh publish: pkg == latest
const VER = M.aresrpg.version
const CAP = M.aresrpg.admin
const CREATION = M.aresrpg.shared.Creation
const CFG = M.aresrpg.shared.GameConfig
const WORLD = S.world.id
const IRON = S.items.iron_ore
const GOLDEN = G.golden_template
const ADDR = keypair.getPublicKey().toSuiAddress()
const network = 'testnet'
// kiosk-rule-linkage law: the personal-kiosk rule MUST be called at the id aresrpg's linkage table binds
// (the ceremony's _rules = the linked kiosk dep), not the @mysten/kiosk SDK's baked default → else InvalidLinkage.
const ctx = {
  network,
  kiosk_client: new KioskClient({ client: sui_client, network, packageIds: { personalKioskRulePackageId: M._rules } }),
}
const created = (r, needle, ownedOnly = false) =>
  (r.objectChanges || []).find(
    (c) =>
      c.type === 'created' && (c.objectType || '').includes(needle) && (!ownedOnly || c.owner?.AddressOwner === ADDR)
  )?.objectId
const evt = (r, suffix, field) => (r.events || []).find((e) => (e.type || '').endsWith(suffix))?.parsedJson?.[field]

async function main() {
  console.log(`\n=== SMOKE lineage-4 · signer=${ADDR.slice(0, 12)}… · world=${WORLD.slice(0, 10)}… ===`)

  // 0) admin: drop the placeholder 10-SUI creation price to a token 0.05 SUI so the paid door is cheap to smoke.
  await run(
    sui_client,
    keypair,
    'admin:set_price',
    (() => {
      const tx = new Transaction()
      tx.moveCall({
        target: `${L}::creation::set_price`,
        arguments: [tx.object(CAP), tx.object(CREATION), tx.pure.u64(50_000_000n), tx.object(VER)],
      })
      return tx
    })(),
    { ceilingSui: 0.2 }
  )

  // 1) Onboard only the reusable personal kiosk, then atomically create + lock + join Testlands.
  const kr = await run(sui_client, keypair, 'player:onboard_kiosk', onboard_kiosk_ptb(ctx)(), { ceilingSui: 0.3 })
  const kiosk_id = created(kr, '0x2::kiosk::Kiosk')
  const personal_kiosk_cap_id = created(kr, '::personal_kiosk::PersonalKioskCap', true)
  if (!kiosk_id || !personal_kiosk_cap_id) throw new Error('onboard: failed to capture kiosk ids')
  const c_tx = create_character_paid_ptb(ctx)({
    name: `SMOKE${Date.now() % 100000}`,
    class: 'senshi',
    male: true,
    price_mist: 50_000_000,
    world_id: WORLD,
    kiosk_id,
    personal_kiosk_cap_id,
  })
  const cr = await run(sui_client, keypair, 'player:create_paid', c_tx, { ceilingSui: 1 })
  const character_id = evt(cr, '::creation::CharacterCreated', 'character') || created(cr, '::character::Character')
  console.log(`  character=${character_id}\n  kiosk=${kiosk_id}\n  pkcap=${personal_kiosk_cap_id}`)
  if (!character_id) throw new Error('create: failed to capture character id')

  // The atomic creation receipt carries WorldJoined and its spawn checkpoint.
  const x = Number(evt(cr, '::zones::WorldJoined', 'x')),
    z = Number(evt(cr, '::zones::WorldJoined', 'z'))
  console.log(`  joined at spawn (x=${x}, z=${z})`)

  // 3) SEARCH the spawn zone (travel-verified distance 0). Prior smoke runs share the world, so this random
  //    spawn may land in an ALREADY-DISCOVERED zone (EZoneFresh anti-spam TTL) — tolerate it and proceed.
  let zx,
    zy,
    nodes = 9,
    groups = 1
  const mk_search = () => {
    const t = search_zone_ptb(ctx)({ world_id: WORLD, kiosk_id, personal_kiosk_cap_id, character_id, x, z })
    t.setSender(ADDR)
    t.setGasBudget(300_000_000n)
    return t
  }
  const sdry = await sui_client.dryRunTransactionBlock({
    transactionBlock: await mk_search().build({ client: sui_client }),
  })
  if (sdry.effects?.status?.status === 'success') {
    const sr = await sui_client.signAndExecuteTransaction({
      signer: keypair,
      transaction: mk_search(),
      options: { showEffects: true, showEvents: true },
    })
    await sui_client.waitForTransaction({ digest: sr.digest })
    zx = Number(evt(sr, '::zones::ZoneSearched', 'zx'))
    zy = Number(evt(sr, '::zones::ZoneSearched', 'zy'))
    nodes = Number(evt(sr, '::zones::ZoneSearched', 'resource_nodes'))
    groups = Number(evt(sr, '::zones::ZoneSearched', 'mob_groups'))
    console.log(`  [player:search_zone] success digest=${sr.digest}`)
    console.log(`  discovered zone (zx=${zx}, zy=${zy}) resource_nodes=${nodes} mob_groups=${groups}`)
  } else {
    const zof = new Transaction()
    zof.moveCall({ target: `${L}::world::zone_of`, arguments: [zof.object(WORLD), zof.pure.u32(x), zof.pure.u32(z)] })
    const zi = await sui_client.devInspectTransactionBlock({ sender: ADDR, transactionBlock: zof })
    zx = Buffer.from(zi.results[0].returnValues[0][0]).readUInt32LE()
    zy = Buffer.from(zi.results[0].returnValues[1][0]).readUInt32LE()
    console.log(
      `  search skipped (${sdry.effects?.status?.error}) — zone (zx=${zx}, zy=${zy}) already discovered; probing its existing nodes/groups`
    )
  }

  // 3b) FIGHT CREATE DRY-RUN: read a real mob spawn (devInspect mob_spawn_id) → claim_mob_group + fight::create
  //     against the tool-brute (rate-8000 solo). Proves the create door composes/resolves on the fresh lineage.
  if (groups > 0) {
    const FIGHT_REG = M.engine.shared.FightRegistry,
      EVER = M.engine.version,
      BRUTE = G.tool_brute
    const insp_tx = new Transaction()
    insp_tx.moveCall({
      target: `${L}::zones_view::mob_spawn_id`,
      arguments: [insp_tx.object(WORLD), insp_tx.pure.u32(zx), insp_tx.pure.u32(zy), insp_tx.pure.u64(0n)],
    })
    const insp = await sui_client.devInspectTransactionBlock({ sender: ADDR, transactionBlock: insp_tx })
    const rv = insp.results?.[0]?.returnValues?.[0]?.[0]
    const spawn_id = rv ? Buffer.from(rv).readBigUInt64LE() : null
    console.log(`  mob spawn_id[0] = ${spawn_id}`)
    const f_tx = new Transaction()
    const ticket = f_tx.moveCall({
      target: `${L}::zones::claim_mob_group`,
      arguments: [
        f_tx.object(WORLD),
        f_tx.object(kiosk_id),
        f_tx.object(personal_kiosk_cap_id),
        f_tx.pure.id(character_id),
        f_tx.pure.u64(spawn_id),
        f_tx.object(CFG),
        f_tx.object(VER),
        f_tx.object.clock(),
      ],
    })
    f_tx.moveCall({
      target: `${L}::fight::create`,
      arguments: [
        f_tx.object(FIGHT_REG),
        ticket,
        f_tx.object(WORLD),
        f_tx.object(kiosk_id),
        f_tx.object(personal_kiosk_cap_id),
        f_tx.object(BRUTE),
        f_tx.pure.bool(true),
        f_tx.moveCall({ target: '0x1::option::none', typeArguments: ['0x2::object::ID'] }),
        f_tx.makeMoveVec({ type: '0x2::object::ID', elements: [] }),
        f_tx.object(CFG),
        f_tx.object(VER),
        f_tx.object(EVER),
        f_tx.object.clock(),
      ],
    })
    f_tx.setSender(ADDR)
    f_tx.setGasBudget(300_000_000n)
    const fdr = await sui_client.dryRunTransactionBlock({ transactionBlock: await f_tx.build({ client: sui_client }) })
    const fst = fdr.effects?.status
    console.log(
      `  fight create dry-run (brute ${BRUTE.slice(0, 10)}…): ${fst?.status}${fst?.error ? ' — ' + fst.error : ''}`
    )
  }

  // 4) GATHER DRY-RUN: compose the 14-param gather (rare_template = Golden Iron Ore) against the discovered zone.
  //    Proves the builder + fresh signature + golden-link path compose & REACH gather logic (no arity/type abort).
  //    No tool equipped ⇒ the deepest reachable gate is ENoTool — a gather-logic refusal, exactly the proof bar.
  console.log(`  gather dry-run over ${nodes} node(s) (rare_template=golden ${GOLDEN.slice(0, 10)}…):`)
  for (let node_index = 0; node_index < Math.max(1, nodes); node_index++) {
    const g_tx = gather_ptb(ctx)({
      world_id: WORLD,
      kiosk_id,
      personal_kiosk_cap_id,
      character_id,
      zx,
      zy,
      node_index,
      template_id: IRON,
      rare_template_id: GOLDEN,
    })
    g_tx.setSenderIfNotSet(ADDR)
    g_tx.setGasBudget(300_000_000n) // explicit: gather is a compute-heavy &Random mint; avoid auto-budget under-estimation
    const bytes = await g_tx.build({ client: sui_client })
    const dr = await sui_client.dryRunTransactionBlock({ transactionBlock: bytes })
    const st = dr.effects?.status
    console.log(`    node ${node_index}: ${st?.status}${st?.error ? ' — ' + st.error : ''}`)
  }

  console.log(`\n=== SMOKE COMPLETE ===`)
}
main().catch((e) => {
  console.error(`\nSMOKE STOPPED: ${e.message}`)
  process.exit(1)
})
