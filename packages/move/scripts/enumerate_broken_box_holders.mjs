// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LB3 — enumerate the current HOLDERS of the 3 broken pet loot-boxes (a remediation target), so
// remediation can target the exact owner of each un-openable box. READ-ONLY. The broken box template ids are
// the PINNED incident facts in BOX_APPROVALS (box_reauthor.mjs) — NOT the seed manifest, which is the reauthor
// ceremony's output receipt and now maps these slugs to the CORRECTED templates (receipt law, 2026-07-17).
// Holders are joined from the indexer's read layer (the SAME two-hop /v1/owner-items uses): scan every item
// doc, keep those whose `template` is a broken box, then resolve item → kiosk → owner.
//
//   bun packages/move/scripts/enumerate_broken_box_holders.mjs            # scans REDIS_URL (default local)
//   REDIS_URL=redis://<indexer-redis>:6379 bun packages/move/scripts/enumerate_broken_box_holders.mjs
//
// NEEDS-LEAD: the sandbox has no route to the indexer Redis — the lead runs this against the live indexer store
// (e.g. a port-forward to rpc-redis-0). It writes out/broken_box_holders.json and prints a per-box holder count.
// A box's CURRENT-sale `minted` (see the apply_shop_payload DRY_RUN plan) upper-bounds its live holders; opened
// boxes can't exist (the bug blocks opening), so every minted-but-unburned box is still sitting in a holder kiosk.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RedisClient } from 'bun'

import { BOX_APPROVALS } from './box_reauthor.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const BOX_SLUGS = ['pet_lootbox', 'pet_ocean_lootbox', 'pet_arisen_lootbox']

const broken = Object.fromEntries(
  BOX_SLUGS.map((slug) => {
    const id = BOX_APPROVALS[slug]?.old_template_id
    if (!/^0x[0-9a-f]{64}$/i.test(id ?? '')) throw new Error(`BOX_APPROVALS has no pinned old template id for ${slug}`)
    return [id, slug]
  })
)
const broken_ids = new Set(Object.keys(broken))

const redis = new RedisClient(REDIS_URL)

// JSON.GET at a path (RedisJSON). `$` returns an array of matches; unwrap the first. null on a missing key.
async function json_get(key, path = '$') {
  const raw = await redis.send('JSON.GET', [key, path])
  if (raw == null) return null
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed
}

// Fail FAST with a clear NEEDS-LEAD message rather than hanging when REDIS_URL isn't the indexer store.
async function assert_reachable() {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`no PONG from ${REDIS_URL} within 8s`)), 8000)
  )
  const pong = await Promise.race([redis.send('PING', []), timeout])
  if (pong !== 'PONG' && pong !== 'pong' && pong !== true)
    throw new Error(`${REDIS_URL} did not answer PING (got ${JSON.stringify(pong)})`)
}

async function main() {
  await assert_reachable()
  console.log(`scanning ${REDIS_URL} for holders of ${BOX_SLUGS.length} broken box templates…`)
  const kiosk_owner = new Map() // kiosk_id → owner (memoised)
  const rows = []
  let cursor = '0'
  let scanned = 0
  do {
    const [next, keys] = await redis.send('SCAN', [cursor, 'MATCH', 'rpc:item:*', 'COUNT', '500'])
    cursor = next
    for (const key of keys ?? []) {
      scanned += 1
      const doc = await json_get(key)
      if (!doc || !broken_ids.has(doc.template)) continue
      let owner = null
      const kiosk_id = doc.kiosk_id ?? null
      if (kiosk_id) {
        if (!kiosk_owner.has(kiosk_id))
          kiosk_owner.set(kiosk_id, (await json_get(`rpc:kiosk:${kiosk_id}`))?.owner ?? null)
        owner = kiosk_owner.get(kiosk_id)
      }
      rows.push({
        item_id: doc.id ?? key.replace('rpc:item:', ''),
        template_id: doc.template,
        box_slug: broken[doc.template],
        kiosk_id,
        owner, // null when the item isn't snapshotted yet — the lead re-runs after the indexer catches up
      })
    }
  } while (cursor !== '0')

  const by_slug = Object.fromEntries(BOX_SLUGS.map((slug) => [slug, 0]))
  for (const row of rows) by_slug[row.box_slug] += 1
  const out_path = join(script_dir, 'out', 'broken_box_holders.json')
  writeFileSync(
    out_path,
    JSON.stringify(
      {
        _generatedAt: new Date().toISOString(),
        templates: broken,
        scanned_items: scanned,
        count: rows.length,
        holders: rows,
      },
      null,
      2
    )
  )
  console.log(`scanned ${scanned} item docs · ${rows.length} broken-box holdings`)
  for (const slug of BOX_SLUGS) console.log(`  ${slug}: ${by_slug[slug]} holding(s)`)
  console.log(`wrote ${out_path}`)
  const unresolved = rows.filter((row) => !row.owner)
  if (unresolved.length)
    console.log(
      `  WARNING: ${unresolved.length} holding(s) have no snapshotted owner yet — re-run after the indexer catches up`
    )
  redis.close?.()
}

main().catch((error) => {
  console.error(`\nHOLDER ENUMERATION FAILED: ${error.message}`)
  console.error('If this is a connection error, the sandbox cannot reach the indexer Redis — this is a NEEDS-LEAD run.')
  process.exitCode = 1
})
