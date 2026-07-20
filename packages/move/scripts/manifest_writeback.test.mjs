// RECEIPT-LAW coverage (SHOP TRIO (a) root fix, 2026-07-17): the reauthor ceremony must write the
// corrected template ids back into out/seed_manifest.json in the SAME RUN that mints (or first
// observes) them — the 2026-07-16 run skipped this and 5 live sales vanished behind the frontend's
// manifest-id fence. Pure units over mocked mint receipts (ceremony_lib normalizeReceipt shape) +
// the end-to-end incident repro (stale receipt + fresh live sales → exactly the old→new rows) +
// the rerun landmine proof (a fresh receipt must never make the ceremony burn the corrected sale).

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import {
  apply_manifest_writeback,
  compute_manifest_writeback,
  created_template_id,
  writeback_rows,
} from './manifest_writeback.mjs'
import { BOX_APPROVALS, box_slugs, build_box_plan } from './box_reauthor.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const manifest_path = join(script_dir, 'out', 'seed_manifest.json')
const manifest_raw = readFileSync(manifest_path, 'utf8')
const seed_manifest = JSON.parse(manifest_raw)
const pet_boxes = JSON.parse(
  readFileSync(
    join(script_dir, '..', '..', '..', 'seed', 'mainnet', 'pet_boxes.json'),
    'utf8'
  )
)

const id_of = (fill) => `0x${String(fill).repeat(64).slice(0, 64)}`

// A mocked reauthor mint receipt — the normalizeReceipt shape run() returns: the fresh ItemTemplate
// rides objectChanges among the other created/mutated objects of the atomic PTB.
const mint_receipt = (template_id, extra_created = []) => ({
  digest: 'MOCKDIGEST',
  effects: { status: { status: 'success' } },
  objectChanges: [
    { type: 'mutated', objectId: id_of(9), objectType: '0xa::shop::Sale' },
    { type: 'created', objectId: id_of(8), objectType: '0xa::shop::Sale' },
    {
      type: 'created',
      objectId: template_id,
      objectType: '0xa::item::ItemTemplate',
    },
    ...extra_created,
  ],
})

describe('created_template_id — harvesting the mint result', () => {
  test('resolves the ONE created ItemTemplate among the PTB object changes', () => {
    expect(created_template_id(mint_receipt(id_of(2)))).toBe(id_of(2))
  })
  test('throws on zero created templates (never guess a receipt row)', () => {
    expect(() =>
      created_template_id({
        digest: 'D',
        objectChanges: [
          {
            type: 'created',
            objectId: id_of(8),
            objectType: '0xa::shop::Sale',
          },
        ],
      })
    ).toThrow(/found 0/)
  })
  test('throws on two created templates (ambiguous mint)', () => {
    expect(() =>
      created_template_id(
        mint_receipt(id_of(2), [
          {
            type: 'created',
            objectId: id_of(3),
            objectType: '0xa::item::ItemTemplate',
          },
        ])
      )
    ).toThrow(/found 2/)
  })
})

describe('writeback_rows — plan-time rows + mocked mint receipts', () => {
  test('merges plan receipt rows with minted template ids', () => {
    expect(
      writeback_rows({
        manifest_receipt: [{ slug: 'momaku', template_id: id_of(4) }],
        minted: [{ slug: 'pet_lootbox', receipt: mint_receipt(id_of(5)) }],
      })
    ).toEqual([
      { slug: 'momaku', template_id: id_of(4) },
      { slug: 'pet_lootbox', template_id: id_of(5) },
    ])
  })
  test('a slug resolving twice throws (plan bug, never guess the living id)', () => {
    expect(() =>
      writeback_rows({
        manifest_receipt: [{ slug: 'momaku', template_id: id_of(4) }],
        minted: [{ slug: 'momaku', receipt: mint_receipt(id_of(5)) }],
      })
    ).toThrow(/two template ids for momaku/)
  })
})

describe('compute_manifest_writeback — pure receipt diff against the REAL manifest', () => {
  test('an already-fresh row drops out; a stale row yields its old→new change', () => {
    const current = seed_manifest.items.pet_lootbox
    expect(
      compute_manifest_writeback(seed_manifest, [
        { slug: 'pet_lootbox', template_id: current },
      ])
    ).toEqual([])
    expect(
      compute_manifest_writeback(seed_manifest, [
        { slug: 'pet_lootbox', template_id: id_of(6) },
      ])
    ).toEqual([{ slug: 'pet_lootbox', from: current, to: id_of(6) }])
  })
  test('unknown slugs and malformed ids throw (the receipt only refreshes seeded rows)', () => {
    expect(() =>
      compute_manifest_writeback(seed_manifest, [
        { slug: 'not_a_seeded_item', template_id: id_of(6) },
      ])
    ).toThrow(/no manifest item row/)
    expect(() =>
      compute_manifest_writeback(seed_manifest, [
        { slug: 'pet_lootbox', template_id: '0xdead' },
      ])
    ).toThrow(/invalid template id/)
  })
})

