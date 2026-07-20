// LB3 — box reauthor ceremony coverage. Proves build_box_plan diffs the 3 broken pet boxes against the corrected
// seed and that reauthor_box_tx composes the ATOMIC fix PTB (pause→burn→create-WITH-gacha-effect→sale→loot_table).
// Pure — reads the REAL pet_boxes.json + seed_manifest so a seed drift breaks the test, and builds REAL @mysten
// Transactions (no chain). The on-chain DRY_RUN simulation is the lead's (NEEDS-LEAD; sandbox has no network).

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import {
  BOX_APPROVALS,
  box_slugs,
  build_box_plan,
  reauthor_box_tx,
} from './box_reauthor.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const pet_boxes = JSON.parse(
  readFileSync(join(repo_dir, 'seed', 'mainnet', 'pet_boxes.json'), 'utf8')
)
const seed_manifest = JSON.parse(
  readFileSync(join(script_dir, 'out', 'seed_manifest.json'), 'utf8')
)
const box_rows = pet_boxes.boxes
// The incident's old (broken) template ids are PINNED in BOX_APPROVALS — the manifest is the
// ceremony's output receipt (post-2026-07-17 it maps these slugs to the CORRECTED generation).
const template_ids = Object.fromEntries(
  box_slugs.map((slug) => [slug, BOX_APPROVALS[slug].old_template_id])
)

const sale_id = (index) => `0x${String(index + 1).padStart(64, '0')}`
const clone = (value) => JSON.parse(JSON.stringify(value))

