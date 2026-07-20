// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression coverage for the CEREMONY-BLOCKER fixed 2026-07-12 in seed_full_corpus.mjs PHASE 6 (world author):
// the resource-entry `protector` (a Move `Option<ID>`) was threaded as the whole MINTED mob OBJECT
// (`OUT.mobs[key]` = { id, name, role }) instead of its id STRING. `tx.pure.option('id', <object>)` serializes via
// @mysten/sui's Address bcs type, whose `validate` hook does `toHex(val)` when val isn't a string → `val.reduce(...)`
// → "bytes.reduce is not a function", killing the full-corpus seed right after `[world:01_first_shore:create]`.
//
// 2026-07-13 COMPATIBLE-upgrade restore: the protector no longer rides `add_resource_entry` (the 10th param was a
// param-add on a LIVE public fn — a publish-time compat reject, like the `ResourceEntry.protector_template` field
// it fed). The pin now lands through the `set_resource_protector` DF door (ProtectorKey → ID on the World UID);
// `add_resource_entry` is back to its frozen 9-arg shape. The Option-threading regression moves with the option arg.
//
// Pure — no chain, no seeder import (seed_full_corpus.mjs has import-time side effects: client.js/keypair + manifest).
// Mirrors seed_economy.test.js: builds a REAL @mysten/sui Transaction and replicates the EXACT compose against
// faithful mock OUT shapes, proving the object shape throws and the id-string shape composes.

