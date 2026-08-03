// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One-shot QA: create the CrushBoard + register the 2 seeded runes (disposable testnet).
import fs from 'node:fs'

import { Transaction } from '@mysten/sui/transactions'

import { keypair, sui_client } from '../client.js'
import { run } from '../ceremony_lib.mjs'
const M = JSON.parse(fs.readFileSync(new URL('../out/ceremony_manifest.json', import.meta.url), 'utf8'))
const S = JSON.parse(fs.readFileSync(new URL('../out/seed_manifest.json', import.meta.url), 'utf8'))
// fresh publish: no upgrade yet ⇒ manifest has no `.latest` (stamp_all applies the same origin fallback).
// 2026-07-12 split: forgemagie is its OWN package — doors live there; the AdminCap/Version
// stay core's; the brand pin (`set_forge_brand<Forge>`) targets CORE's config with the SIBLING's witness type.
const L = M.forgemagie.latest ?? M.forgemagie.pkg,
  CORE = M.aresrpg.latest ?? M.aresrpg.pkg,
  CAP = M.aresrpg.admin,
  VER = M.aresrpg.version
let board = S.crushBoard
if (!board) {
  const tx = new Transaction()
  // PIN THE BRAND first (idempotent admin dial): core's brand doors open ONLY for the sibling's witness.
  tx.moveCall({
    target: `${CORE}::config::set_forge_brand`,
    typeArguments: [`${L}::forgemagie::Forge`],
    arguments: [tx.object(CAP), tx.object(M.aresrpg.shared.GameConfig), tx.object(VER)],
  })
  tx.moveCall({ target: `${L}::forgemagie::create_board`, arguments: [tx.object(CAP), tx.object(VER)] })
  const r = await run(sui_client, keypair, 'forgemagie:create_board', tx, { ceilingSui: 0.05 })
  const created = (r.objectChanges || []).find(
    (c) => c.type === 'created' && c.objectType.endsWith('::forgemagie::CrushBoard')
  )
  board = created?.objectId
  const board_version = created?.owner?.Shared ? String(created.owner.Shared.initial_shared_version) : undefined
  S.crushBoard = board
  S.crushBoardVersion = board_version
  fs.writeFileSync(new URL('../out/seed_manifest.json', import.meta.url), JSON.stringify(S, null, 2))
  console.log('board initial_shared_version =', board_version)
}
console.log('board =', board)
const tx2 = new Transaction()
// stat codes per item_stats FIELDS: strength=2, earth_resistance=13; tier 1 = Ba (FORGE_TIERS.BA)
tx2.moveCall({
  target: `${L}::forgemagie::register_rune`,
  arguments: [
    tx2.object(CAP),
    tx2.object(board),
    tx2.pure.id(S.items.rune_might),
    tx2.pure.u8(2),
    tx2.pure.u8(1),
    tx2.object(VER),
  ],
})
tx2.moveCall({
  target: `${L}::forgemagie::register_rune`,
  arguments: [
    tx2.object(CAP),
    tx2.object(board),
    tx2.pure.id(S.items.rune_guard),
    tx2.pure.u8(13),
    tx2.pure.u8(1),
    tx2.object(VER),
  ],
})
await run(sui_client, keypair, 'forgemagie:register_runes', tx2, { ceilingSui: 0.05 })
S.crushBoard = board
fs.writeFileSync(new URL('../out/seed_manifest.json', import.meta.url), JSON.stringify(S, null, 2))
console.log('QA runes registered')