// A broken (pre-fix) box sale selling the OLD effect-less template. Its /v1 template snapshot matches the seed
// content — the gacha effect is a DF the encyclopedia never surfaced, which is exactly why content alone can't
// distinguish broken from corrected (the plan disambiguates by template_id).
function broken_sale({ slug, index, minted = 0 }) {
  const box = box_rows.find((row) => row.slug === slug)
  const template_id = template_ids[slug]
  return {
    sale_id: sale_id(index),
    template_id,
    price_mist: String(BigInt(box.price_sui) * 1_000_000_000n),
    minted,
    supply_remaining: box.supply - minted,
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
}

const deployment = {
  origin_package: `0x${'a'.repeat(64)}`,
  call_package: `0x${'b'.repeat(64)}`,
  admin: `0x${'c'.repeat(64)}`,
  version: `0x${'d'.repeat(64)}`,
  catalog: `0x${'e'.repeat(64)}`,
  gifting_package: `0x${'f'.repeat(64)}`,
  loot_registry: `0x${'1'.repeat(64)}`,
}

const call_list = (tx) =>
  tx
    .getData()
    .commands.filter((c) => c.$kind === 'MoveCall')
    .map((c) => `${c.MoveCall.module}::${c.MoveCall.function}`)

describe('build_box_plan — the 3 broken pet boxes', () => {
  test('reauthors all 3 with the full pause→burn→create→sale→loot_table step set + correct fresh supply', () => {
    const live_rows = box_slugs.map((slug, index) =>
      broken_sale({ slug, index, minted: index * 7 })
    )
    const plan = build_box_plan({ live_rows, box_rows, seed_manifest })
    expect(plan.reauthor_boxes.map((op) => op.slug)).toEqual(box_slugs)
    expect(plan.manifest_receipt).toEqual([]) // no corrected sale live yet — receipt rows only exist post-mint
    for (const [i, op] of plan.reauthor_boxes.entries()) {
      expect(op.steps.join(':')).toBe(
        'set_paused:burn_sale:create_template:create_sale:set_loot_table'
      )
      expect(op.create_fresh).toBe(true)
      expect(op.fresh_supply).toBe(BOX_APPROVALS[op.slug].supply - i * 7)
      // pool resolves every pet slug to its seeded template id.
      const seed_pool = box_rows.find((row) => row.slug === op.slug).pool
      expect(op.pool.map((p) => p.weight)).toEqual(
        seed_pool.map((p) => p.weight)
      )
      expect(op.pool.map((p) => p.template_id)).toEqual(
        seed_pool.map((p) => seed_manifest.items[p.pet])
      )
      expect(op.fresh_template.category).toBe('consumable')
    }
  })

  test('a rerun over the corrected sale (old sale burned) is a zero-op plan (idempotent)', () => {
    const corrected = box_slugs.map((slug, index) => {
      const box = box_rows.find((row) => row.slug === slug)
      const fresh_template_id = `0x${String(index + 9)
        .repeat(64)
        .slice(0, 64)}`
      return {
        sale_id: sale_id(index + 30),
        template_id: fresh_template_id, // a NEW id, not the old broken one
        price_mist: String(BigInt(box.price_sui) * 1_000_000_000n),
        minted: 3,
        supply_remaining: box.supply - 3,
        paused: false,
        template: {
          template_id: fresh_template_id,
          item_type: box.itemType,
          name: box.name,
          description: box.description ?? '',
          level: box.level ?? 1,
          category: String(box.category).toLowerCase(),
        },
      }
    })
    expect(
      build_box_plan({ live_rows: corrected, box_rows, seed_manifest })
    ).toEqual({
      reauthor_boxes: [],
      // the receipt law: converged corrected sales still surface their live template ids so the
      // ceremony can heal a stale seed-manifest receipt in the same run (manifest_writeback.mjs).
      manifest_receipt: corrected.map(({ template_id }, index) => ({
        slug: box_slugs[index],
        template_id,
      })),
    })
  })

  test('a drifted price/supply seed row is refused (prices are locked once shipped — never silently changed)', () => {
    const drifted = clone(box_rows)
    drifted.find((row) => row.slug === 'pet_lootbox').price_sui = 5
    const live_rows = [broken_sale({ slug: 'pet_lootbox', index: 0 })]
    expect(() =>
      build_box_plan({ live_rows, box_rows: drifted, seed_manifest })
    ).toThrow(/drifted from owner approval/)
  })

  test('a seed row without gacha:true is refused (reauthor must never recreate the broken box)', () => {
    const no_gacha = clone(box_rows)
    delete no_gacha.find((row) => row.slug === 'pet_lootbox').gacha
    const live_rows = [broken_sale({ slug: 'pet_lootbox', index: 0 })]
    expect(() =>
      build_box_plan({ live_rows, box_rows: no_gacha, seed_manifest })
    ).toThrow(/lacks gacha:true/)
  })

  test('a pool pet absent from the manifest throws (never author a half-broken table)', () => {
    const manifest = clone(seed_manifest)
    delete manifest.items[
      box_rows.find((row) => row.slug === 'pet_lootbox').pool[0].pet
    ]
    const live_rows = [broken_sale({ slug: 'pet_lootbox', index: 0 })]
    expect(() =>
      build_box_plan({ live_rows, box_rows, seed_manifest: manifest })
    ).toThrow(/pool pet/)
  })
})

describe('reauthor_box_tx — the atomic fix PTB', () => {
  test('composes pause, burn, the gacha effect, create_template, create_sale, then admin_set_loot_table (in order)', () => {
    const live_rows = box_slugs.map((slug, index) =>
      broken_sale({ slug, index, minted: 4 })
    )
    const op = build_box_plan({
      live_rows,
      box_rows,
      seed_manifest,
    }).reauthor_boxes.find((o) => o.slug === 'pet_arisen_lootbox')
    const calls = call_list(reauthor_box_tx(op, deployment))
    // the gacha effect is the whole point — its absence is the reported bug.
    expect(calls).toContain('consumable_effect::gacha_roll')
    expect(calls).toContain('consumable_effect::new')
    // the fix is only complete WITH the loot table on the fresh template (else open aborts ENoTable).
    const order = [
      'shop::set_paused',
      'shop::burn_sale',
      'admin::create_template',
      'shop::create_sale',
      'loot_box::admin_set_loot_table',
    ]
    let cursor = -1
    for (const call of order) {
      const at = calls.indexOf(call)
      expect(at).toBeGreaterThan(cursor)
      cursor = at
    }
    // admin_set_loot_table is the terminal call (it consumes the create_template result id).
    expect(calls.at(-1)).toBe('loot_box::admin_set_loot_table')
  })

  test('a converged op (create_fresh:false) composes ONLY pause+burn (no re-create)', () => {
    const op = {
      slug: 'pet_lootbox',
      old_sale_id: sale_id(0),
      old_paused: false,
      create_fresh: false,
    }
    expect(call_list(reauthor_box_tx(op, deployment))).toEqual([
      'shop::set_paused',
      'shop::burn_sale',
    ])
  })
})