import { describe, test, expect } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** A well-formed 32-byte object id from an arbitrary tag (mirrors the SDK fixtures' `id`; same helper as seed_economy.test.js). */
const oid = tag => `0x${Buffer.from(String(tag)).toString('hex').padEnd(64, '0').slice(0, 64)}`
const bp = rate => Math.min(10000, Math.max(0, Math.round((rate ?? 0) * 10000))) // mirrors seed_full_corpus bp()

// Faithful mock of the accumulating manifest shapes at PHASE 6 (worlds author AFTER PHASE 2 items + PHASE 5 mobs):
//   OUT.items[slug] = <id string>   (seed_full_corpus.mjs:234)
//   OUT.mobs[key]   = { id, name, role }   (seed_full_corpus.mjs:305)  ← the object that must NOT reach pure.option('id')
const OUT = {
  items: { wheat: oid('item:wheat') },
  mobs: { protector_wheat: { id: oid('mob:protector_wheat'), name: 'Wheat Protector', role: 'protector' } },
  skipped: [],
}
const CAP = { game: oid('cap:game') }
const VER = { game: oid('ver:game') }
const WID = oid('world:01_first_shore')
const GAME = oid('pkg:game')

// The EXACT PHASE-6 compose from seed_full_corpus.mjs (post-restore): the frozen 9-arg add_resource_entry, then —
// only when the protector resolves Some — the set_resource_protector DF door carrying the Option<ID>. Parameterized
// on the protector value so the test drives both the crashing (object) and fixed (id string / null) shapes
// through the REAL SDK path.
const compose_resource_entry = (protectorValue) => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${GAME}::world::add_resource_entry`,
    arguments: [
      tx.object(CAP.game), tx.object(WID), tx.pure.id(OUT.items.wheat),
      tx.pure.u16(bp(0.5)), tx.pure.u16(1), tx.pure.u16(1), tx.pure.u8(2), tx.pure.u8(1),
      tx.object(VER.game),
    ],
  })
  if (protectorValue !== null)
    tx.moveCall({
      target: `${GAME}::world::set_resource_protector`,
      arguments: [
        tx.object(CAP.game), tx.object(WID), tx.pure.id(OUT.items.wheat),
        tx.pure.option('id', protectorValue), tx.object(VER.game),
      ],
    })
  return tx
}

describe('PHASE 6 world author — protector Option<ID> threading via the ProtectorKey DF door (ceremony-blocker regression)', () => {
  test('THE BUG: threading the mob OBJECT into pure.option(\'id\') throws "bytes.reduce is not a function"', () => {
    // Exactly what the pre-fix seeder did: `OUT.mobs[res.protector]` (the { id, name, role } object) — the crash
    // shape is identical on the DF door's option arg.
    expect(() => compose_resource_entry(OUT.mobs.protector_wheat)).toThrow(/reduce is not a function/)
  })

  test('THE FIX: the id STRING composes a frozen 9-arg add_resource_entry + a 5-arg set_resource_protector (Some)', () => {
    const protector = OUT.mobs.protector_wheat?.id ?? null // the fixed resolution
    expect(typeof protector).toBe('string')
    const tx = compose_resource_entry(protector) // must NOT throw
    const calls = tx.getData().commands.filter(c => c.$kind === 'MoveCall')
    expect(calls.map(c => c.MoveCall.function)).toEqual(['add_resource_entry', 'set_resource_protector'])
    expect(calls[0].MoveCall.arguments.length).toBe(9) // the FROZEN live signature — a 10th arg is the compat reject
    expect(calls[1].MoveCall.arguments.length).toBe(5)
  })

  test('absent protector → NO setter call at all (fresh worlds carry no stale pins; unset = no DF)', () => {
    const tx = compose_resource_entry(null) // must NOT throw
    const calls = tx.getData().commands.filter(c => c.$kind === 'MoveCall')
    expect(calls.map(c => c.MoveCall.function)).toEqual(['add_resource_entry'])
    expect(calls[0].MoveCall.arguments.length).toBe(9)
  })
})

describe('protector resolution + honesty (never a silent drop of an authored dial)', () => {
  // Mirrors the fixed source: `protector = OUT.mobs[res.protector]?.id ?? null` + count an authored-but-unminted one.
  const resolve = (mobs, skipped, wid, res) => {
    let protector = null
    if (res.protector) {
      protector = mobs[res.protector]?.id ?? null
      if (!protector) skipped.push({ kind: 'protector', slug: `${wid}/${res.slug}`, why: `unminted protector mob '${res.protector}'` })
    }
    return protector
  }

  test('an authored protector that MINTED resolves to its id string (Some)', () => {
    const skipped = []
    expect(resolve(OUT.mobs, skipped, '01_first_shore', { slug: 'wheat', protector: 'protector_wheat' }))
      .toBe(OUT.mobs.protector_wheat.id)
    expect(skipped.length).toBe(0)
  })

  test('an UNSET protector is a legit None — not counted as a skip', () => {
    const skipped = []
    expect(resolve(OUT.mobs, skipped, '01_first_shore', { slug: 'water' })).toBeNull()
    expect(skipped.length).toBe(0)
  })

  test('an authored-but-UNMINTED protector is dialed None AND counted (loud, never silent)', () => {
    const skipped = []
    expect(resolve(OUT.mobs, skipped, '01_first_shore', { slug: 'diamond', protector: 'protector_phantom' })).toBeNull()
    expect(skipped).toEqual([{ kind: 'protector', slug: '01_first_shore/diamond', why: "unminted protector mob 'protector_phantom'" }])
  })
})

describe('PHASE 6 world author — distance-difficulty MobLevelKey projection', () => {
  const compose_mob_entry = (mob) => {
    const tx = new Transaction()
    tx.moveCall({
      target: `${GAME}::world::add_mob_entry`,
      arguments: [
        tx.object(CAP.game),
        tx.object(WID),
        tx.pure.id(OUT.mobs.protector_wheat.id),
        tx.pure.u16(bp(0.8)),
        tx.pure.u16(2),
        tx.pure.u16(3),
        tx.object(VER.game),
      ],
    })
    tx.moveCall({
      target: `${GAME}::world::set_mob_level`,
      arguments: [
        tx.object(CAP.game),
        tx.object(WID),
        tx.pure.id(OUT.mobs.protector_wheat.id),
        tx.pure.u16(mob.maxLevel ?? mob.minLevel ?? 1),
        tx.object(VER.game),
      ],
    })
    return tx
  }

  test('every roster row authors its weighted entry and maxLevel eligibility in the same PTB', () => {
    const tx = compose_mob_entry({ minLevel: 6, maxLevel: 12 })
    const calls = tx.getData().commands.filter(c => c.$kind === 'MoveCall')
    expect(calls.map(c => c.MoveCall.function)).toEqual([
      'add_mob_entry',
      'set_mob_level',
    ])
    expect(calls.map(c => c.MoveCall.arguments.length)).toEqual([7, 5])
  })

  test('a point-band mob projects its authored level without inventing a curve value', () => {
    expect(() => compose_mob_entry({ minLevel: 3, maxLevel: 3 })).not.toThrow()
  })
})

// Regression coverage for the STALE-MANIFEST fix (critical-path seeder optimization, 2026-07-12):
// seed_full_corpus resumed against a DEAD lineage's persisted manifest and aborted 104 items in
// (EUnknownCategory — categories wrongly treated as "already seeded"). The fix mirrors seed_testnet.mjs's
// proven `_stamp`-guarded resume (seed_full_corpus.mjs:106-121 today) — a persisted manifest folds in ONLY
// if its `_stamp` matches the CURRENT lineage; a mismatch archives it aside (never deletes) and starts fresh.
// Pure fs — no chain, no seeder import; replicates the EXACT resume logic byte-for-byte against a real temp
// dir (proving the actual rename/mkdir side effects, not just the decision).
describe('lineage-guarded resume (archive-on-mismatch) — the 07-12 stale-manifest fix', () => {
  // Byte-for-byte mirror of seed_full_corpus.mjs's resume block (lines 106-121): given an OUT_PATH that may
  // already hold a persisted manifest, fold it in if `_stamp` matches, else archive it aside and start fresh.
  const resume = (outDir, outPath, currentStamp, freshOut) => {
    if (fs.existsSync(outPath)) {
      let prev = null
      try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')) } catch {}
      if (prev && prev._stamp === currentStamp) Object.assign(freshOut, prev)
      else if (prev) {
        const archiveDir = path.join(outDir, 'archive')
        fs.mkdirSync(archiveDir, { recursive: true })
        const stampHead = String(prev._stamp || 'unknown').replace(/^0x/, '').slice(0, 10)
        const archived = path.join(archiveDir, `seed_manifest_${stampHead}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
        fs.renameSync(outPath, archived)
        return { archived: true, archivedPath: archived }
      }
    }
    return { archived: false }
  }

  test('matching _stamp: the persisted manifest FOLDS IN (resume continues — no archive, no fresh start)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-resume-match-'))
    const outPath = path.join(dir, 'seed_manifest.json')
    const stamp = '0xFOUNDATION,0xITEMS,0xSPELLS,0xGAME,0xFIGHT'
    fs.writeFileSync(outPath, JSON.stringify({ _stamp: stamp, items: { wheat: '0xWHEAT_ID' }, digests: { categories: '0xdigest1' } }))
    const freshOut = { _stamp: stamp, items: {}, digests: {} }
    const result = resume(dir, outPath, stamp, freshOut)
    expect(result.archived).toBe(false)
    expect(freshOut.items.wheat).toBe('0xWHEAT_ID') // folded in — resume continues from where it left off
    expect(fs.existsSync(outPath)).toBe(true) // never touched
  })

  test('mismatched _stamp (dead lineage): ARCHIVED aside (never deleted) — fresh manifest starts empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-resume-mismatch-'))
    const outPath = path.join(dir, 'seed_manifest.json')
    const deadStamp = '0xDEAD_FOUNDATION,0xDEAD_ITEMS,0xDEAD_SPELLS,0xDEAD_GAME,0xDEAD_FIGHT'
    const currentStamp = '0xFRESH_FOUNDATION,0xFRESH_ITEMS,0xFRESH_SPELLS,0xFRESH_GAME,0xFRESH_FIGHT'
    // the exact 07-12 failure mode: categories recorded as done against a package that no longer exists
    fs.writeFileSync(outPath, JSON.stringify({ _stamp: deadStamp, categories: ['helmet', 'sword'], digests: { categories: '0xdead_digest' } }))
    const freshOut = { _stamp: currentStamp, categories: [], digests: {} }
    const result = resume(dir, outPath, currentStamp, freshOut)
    expect(result.archived).toBe(true)
    // NEVER deleted — archived aside under out/archive/
    expect(fs.existsSync(result.archivedPath)).toBe(true)
    expect(path.dirname(result.archivedPath)).toBe(path.join(dir, 'archive'))
    expect(JSON.parse(fs.readFileSync(result.archivedPath, 'utf8'))._stamp).toBe(deadStamp)
    // the ORIGINAL path is gone (renamed, not copied) and the fresh OUT never folded the dead categories in
    expect(fs.existsSync(outPath)).toBe(false)
    expect(freshOut.categories).toEqual([])
  })

  test('no persisted manifest at all (first run): resume is a no-op, no archive dir created', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-resume-fresh-'))
    const outPath = path.join(dir, 'seed_manifest.json')
    const freshOut = { _stamp: 'whatever', items: {} }
    const result = resume(dir, outPath, 'whatever', freshOut)
    expect(result.archived).toBe(false)
    expect(fs.existsSync(path.join(dir, 'archive'))).toBe(false)
  })

  test('a corrupt/unparseable persisted manifest is treated as absent-safe (never throws the whole run)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-resume-corrupt-'))
    const outPath = path.join(dir, 'seed_manifest.json')
    fs.writeFileSync(outPath, '{ not valid json')
    const freshOut = { _stamp: 'x', items: {} }
    expect(() => resume(dir, outPath, 'x', freshOut)).not.toThrow()
  })
})

