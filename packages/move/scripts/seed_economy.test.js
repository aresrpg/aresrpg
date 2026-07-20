// Unit coverage of the ceremony money-path helpers (seed_economy.mjs) — the two ceremony-blocking bugs:
//   • shop price SUI→MIST (a 10^9 shortfall would list the whole catalog for dust);
//   • crafting::create_recipe arity (required_job: u8 + craft_xp: u64 must be sourced, never invented).
// Pure — no chain. Also asserts the REAL seed/mainnet/shop.json converts fully in range.

import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import {
  sui_to_sale_mist,
  resolve_required_job,
  damage_lines,
  pack_qty_for_job,
  RESOURCE_PACK_QTY,
  JOB_IDS,
  MIN_SALE_MIST,
  MAX_SALE_MIST,
} from './seed_economy.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(__dir, '..', '..', '..')
/** A well-formed 32-byte object id from an arbitrary tag (mirrors the SDK fixtures' `id`). */
const oid = tag =>
  `0x${Buffer.from(String(tag)).toString('hex').padEnd(64, '0').slice(0, 64)}`

describe('sui_to_sale_mist — SUI→MIST (×1e9 BigInt-exact) with a coherent-range refuse', () => {
  test('the two cited rows: pepe_royal (1500 SUI) and the cheapest (5 SUI)', () => {
    expect(sui_to_sale_mist(1500)).toBe(1_500_000_000_000n) // pepe_royal: 1500 SUI → 1.5e12 MIST
    expect(sui_to_sale_mist(5)).toBe(5_000_000_000n) // cape_lorito (cheapest): 5 SUI → 5e9 MIST
  })
  test('every result clears the 0.01-SUI royalty floor and stays exact for whole SUI', () => {
    expect(sui_to_sale_mist(1)).toBe(1_000_000_000n)
    expect(sui_to_sale_mist(1) >= MIN_SALE_MIST).toBe(true)
    expect(sui_to_sale_mist(500)).toBe(500_000_000_000n)
  })
  test('refuses a non-positive price (money-path loud stop)', () => {
    expect(() => sui_to_sale_mist(0)).toThrow(/positive SUI/)
    expect(() => sui_to_sale_mist(null)).toThrow(/positive SUI/)
    expect(() => sui_to_sale_mist(-5)).toThrow(/positive SUI/)
  })
  test('refuses a price above the 10,000,000-SUI ceiling', () => {
    expect(() => sui_to_sale_mist(10_000_001)).toThrow(/out of the coherent range/)
    expect(MAX_SALE_MIST).toBe(10_000_000_000_000_000n) // 10M SUI in MIST
  })
  test('the REAL seed/mainnet/shop.json converts fully in range (58 rows, cosmetics + pets)', () => {
    const s = JSON.parse(fs.readFileSync(path.join(REPO, 'seed', 'mainnet', 'shop.json'), 'utf8'))
    const rows = [...(s.cosmetics || []), ...(s.pets || [])]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      const mist = sui_to_sale_mist(r.price_sui ?? r.price)
      expect(mist >= MIN_SALE_MIST && mist <= MAX_SALE_MIST).toBe(true)
      expect(mist).toBe(BigInt(Math.round(Number(r.price_sui ?? r.price))) * 1_000_000_000n)
    }
  })
})

describe('resolve_required_job — authored job (slug|numeric) → on-chain required_job u8, or null', () => {
  test('canonical slugs resolve to their JOBS index', () => {
    expect(resolve_required_job('farmer')).toBe(0)
    expect(resolve_required_job('sword_smith')).toBe(3)
    expect(resolve_required_job('jeweler')).toBe(11)
    expect(resolve_required_job('handyman')).toBe(14)
    expect(JOB_IDS.length).toBe(15) // JOB_COUNT (forgemagie.move)
  })
  test('a valid numeric id passes through; an out-of-range one is null', () => {
    expect(resolve_required_job(0)).toBe(0)
    expect(resolve_required_job(14)).toBe(14)
    expect(resolve_required_job(15)).toBeNull()
    expect(resolve_required_job(99)).toBeNull()
  })
  test('a PHANTOM slug or an absent job is null (the seeder skips + counts, never invents)', () => {
    expect(resolve_required_job('dagger_forger')).toBeNull() // not in JOBS — content gap
    expect(resolve_required_job('lance_maker')).toBeNull()
    expect(resolve_required_job(null)).toBeNull()
    expect(resolve_required_job(undefined)).toBeNull()
  })
})

