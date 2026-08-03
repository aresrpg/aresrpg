// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MANIFEST RECEIPT WRITE-BACK (SHOP TRIO (a) root fix, 2026-07-17). The 2026-07-16 reauthor ceremony
// (apply_shop_payload.mjs + box_reauthor.mjs) burned 5 live sales and minted FRESH replacement
// templates — and never wrote the fresh ids back into out/seed_manifest.json. The frontend's
// living-corpus fence whitelists shop sales BY MANIFEST ID (read_shop_sales.js:89 →
// living_corpus.ts), so all 5 corrected sales (3 pet boxes + the momaku/enka_muru cloaks) vanished
// from the shop UI while staying fully buyable on-chain (seed_manifest_receipt.test.mjs is the repro).
//
// THE RECEIPT LAW this module enforces: seed_manifest.json is the ceremony's OUTPUT — a receipt of
// the LIVING template generation — never its input. Reauthor op sets pin the incident's old ids
// explicitly (next to the ratified prices), and every LIVE run writes the corrected
// slug→template-id rows back IN THE SAME RUN that mints (or first observes) them. DRY_RUN reports
// the pending rows and writes nothing. Pure helpers are unit-tested with mocked mint receipts
// (manifest_writeback.test.mjs); the single fs write lives in apply_manifest_writeback.

import { writeFileSync } from 'node:fs'

const is_id = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '')

/** The ONE ItemTemplate created by a reauthor tx receipt (ceremony_lib normalizeReceipt shape).
 * Throws on 0 or >1 — a guessed template id would corrupt the manifest receipt silently. */
export function created_template_id(receipt) {
  const created = (receipt?.objectChanges ?? []).filter(
    (change) => change.type === 'created' && String(change.objectType ?? '').endsWith('::item::ItemTemplate')
  )
  if (created.length !== 1)
    throw new Error(`expected exactly 1 created ItemTemplate in tx ${receipt?.digest}, found ${created.length}`)
  return created[0].objectId
}

/** Merge plan-time receipt rows with post-execution mint receipts → [{ slug, template_id }].
 * A slug resolving twice is a plan bug — throw, never guess which id is the living one. */
export function writeback_rows({ manifest_receipt = [], minted = [] }) {
  const rows = [
    ...manifest_receipt,
    ...minted.map(({ slug, receipt }) => ({
      slug,
      template_id: created_template_id(receipt),
    })),
  ]
  const seen = new Set()
  for (const { slug } of rows) {
    if (seen.has(slug)) throw new Error(`manifest write-back resolved two template ids for ${slug}; refusing to guess`)
    seen.add(slug)
  }
  return rows
}

/** Pure diff of receipt rows against the manifest items map. Unknown slugs / malformed ids throw
 * (the receipt may only REFRESH rows the seed actually created); identical rows drop out. */
export function compute_manifest_writeback(seed_manifest, rows) {
  const items = seed_manifest?.items
  if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('seed manifest has no items map')
  const changes = []
  for (const { slug, template_id } of rows) {
    if (!is_id(template_id)) throw new Error(`write-back for ${slug}: invalid template id ${template_id}`)
    if (!is_id(items[slug]))
      throw new Error(`write-back for ${slug}: slug has no manifest item row — the receipt only refreshes seeded rows`)
    if (items[slug] !== template_id) changes.push({ slug, from: items[slug], to: template_id })
  }
  return changes
}

/** The ceremony's receipt maintenance. LIVE: rewrites the manifest byte-stable with the seeder's own
 * serializer (2-space JSON, no trailing newline — verified round-trip). DRY_RUN: reports only. */
export function apply_manifest_writeback({ manifest_path, seed_manifest, rows, live, log = console.log }) {
  const changes = compute_manifest_writeback(seed_manifest, rows)
  if (!changes.length) {
    log('  manifest receipt: fresh (0 rows to write)')
    return changes
  }
  for (const { slug, from, to } of changes)
    log(`  manifest receipt: ${slug} ${from} -> ${to}${live ? '' : ' (pending, DRY_RUN)'}`)
  if (!live) return changes
  const next = { ...seed_manifest, items: { ...seed_manifest.items } }
  for (const { slug, to } of changes) next.items[slug] = to
  writeFileSync(manifest_path, JSON.stringify(next, null, 2))
  log(`  manifest receipt: WROTE ${changes.length} row(s) to ${manifest_path}`)
  return changes
}