// ── LB3 REGRESSION (2026-07-16 incident fix) — pet loot-boxes must seed WITH the KIND_GACHA_ROLL
//    consumable effect. ROOT CAUSE: the 3 box rows in seed/mainnet/pet_boxes.json omitted `gacha:true`, so
//    seed_full_corpus.mjs `buildItemCreate` (the `eff` block, lines 565-579) attached NO effect (optNone) →
//    the on-chain box template fails `loot_box.move::is_gacha_box` (`consumable_effect::kind == gacha_roll`) →
//    `open_box` aborts `ENotBox=103` and every purchased box is un-openable. This test replicates
//    buildItemCreate's EXACT effect-attach compose against the REAL pet_boxes.json rows through the REAL @mysten
//    SDK and proves every box authors the gacha effect. Pure — no chain, no seeder import (import-time side
//    effects). RED before the seed fix (boxes lack `gacha` → optNone → no gacha_roll call), GREEN after.
const REPO_DIR = path.resolve(import.meta.dir, '..', '..', '..')
const PET_BOXES = JSON.parse(
  fs.readFileSync(path.join(REPO_DIR, 'seed', 'mainnet', 'pet_boxes.json'), 'utf8')
)
const BOX_SLUGS = ['pet_lootbox', 'pet_ocean_lootbox', 'pet_arisen_lootbox']
const IPKG = oid('pkg:items') // stands in for both the origin (type) and call (target) package in the compose

