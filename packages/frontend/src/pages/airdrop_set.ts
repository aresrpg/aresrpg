// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE AIRDROP SET — the published showcase manifest's ONE door. The set itself is CONTENT: it is authored
// in the seed repo and reaches the game only as published data (`{host}/data/airdrop.json`), so this file
// knows the SHAPE of that document and nothing about its rows. No item list lives in this repo (#803).
//
// THE HOST IS NEVER HARDCODED HERE. The manifest resolves through the SDK's asset resolver exactly like
// every other published class (`{host}/data/{class}.json` — the mapping law in sdk/src/jobs.js), and each
// row's manifest-relative art path is re-homed onto that same origin. A row therefore cannot point the
// browser anywhere but our own host, whatever it says: the manifest is untrusted DATA.
//
// NOTHING IS CACHED — least of all absence. A dead request, a 404 and a malformed body all resolve to
// `status: 'error'`, which is a DIFFERENT state from a served set that happens to be empty; the page renders
// each honestly and a remount re-asks. An empty airdrop is a fact the host must state, never one we infer
// from a failure (the cache law).

import { asset_url } from '@aresrpg/sdk/jobs'

/** The published asset class carrying the airdrop showcase manifest. */
export const AIRDROP_SET_CLASS = 'airdrop'

/** One showcased item, already reduced to exactly what a tile renders. */
export type AirdropSetItem = {
  id: string
  /** `pet_glb` | `cosmetic` | `title_relic` | `outfit` — an unknown kind stays a kind, never a crash. */
  kind: string
  name: string
  /** The re-homed icon URL, or null when the row's art has no SERVED icon (the degradation contract). */
  icon_url: string | null
  aura: { color: string; status: string } | null
  aura_pending: boolean
}

/** A row the content house has not ruled on yet — shown as an explicit awaiting-ruling tile, never hidden. */
export type AirdropSetPending = { id: string; name: string }

export type AirdropSet = { items: AirdropSetItem[]; pending: AirdropSetPending[] }

/** What the door returns: an honest transport verdict beside the set it carries. */
export type AirdropSetLoad = { status: 'ready' | 'error'; set: AirdropSet }

const EMPTY_SET: AirdropSet = { items: [], pending: [] }

const as_record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const as_string = (value: unknown): string => (typeof value === 'string' ? value : '')

/** `sui_helmet` → `Sui Helmet`: an honest display name for a row that carries none. Pure. */
export function humanize_id(id: string): string {
  return id
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Re-home a manifest-relative art path onto the manifest's own ORIGIN ROOT: an absolute foreign URL loses
 * its origin and a `../` walk cannot climb above `/`. Host confinement by construction, not by trust.
 */
function rehome(path: string, manifest_url: string): string | null {
  try {
    const root = new URL('/', manifest_url)
    return new URL(new URL(path, root).pathname, root).href
  } catch {
    return null
  }
}

/**
 * The manifest body → the showcase set. PURE, and total: every malformed shape folds to an empty set and a
 * row with no `id` is dropped rather than becoming a nameless tile.
 *
 * THE DEGRADATION CONTRACT (#803): a row's icon is used ONLY when the manifest says that icon is actually
 * served (`art_status.icon === 'present'`) — art the host does not have yet must never become a broken
 * image. A `.glb` is never turned into an image URL: this page shows icons, so a glb-only row (every pet
 * today — the model corpus is unpublished host-wide) degrades to its kind glyph and says so.
 */
export function parse_airdrop_set(body: unknown, manifest_url: string): AirdropSet {
  const doc = as_record(body)
  const rows = Array.isArray(doc.items) ? doc.items : []
  const pending_rows = Array.isArray(doc.pending) ? doc.pending : []

  const items = rows.flatMap((raw): AirdropSetItem[] => {
    const row = as_record(raw)
    const id = as_string(row.id)
    if (!id) return []
    const art = as_record(row.art)
    const art_status = as_record(row.art_status)
    const icon = as_string(art.icon)
    const aura = as_record(row.aura)
    const color = as_string(aura.color)
    return [
      {
        id,
        kind: as_string(row.kind),
        name: as_string(row.name) || humanize_id(id),
        icon_url: icon && as_string(art_status.icon) === 'present' ? rehome(icon, manifest_url) : null,
        aura: color ? { color, status: as_string(aura.status) } : null,
        aura_pending: row.aura_pending === true,
      },
    ]
  })

  const pending = pending_rows.flatMap((raw): AirdropSetPending[] => {
    const row = as_record(raw)
    const id = as_string(row.id)
    // The reason a row is pending is internal content prose (rulings, sessions) — never player copy.
    return id ? [{ id, name: as_string(row.name) || humanize_id(id) }] : []
  })

  return { items, pending }
}

/**
 * Fetch the manifest and decode it. FAILURES FLOW AS DATA — an unpublished class, a dead request, a non-ok
 * response and a bad body all return `status: 'error'` with an empty set, which the page renders as a
 * visible failure row. It never throws, and it never lets a failure masquerade as "the airdrop is empty".
 * @param deps injectable fetch so the suite needs no network
 */
export async function load_airdrop_set({
  fetch_impl = globalThis.fetch,
}: { fetch_impl?: typeof fetch } = {}): Promise<AirdropSetLoad> {
  const url = asset_url(AIRDROP_SET_CLASS, `${AIRDROP_SET_CLASS}.json`)
  if (!url) return { status: 'error', set: EMPTY_SET }
  try {
    const response = await fetch_impl(url)
    if (!response.ok) return { status: 'error', set: EMPTY_SET }
    return { status: 'ready', set: parse_airdrop_set(await response.json(), url) }
  } catch {
    return { status: 'error', set: EMPTY_SET }
  }
}
