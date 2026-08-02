// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Versioned runtime-corpus fetch seam (#1237). Payload URLs are immutable; only the pointer moves.
import { asset_url } from '@aresrpg/sdk/jobs'

const pointer_filename = 'corpus_version.json'
const version_pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

// PRIVATE SEED-SIDE PUBLISH CONTRACT:
//   1. PUT `data/spell_corpus.<version>.json` AND `data/world_corpus.<version>.json`, where `version`
//      matches `version_pattern`; serve both with `Cache-Control: public, max-age=31536000, immutable`.
//   2. After both PUTs succeed, atomically replace `data/corpus_version.json` with exactly
//      `{ "version": "<version>" }`; serve the pointer uncached or with a short TTL + must-revalidate.
//   3. Never overwrite or delete an old version during the flip: an in-flight client that read the prior
//      pointer must still be able to fetch both prior payloads.
// The client also requests the pointer with `cache: no-store`; the response policy above is still required
// because the CDN, not just the browser cache, must revalidate the mutable object.

/**
 * The corpus class's base URL on the asset host — the resolution BASE the pointer and every versioned payload
 * URL below are built against, never a URL a loader fetches (#1739: the unversioned object is a prior
 * publish, so reading it is reading a dead deployment; the pointer is the one source). Deliberately private.
 * @param {'spell_corpus' | 'world_corpus'} corpus_name
 * @returns {string | null}
 */
const corpus_base_url = (corpus_name) => asset_url(corpus_name, `${corpus_name}.json`)

const published_corpus_url = () => corpus_base_url('spell_corpus') ?? corpus_base_url('world_corpus')

/** Decode the pointer's intentionally tiny wire format; null is invalid data, never a guessed version. */
export const decode_corpus_version = (pointer) => {
  const version = pointer?.version
  return typeof version === 'string' && version_pattern.test(version) ? version : null
}

/**
 * Read the one mutable corpus pointer. Returns null only when neither corpus class is published.
 * HTTP and format failures throw at this fetch boundary so each loader can degrade loudly and retry later.
 * @param {typeof fetch} [fetch_impl]
 * @returns {Promise<string | null>}
 */
export async function load_corpus_version(fetch_impl = globalThis.fetch) {
  const corpus_url = published_corpus_url()
  if (!corpus_url) return null
  const url = new URL(pointer_filename, corpus_url).href
  const response = await fetch_impl(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`corpus pointer HTTP ${response.status}`)
  const version = decode_corpus_version(await response.json())
  if (!version) throw new Error('corpus pointer must be { "version": "<URL-safe version>" }')
  return version
}

/**
 * Resolve one immutable payload URL from the already-read pointer version.
 * @param {'spell_corpus' | 'world_corpus'} corpus_name
 * @param {string} version
 * @returns {string | null}
 */
export function versioned_corpus_url(corpus_name, version) {
  const safe_version = decode_corpus_version({ version })
  if (!safe_version) throw new Error('invalid corpus version')
  const base_url = corpus_base_url(corpus_name)
  return base_url ? new URL(`${corpus_name}.${safe_version}.json`, base_url).href : null
}