// Byte-for-byte mirror of seed_full_corpus.mjs optSome/optNone (lines 265-275) + buildItemCreate's `eff` (565-579).
const opt_some = (tx, tag, v) =>
  tx.moveCall({ target: '0x1::option::some', typeArguments: [tag], arguments: [v] })
const opt_none = (tx, tag) =>
  tx.moveCall({ target: '0x1::option::none', typeArguments: [tag], arguments: [] })
const compose_effect = (tx, row) =>
  row.gacha
    ? opt_some(
        tx,
        `${IPKG}::consumable_effect::ConsumableEffect`,
        tx.moveCall({
          target: `${IPKG}::consumable_effect::new`,
          arguments: [
            tx.moveCall({ target: `${IPKG}::consumable_effect::gacha_roll` }),
            tx.pure.u64(0),
          ],
        })
      )
    : opt_none(tx, `${IPKG}::consumable_effect::ConsumableEffect`)
const effect_calls = row => {
  const tx = new Transaction()
  compose_effect(tx, row)
  return tx
    .getData()
    .commands.filter(c => c.$kind === 'MoveCall')
    .map(c => `${c.MoveCall.module}::${c.MoveCall.function}`)
}

describe('LB3 — pet loot-boxes seed WITH the gacha effect (un-openable-box regression)', () => {
  test('pet_boxes.json declares exactly the 3 known boxes', () => {
    expect(Array.isArray(PET_BOXES.boxes)).toBe(true)
    expect(PET_BOXES.boxes.map(b => b.slug)).toEqual(BOX_SLUGS)
  })

  for (const slug of BOX_SLUGS) {
    test(`${slug} authors KIND_GACHA_ROLL (else on-chain open aborts ENotBox=103)`, () => {
      const row = PET_BOXES.boxes.find(b => b.slug === slug)
      expect(row).toBeTruthy()
      // THE FIX — the row must carry gacha:true so buildItemCreate attaches the effect (not optNone).
      expect(row.gacha).toBe(true)
      // …and the composed create-template tx carries the gacha_roll + new effect calls (the is_gacha_box gate).
      const calls = effect_calls(row)
      expect(calls).toContain('consumable_effect::gacha_roll')
      expect(calls).toContain('consumable_effect::new')
      // The effect is LEGAL only on the consumable category (admin::create_template EEffectNotConsumable); the
      // seed boundary lowercases before the Move call, so the corrected box must resolve to 'consumable'.
      expect(String(row.category).toLowerCase()).toBe('consumable')
    })
  }
})