describe('apply_manifest_writeback — the single fs edge', () => {
  test('DRY_RUN reports pending rows and leaves the file byte-identical', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-writeback-'))
    const file = join(dir, 'seed_manifest.json')
    writeFileSync(file, manifest_raw)
    const logs = []
    const changes = apply_manifest_writeback({
      manifest_path: file,
      seed_manifest,
      rows: [{ slug: 'pet_lootbox', template_id: id_of(6) }],
      live: false,
      log: (line) => logs.push(line),
    })
    expect(changes).toHaveLength(1)
    expect(logs.join('\n')).toContain('pending, DRY_RUN')
    expect(readFileSync(file, 'utf8')).toBe(manifest_raw)
  })
  test('LIVE rewrites ONLY the receipt rows, byte-stable with the seeder serializer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-writeback-'))
    const file = join(dir, 'seed_manifest.json')
    writeFileSync(file, manifest_raw)
    const old_id = seed_manifest.items.pet_lootbox
    apply_manifest_writeback({
      manifest_path: file,
      seed_manifest,
      rows: [{ slug: 'pet_lootbox', template_id: id_of(6) }],
      live: true,
      log: () => {},
    })
    const written = readFileSync(file, 'utf8')
    // the whole file differs by EXACTLY the one refreshed id — order, format, trailing bytes intact.
    expect(written).toBe(manifest_raw.replace(old_id, id_of(6)))
  })
})

describe('receipt law end-to-end (no chain): the 2026-07-16 incident and its rerun', () => {
  const box_rows = pet_boxes.boxes
  // The live corrected sales as /v1 serves them (content matches the approved seed; fresh ids).
  const corrected_live_rows = (fresh_id_for) =>
    box_slugs.map((slug, index) => {
      const box = box_rows.find((row) => row.slug === slug)
      const template_id = fresh_id_for(slug, index)
      return {
        sale_id: id_of(index + 1),
        template_id,
        price_mist: String(BigInt(box.price_sui) * 1_000_000_000n),
        minted: 0,
        supply_remaining: box.supply,
        paused: false,
        template: {
          template_id,
          item_type: box.itemType,
          name: box.name,
          description: box.description ?? '',
          level: box.level ?? 1,
          category: String(box.category).toLowerCase(),
        },
      }
    })

  test('INCIDENT repro: fresh sales + stale receipt → write-back computes exactly the old→new rows', () => {
    const fresh = (slug, index) => id_of(index + 2)
    const stale_manifest = JSON.parse(manifest_raw)
    for (const slug of box_slugs)
      stale_manifest.items[slug] = BOX_APPROVALS[slug].old_template_id // the pre-fix stale receipt
    const plan = build_box_plan({
      live_rows: corrected_live_rows(fresh),
      box_rows,
      seed_manifest: stale_manifest,
    })
    expect(plan.reauthor_boxes).toEqual([]) // old sales burned — nothing to execute…
    expect(
      compute_manifest_writeback(
        stale_manifest,
        writeback_rows({ manifest_receipt: plan.manifest_receipt })
      )
    ).toEqual(
      box_slugs.map((slug, index) => ({
        slug,
        from: BOX_APPROVALS[slug].old_template_id,
        to: fresh(slug, index),
      }))
    ) // …but the receipt still heals in the same run.
  })

  test('RERUN landmine: a fresh receipt never makes the ceremony burn the corrected sale', () => {
    // Post-write-back state: manifest maps each slug to the live corrected template (today's manifest).
    const plan = build_box_plan({
      live_rows: corrected_live_rows((slug) => seed_manifest.items[slug]),
      box_rows,
      seed_manifest,
    })
    expect(plan.reauthor_boxes).toEqual([]) // ZERO burn/mint ops — the corrected sales stay live
    expect(
      compute_manifest_writeback(
        seed_manifest,
        writeback_rows({ manifest_receipt: plan.manifest_receipt })
      )
    ).toEqual([]) // and the receipt is recognized as already fresh
  })
})
