#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// check_keepset.mjs — S-46 train-checklist gate (advisor rider 8): re-grep every PTB target string consumed by
// the SDK builders + the move scripts against the MERGED package surface, and fail if any target's function is
// missing or no longer public/entry. Pure static check — zero chain calls.
//
//   node scripts/check_keepset.mjs        # exit 0 = every consumed target exists + is PTB-callable
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const MOVE = path.resolve(__dir, '..')
const SDK = path.resolve(MOVE, '..', 'sdk', 'src')
const SRC = path.join(MOVE, 'aresrpg', 'sources')
const FND = path.join(MOVE, 'foundation', 'sources')
const ENG = path.join(MOVE, 'engine', 'sources')
const SPL = path.join(MOVE, 'spells', 'sources')
const SOC = path.join(MOVE, 'social', 'sources')
// S-46 split: forgemagie + kolizeum are now their OWN packages (the SDK targets `forgemagie::*` / `kolizeum::*`);
// their sources join the provided surface so those PTB targets resolve here instead of reading as missing.
const FORGE = path.join(MOVE, 'forgemagie', 'sources')
const KOLI = path.join(MOVE, 'kolizeum', 'sources')
// Set-D split (2026-07-13): gifting (gift/airdrop/loot_box/consume/pool/creation) + dungeon
// (dungeon/run/dungeon_events) are their own packages — same surface-join as forgemagie/kolizeum.
const GIFT = path.join(MOVE, 'gifting', 'sources')
const DUNG = path.join(MOVE, 'dungeon', 'sources')

// Legacy-monolith modules the SDK still targets (S-18 retargets them) — not this merge's surface.
const LEGACY_MODULES = new Set([
  'api',
  'auth',
  'header',
  'staking',
  'template_sale',
  'character_health',
  'character_inventory',
  'character_spells',
  'character_stats',
  'character_jobs',
  'dungeon_claim',
  'dungeon_turn',
  'dungeon_cast',
  'dungeon_grid',
  'dungeon_mob',
  'dungeon_registry',
  'dungeon_template',
  'spell_registry',
  'emission',
  'derived',
  'combat_gear',
  'item_api',
  'item_sale',
  'item_feed',
  'consumable',
  'template',
])
// Legacy-monolith target strings whose MODULE NAMES collide with merged modules (the SDK drives the OLD
// monolith package at a different address for these — S-18 retargets them; they are NOT this merge's surface).
const LEGACY_FNS = new Set([
  'admin::issue_mint_cap',
  'creation::create_character',
  'version::admin_freeze',
  'version::admin_update',
  'world::add_admin',
  'protected_policy::mint_and_share_aresrpg_policy',
  // dungeon::{create,burn}_dungeon_registered were REMOVED by the S-46 split (API is now
  // activate→next_fight→settle_run); no consumer targets them, dropped here with the pre-mainnet republish purge.
  'dungeon::join_dungeon',
  'dungeon::join_dungeon_with_key',
  'dungeon::whitelist_add',
  // S-46 final split: settlement moved engine-side under a new module name — the SDK's results::settle target
  // is S-18's retarget (settlement::settle_and_destroy is the provided surface).
  'results::settle_and_destroy',
])

// Framework / external modules (kiosk rules, sui, std). `dynamic_field` joined 2026-07-13: the cast.move
// engine payload's new SeatTurnKey/CastKey/TargetKey DF usage is internal Move (never itself a PTB target),
// but ceremony_lib.mjs's idempotence-guard doc-comments now CITE `0x2::dynamic_field::add`'s abort code
// (EFieldAlreadyExists) in prose — the blind text grep below can't tell a doc-comment from a real consumed
// target, and this IS a real Sui framework module (never ours to provide), so it joins EXTERNAL wholesale.
const EXTERNAL = new Set([
  'kiosk',
  'personal_kiosk',
  'transfer',
  'option',
  'kiosk_lock_rule',
  'royalty_rule',
  'personal_kiosk_rule',
  'amount_rule',
  'marketplace_royalty',
  'dynamic_field',
])

// argv array, never a shell string (#2149): `dir` is an absolute path this file derives, and pasted into
// `sh -c` a directory carrying `;` would have run its tail as a second command. The patterns below lose
// the backslash the old double-quoted shell string ate — `grep` now receives the byte-identical ERE.
const grep = (pattern, dir) => {
  try {
    return execFileSync('grep', ['-rhoE', pattern, dir], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// 1) Consumed targets: `::module::fn` strings in SDK builders + move scripts (this file excluded).
const consumed = new Set()
for (const line of [
  ...grep('::[a-z_]+::[a-z_]+`', SDK),
  ...grep('::[a-z_]+::[a-z_]+`', __dir).filter(() => true),
].filter((l) => !l.includes('module::fn'))) {
  // (self-doc line excluded)
  const m = line.match(/::([a-z_]+)::([a-z_]+)`?$/)
  if (!m) continue
  const [, mod, fn] = m
  if (LEGACY_MODULES.has(mod) || EXTERNAL.has(mod) || LEGACY_FNS.has(`${mod}::${fn}`)) continue
  consumed.add(`${mod}::${fn}`)
}

// 2) Provided surface: public/entry (NOT public(package)) fun declarations in the merged + foundation sources.
const provided = new Set()
for (const dir of [SRC, FND, ENG, SPL, SOC, FORGE, KOLI, GIFT, DUNG]) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.move'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const [, mod] = src.match(/^module \w+::(\w+);/m) || []
    if (!mod) continue
    for (const m of src.matchAll(/^(?:public |public entry |entry )fun (\w+)/gm)) provided.add(`${mod}::${m[1]}`)
    for (const m of src.matchAll(/^public\(package\)/gm)) void m // package fns are NOT PTB surface
  }
}

// 3) Verdict.
const missing = [...consumed].filter((t) => !provided.has(t)).sort()
console.log(`keep-set check: ${consumed.size} consumed targets · ${provided.size} public/entry fns provided`)
if (missing.length) {
  console.error('\nMISSING / NON-PUBLIC targets (PTB would fail):')
  for (const t of missing) console.error('  ✗ ' + t)
  process.exit(1)
}
console.log('✓ every consumed target exists and is public/entry in the merged surface')
