// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync as read_file_sync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { expect, test } from 'bun:test'

import {
  build_shop_plan,
  reauthor_targets,
  resolve_mode,
  shop_template_ids,
} from './apply_shop_payload.mjs'

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const shop_seed = JSON.parse(
  read_file_sync(join(repo_dir, 'seed', 'mainnet', 'shop.json'), 'utf8')
)
const seed_rows = shop_seed.cosmetics
const seed_by_slug = new Map(seed_rows.map((row) => [row.slug, row]))
const seed_manifest = JSON.parse(
  read_file_sync(
    join(repo_dir, 'packages', 'move', 'scripts', 'out', 'seed_manifest.json'),
    'utf8'
  )
)

const targets = {
  delists: [
    'cape_lorito_air',
    'cape_lorito_earth',
    'cape_lorito_fire',
    'cape_lorito_water',
    'corbac_helmet',
  ],
  renames: [
    'cape_lorito_agility',
    'cape_lorito_chance',
    'cape_lorito_intelligence',
    'cape_lorito_strength',
    'cape_lorito_vitality',
    'cape_lorito_wisdom',
  ],
  reauthors: [
    ['momaku', 3],
    ['enka_muru', 7],
    ['capuche_mo', 0],
  ],
}
// Delist/rename ids come from the manifest (their rows never change); the reauthor OLD ids are
// PINNED incident facts on reauthor_targets — the manifest is the ceremony's output receipt and
// post-2026-07-17 maps momaku/enka_muru to the CORRECTED generation.
const template_ids = {
  ...shop_template_ids(seed_manifest),
  ...Object.fromEntries(
    Object.entries(reauthor_targets).map(([slug, { old_template_id }]) => [
      slug,
      old_template_id,
    ])
  ),
}

const sale_id = (index) => `0x${String(index + 1).padStart(64, '0')}`

function live_row({ slug, template_id, index, minted = 0, seed_row }) {
  const supply = seed_row?.supply ?? 1_000
  const price_sui = seed_row?.price_sui ?? 1
  return {
    sale_id: sale_id(index),
    template_id,
    price_mist: String(BigInt(price_sui) * 1_000_000_000n),
    minted,
    supply_remaining: supply - minted,
    paused: false,
    template: {
      template_id,
      item_type: 'hat',
      name: `Legacy ${slug}`,
      description: `Legacy description for ${slug}`,
      level: 1,
      category: 'hat',
    },
  }
}

const live_rows = [
  ...targets.delists.map((slug, index) =>
    live_row({ slug, template_id: template_ids[slug], index })
  ),
  ...targets.renames.map((slug, index) =>
    live_row({
      slug,
      template_id: template_ids[slug],
      index: index + 5,
      seed_row: seed_by_slug.get(slug),
    })
  ),
  ...targets.reauthors.map(([slug, minted], index) =>
    live_row({
      slug,
      template_id: template_ids[slug],
      minted,
      index: index + 11,
      seed_row: seed_by_slug.get(slug),
    })
  ),
]

test('real shop seed and live fixture resolve only the 14 approved operations', () => {
  expect(live_rows).toHaveLength(14)
  expect(Object.keys(shop_template_ids(seed_manifest)).sort()).toEqual(
    [...targets.delists, ...targets.renames].sort()
  )
  expect(Object.keys(reauthor_targets)).toEqual(
    targets.reauthors.map(([slug]) => slug)
  )

  const plan = build_shop_plan({ live_rows, seed_rows, seed_manifest })

  expect(Object.keys(plan).sort()).toEqual([
    'delists',
    'manifest_receipt',
    'reauthors',
    'renames',
  ])
  expect(plan.manifest_receipt).toEqual([]) // no corrected sale live in this fixture — rows exist post-mint
  expect(plan.delists.map(({ slug }) => slug)).toEqual(targets.delists)
  expect(plan.renames.map(({ slug }) => slug)).toEqual(targets.renames)
  expect(plan.reauthors.map(({ slug }) => slug)).toEqual(
    targets.reauthors.map(([slug]) => slug)
  )
  expect(plan.reauthors.map(({ fresh_supply }) => fresh_supply)).toEqual([
    53, 187, 300,
  ])
  expect(
    plan.delists.every(
      ({ steps }) => steps.join(':') === 'set_paused:burn_sale'
    )
  ).toBe(true)
  expect(
    plan.reauthors.every(
      ({ steps }) =>
        steps.join(':') === 'set_paused:burn_sale:create_template:create_sale'
    )
  ).toBe(true)
  expect(plan.renames.map(({ slug, to }) => [slug, to])).toEqual(
    targets.renames.map((slug) => {
      const { name, description } = seed_by_slug.get(slug)
      return [slug, { name, description }]
    })
  )
  expect(
    plan.delists.length + plan.renames.length + plan.reauthors.length
  ).toBe(14)
})

test('a rerun over corrected text and replacement cloak sales is a zero-op plan', () => {
  const corrected_renames = targets.renames.map((slug, index) => {
    const seed_row = seed_by_slug.get(slug)
    const template_id = template_ids[slug]
    const row = live_row({ slug, template_id, index, seed_row })
    return {
      ...row,
      template: {
        template_id,
        item_type: seed_row.itemType,
        name: seed_row.name,
        description: seed_row.description,
        level: seed_row.level ?? 1,
        category: seed_row.category,
      },
    }
  })
  const corrected_reauthors = targets.reauthors.map(([slug], index) => {
    const seed_row = seed_by_slug.get(slug)
    const template_id = `0x${String(index + 10)
      .repeat(64)
      .slice(0, 64)}`
    const minted = index + 1
    const replacement_cap = seed_row.supply - targets.reauthors[index][1]
    return {
      sale_id: sale_id(index + 20),
      template_id,
      price_mist: String(BigInt(seed_row.price_sui) * 1_000_000_000n),
      minted,
      supply_remaining: replacement_cap - minted,
      paused: false,
      template: {
        template_id,
        item_type: seed_row.itemType,
        name: seed_row.name,
        description: seed_row.description,
        level: seed_row.level ?? 1,
        category: seed_row.category,
      },
    }
  })
  expect(
    build_shop_plan({
      live_rows: [...corrected_renames, ...corrected_reauthors],
      seed_rows,
      seed_manifest,
    })
  ).toEqual({
    delists: [],
    renames: [],
    reauthors: [],
    // receipt law: converged replacement sales surface their live template ids so a LIVE rerun
    // heals a stale seed-manifest receipt in the same run (manifest_writeback.mjs).
    manifest_receipt: corrected_reauthors.map(({ template_id }, index) => ({
      slug: targets.reauthors[index][0],
      template_id,
    })),
  })
})

test('DRY_RUN is default and only LIVE=1 opens execution mode', () => {
  expect(resolve_mode({})).toEqual({ live: false, dry_run: true })
  expect(resolve_mode({ LIVE: '1' })).toEqual({ live: true, dry_run: false })
  expect(() => resolve_mode({ DRY_RUN: '0' })).toThrow(/requires LIVE=1/)
  expect(() => resolve_mode({ LIVE: '1', DRY_RUN: '1' })).toThrow(/conflicts/)
})