// ══════ CONSUMABLES MINT-PIPELINE FIX — heal/consumableJson → ConsumableEffect (RESEED-BLOCKING) ══════
// docs/RESEED_RULINGS_SEAT_2026-07-19.md §③ C-1: buildItemCreate's `eff` compose (seed_full_corpus.mjs
// ~583-619) built the on-chain ConsumableEffect from `it.gacha` ONLY — it never read `it.heal` or
// `it.consumableJson`, so all 137 authored CONSUMABLE rows minted with effect=None (proven RED before this
// fix: the gacha-only compose returned 'option::none' for a heal=5200 row instead of HEAL(5200)).
//
// Pure — no chain, no seeder import (same import-time-side-effects constraint as the LB3 block above).
// Byte-for-byte mirror of seed_full_corpus.mjs's CJSON_KIND + resolveConsumableEffect (lines 280-297) and
// buildItemCreate's `eff` compose (lines 604-619).
const CJSON_KIND = {
  LIFE_REGEN: 'heal', // C-2
  RANDOM_ITEMS: 'bag_open', // C-4 — kind 3 is TRAIN CARGO; mints inert-but-honest ahead of the consume door
  RESET_STATS: 'stat_reset', // C-7
  RESET_SPELLS: 'spell_reset', // C-7
}
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
const compose_item_effect = (row) => {
  const tx = new Transaction()
  const ceff = resolveConsumableEffect(row)
  ceff
    ? opt_some(
        tx,
        `${IPKG}::consumable_effect::ConsumableEffect`,
        tx.moveCall({
          target: `${IPKG}::consumable_effect::new`,
          arguments: [
            tx.moveCall({ target: `${IPKG}::consumable_effect::${ceff.fn}` }),
            tx.pure.u64(ceff.amount),
          ],
        })
      )
    : opt_none(tx, `${IPKG}::consumable_effect::ConsumableEffect`)
  return tx
    .getData()
    .commands.filter(c => c.$kind === 'MoveCall')
    .map(c => `${c.MoveCall.module}::${c.MoveCall.function}`)
}
const itemRow = (relPath, slug) => {
  const rows = JSON.parse(
    fs.readFileSync(path.join(REPO_DIR, 'seed', 'mainnet', relPath), 'utf8')
  )
  const row = rows.find(r => r.slug === slug)
  if (!row) throw new Error(`fixture row '${slug}' not found in seed/mainnet/${relPath}`)
  return row
}

describe('THE FIX — heal-carrying bread / gacha box / effectless resource resolve to HEAL / GACHA / None', () => {
  test('heal-carrying bread (choir_hymnbread, heal=5200) → HEAL(5200)', () => {
    const row = itemRow('17_obsidian_choir/items.json', 'choir_hymnbread')
    expect(row.heal).toBe(5200)
    expect(compose_item_effect(row)).toEqual([
      'consumable_effect::heal',
      'consumable_effect::new',
      'option::some',
    ])
  })

  test('gacha box (pet_lootbox) → GACHA_ROLL(0)', () => {
    const row = PET_BOXES.boxes.find(b => b.slug === 'pet_lootbox')
    expect(compose_item_effect(row)).toEqual([
      'consumable_effect::gacha_roll',
      'consumable_effect::new',
      'option::some',
    ])
  })

  test('effectless resource (wheat) → None', () => {
    const row = itemRow('01_first_shore/resources.json', 'wheat')
    expect(compose_item_effect(row)).toEqual(['option::none'])
  })
})