describe('pack_qty_for_job / RESOURCE_PACK_QTY — resource NODE-CHARGE pack sizes by job (Testlands live-test, 07-12 evening)', () => {
  test('the ruled bands: farmer 10-20 / herbalist 4-8 / miner 2-4', () => {
    expect(RESOURCE_PACK_QTY[0]).toEqual({ min: 10, max: 20 }) // farmer
    expect(RESOURCE_PACK_QTY[1]).toEqual({ min: 4, max: 8 }) // herbalist
    expect(RESOURCE_PACK_QTY[2]).toEqual({ min: 2, max: 4 }) // miner
  })
  test('an absent min/max falls back to the job band', () => {
    expect(pack_qty_for_job(0)).toEqual({ min: 10, max: 20 })
    expect(pack_qty_for_job(1, undefined, undefined)).toEqual({ min: 4, max: 8 })
    expect(pack_qty_for_job(2, null, null)).toEqual({ min: 2, max: 4 })
  })
  test('an explicitly authored min/max pair always overrides the job band (a deliberate per-row tune)', () => {
    expect(pack_qty_for_job(0, 1, 1)).toEqual({ min: 1, max: 1 }) // a deliberate single-gather override
    expect(pack_qty_for_job(2, 50, 60)).toEqual({ min: 50, max: 60 }) // a deliberate boss-vein override
  })
  test('a partial override (only one of min/max authored) is NOT trusted — falls back to the job band', () => {
    expect(pack_qty_for_job(0, 5, undefined)).toEqual({ min: 10, max: 20 })
    expect(pack_qty_for_job(0, undefined, 5)).toEqual({ min: 10, max: 20 })
  })
  test('an unrecognized job is a conservative single-gather node (never invent a pack size)', () => {
    expect(pack_qty_for_job(3)).toEqual({ min: 1, max: 1 }) // sword_smith — not a gathering job
    expect(pack_qty_for_job(null)).toEqual({ min: 1, max: 1 })
    expect(pack_qty_for_job(undefined)).toEqual({ min: 1, max: 1 })
  })
  test('every band is well-formed (max >= min > 0) and ranks farmer > herbalist > miner', () => {
    for (const job of [0, 1, 2]) {
      const { min, max } = RESOURCE_PACK_QTY[job]
      expect(min).toBeGreaterThan(0)
      expect(max).toBeGreaterThanOrEqual(min)
    }
    expect(RESOURCE_PACK_QTY[0].min).toBeGreaterThan(RESOURCE_PACK_QTY[1].min) // farmer packs > herbalist packs
    expect(RESOURCE_PACK_QTY[1].min).toBeGreaterThan(RESOURCE_PACK_QTY[2].min) // herbalist packs > miner packs
  })
  test('the REAL seed/mainnet/**/world.json resource rows resolve to an in-band pack (no world.json authors an override today)', () => {
    const mainnetDir = path.join(REPO, 'seed', 'mainnet')
    const biomes = fs.readdirSync(mainnetDir).filter((d) => /^\d/.test(d) && fs.statSync(path.join(mainnetDir, d)).isDirectory())
    expect(biomes.length).toBeGreaterThan(0)
    let checked = 0
    for (const b of biomes) {
      const wf = path.join(mainnetDir, b, 'world.json')
      if (!fs.existsSync(wf)) continue
      const w = JSON.parse(fs.readFileSync(wf, 'utf8'))
      for (const res of w.resources || []) {
        const pack = pack_qty_for_job(res.job, res.min_qty, res.max_qty)
        const band = RESOURCE_PACK_QTY[res.job] ?? { min: 1, max: 1 }
        expect(pack).toEqual(band) // no world.json authors an explicit min_qty/max_qty override today
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('create_recipe compose — the CURRENT 8-arg Move shape (adds required_job + craft_xp)', () => {
  test('a row with a resolvable job + craft_xp composes crafting::create_recipe with 8 args', () => {
    const rc = { inputs: [{ slug: 'a', qty: 1 }, { slug: 'b', qty: 2 }], output: 'out', outQty: 1, job: 'jeweler', craft_xp: 120 }
    const required_job = resolve_required_job(rc.required_job ?? rc.job)
    const craft_xp = rc.craft_xp ?? rc.craftXp
    expect(required_job).toBe(11)
    expect(craft_xp).toBe(120)

    const tx = new Transaction()
    const PKG = oid('game')
    tx.moveCall({
      target: `${PKG}::crafting::create_recipe`,
      arguments: [
        tx.object(oid('cap')),
        tx.object(oid('ver')),
        tx.pure.vector('id', rc.inputs.map(x => oid(x.slug))),
        tx.pure.vector('u64', rc.inputs.map(x => x.qty)),
        tx.pure.id(oid(rc.output)),
        tx.pure.u64(rc.outQty ?? 1),
        tx.pure.u8(required_job),
        tx.pure.u64(craft_xp),
      ],
    })
    const call = tx.getData().commands.find(c => c.$kind === 'MoveCall')
    expect(call.MoveCall.function).toBe('create_recipe')
    expect(call.MoveCall.arguments.length).toBe(8)
  })
})

describe('damage_lines — object|array normalization + the seeders mint N lines from one home', () => {
  const IDMG = `${oid('items')}::item_damages`
  // mirror the seeders' dmg-vec compose: makeMoveVec of one item_damages::new per normalized line.
  const compose_dmg = dmg => {
    const tx = new Transaction()
    tx.makeMoveVec({
      type: `${IDMG}::ItemDamages`,
      elements: damage_lines(dmg).map(d =>
        tx.moveCall({
          target: `${IDMG}::new`,
          arguments: [tx.pure.u16(d.from), tx.pure.u16(d.to), tx.pure.string(d.type), tx.pure.string(d.element)],
        })
      ),
    })
    return tx
  }
  const dmg_new_calls = tx =>
    tx.getData().commands.filter(c => c.$kind === 'MoveCall' && c.MoveCall.function === 'new').length

  test('a single object → one defaulted line (type/element fallbacks mirror the seeders)', () => {
    expect(damage_lines({ from: 20, to: 40, type: 'weapon', element: 'fire' })).toEqual([
      { from: 20, to: 40, type: 'weapon', element: 'fire' },
    ])
    expect(damage_lines({ from: 5, to: 9 })).toEqual([{ from: 5, to: 9, type: 'weapon', element: 'neutral' }])
  })
  test('an array of N lines → N lines passthrough (the bracket-mandated split, gear law)', () => {
    const arr = [
      { from: 12, to: 24, type: 'weapon', element: 'fire' },
      { from: 8, to: 16, type: 'weapon', element: 'neutral' },
    ]
    expect(damage_lines(arr)).toEqual(arr)
    expect(damage_lines(arr).length).toBe(2)
  })
  test('absent dmg → [] (empty damage vec — unchanged from the pre-array seeder)', () => {
    expect(damage_lines(undefined)).toEqual([])
    expect(damage_lines(null)).toEqual([])
  })
  test('an array row composes N item_damages::new calls; an object row composes exactly 1; absent 0', () => {
    const three = [
      { from: 129, to: 241, type: 'weapon', element: 'fire' },
      { from: 77, to: 145, type: 'weapon', element: 'neutral' },
      { from: 52, to: 96, type: 'weapon', element: 'earth' },
    ]
    expect(dmg_new_calls(compose_dmg(three))).toBe(3)
    expect(dmg_new_calls(compose_dmg({ from: 20, to: 40, type: 'weapon', element: 'fire' }))).toBe(1)
    expect(dmg_new_calls(compose_dmg(undefined))).toBe(0)
  })
  test('the single-object compose is BYTE-IDENTICAL to the pre-array inline dmgLine', () => {
    const dmg = { from: 20, to: 40, type: 'weapon', element: 'fire' }
    // OLD inline (seed_full_corpus, pre-refactor): [dmgLine(from, to, type||'weapon', element||'neutral')]
    const old = new Transaction()
    old.makeMoveVec({
      type: `${IDMG}::ItemDamages`,
      elements: [
        old.moveCall({
          target: `${IDMG}::new`,
          arguments: [
            old.pure.u16(dmg.from),
            old.pure.u16(dmg.to),
            old.pure.string(dmg.type || 'weapon'),
            old.pure.string(dmg.element || 'neutral'),
          ],
        }),
      ],
    })
    const neu = compose_dmg(dmg)
    expect(JSON.stringify(neu.getData().inputs)).toBe(JSON.stringify(old.getData().inputs))
    expect(JSON.stringify(neu.getData().commands)).toBe(JSON.stringify(old.getData().commands))
  })
})