describe('THE FIX — consumableJson richer authoring maps onto the frozen §17.15 vocabulary', () => {
  test('LIFE_REGEN (healing_potion) → HEAL(amount); duration dropped, matches read_templates.js\'s reverse mapping', () => {
    const row = itemRow('02_verdant_hollow/items.json', 'healing_potion')
    expect(JSON.parse(row.consumableJson)).toEqual({ type: 'LIFE_REGEN', amount: 40, duration: 6 })
    expect(resolveConsumableEffect(row)).toEqual({ fn: 'heal', amount: 40 })
  })

  test('RANDOM_ITEMS (bag_wheat) → BAG_OPEN(0) — C-4: mints WITH kind ahead of the consume door', () => {
    const row = itemRow('01_first_shore/items.json', 'bag_wheat')
    expect(resolveConsumableEffect(row)).toEqual({ fn: 'bag_open', amount: 0 })
  })

  test('RESET_STATS (orb_of_purity) → STAT_RESET(0) — C-7', () => {
    const row = itemRow('08_palewood/items.json', 'orb_of_purity')
    expect(resolveConsumableEffect(row)).toEqual({ fn: 'stat_reset', amount: 0 })
  })

  test('RESET_SPELLS (reset_spells_scroll) → SPELL_RESET(0) — C-7', () => {
    const row = itemRow('11_rootheart/items.json', 'reset_spells_scroll')
    expect(resolveConsumableEffect(row)).toEqual({ fn: 'spell_reset', amount: 0 })
  })

  test('ADD_STATS / STAMINA_REGEN / SOUL_REGEN → null — C-5/C-6: no vocabulary kind, RULED not a bug', () => {
    expect(resolveConsumableEffect(itemRow('05_drowned_fen/items.json', 'elixir_of_strength'))).toBeNull()
    expect(resolveConsumableEffect(itemRow('03_emberfall_steppe/items.json', 'stamina_tonic'))).toBeNull()
    expect(resolveConsumableEffect(itemRow('02_verdant_hollow/items.json', 'holy_bible'))).toBeNull()
  })
})

// Corpus sanity (brief's proof bar): drive every seed/mainnet/*/items.json CONSUMABLE row through the fixed
// resolver. Zero effect=None where heal/consumableJson is authored — EXCEPT the C-5/C-6 ruled no-vocabulary
// types, which must stay null (asserting otherwise would fabricate on-chain meaning the vocabulary doesn't
// have). Any OTHER unmapped type would be a real regression and fails this test loudly.
describe('corpus sanity — seed/mainnet/*/items.json CONSUMABLEs', () => {
  const RULED_NO_VOCAB_TYPES = new Set(['ADD_STATS', 'STAMINA_REGEN', 'SOUL_REGEN']) // C-5/C-6

  test('every authored heal/consumableJson resolves, except the ruled no-vocabulary types', () => {
    const biomeDir = path.join(REPO_DIR, 'seed', 'mainnet')
    const biomes = fs
      .readdirSync(biomeDir)
      .filter(d => /^\d/.test(d) && fs.statSync(path.join(biomeDir, d)).isDirectory())
    let authored = 0
    let ruledExceptions = 0
    for (const b of biomes) {
      const p = path.join(biomeDir, b, 'items.json')
      if (!fs.existsSync(p)) continue
      for (const row of JSON.parse(fs.readFileSync(p, 'utf8'))) {
        if (String(row.category).toUpperCase() !== 'CONSUMABLE') continue
        if (row.heal == null && !row.consumableJson) continue
        authored += 1
        if (resolveConsumableEffect(row)) continue
        const type = row.consumableJson && JSON.parse(row.consumableJson).type
        expect(RULED_NO_VOCAB_TYPES.has(type)).toBe(true) // any OTHER unmapped type is a real regression
        ruledExceptions += 1
      }
    }
    expect(authored).toBeGreaterThan(0) // sanity: the corpus actually has authored effects to check
    expect(authored - ruledExceptions).toBeGreaterThan(0) // most rows DO resolve — the fix is real, not vacuous
  })
})
