// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Geometry is asset-host-only. A relative fallback is not a model fallback in a SPA: the rewrite can answer it
// with index.html and a misleading 200, leaving Three.js to fail far away from the actual publication gap.

import { canonical_asset_url, asset_url } from '@aresrpg/sdk/jobs'

/** Missing model keys already reported this session; model resolution can run every frame. */
const reported_model_gaps = new Set()

/** @param {unknown} value @returns {value is string} */
function is_absolute_model_url(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Resolve one published geometry asset. An unpublished class is an explicit, deduped error and `null`, never
 * a same-origin path that the SPA can rewrite to HTML.
 * @param {string} url_class
 * @param {string} filename
 * @param {(url_class:string, filename:string) => string | null} [resolve_asset]
 * @returns {string | null}
 */
export function model_asset_url(url_class, filename, resolve_asset = asset_url) {
  const url = resolve_asset(url_class, filename)
  if (is_absolute_model_url(url)) return url
  const key = `${url_class}\u0000${filename}`
  if (!reported_model_gaps.has(key)) {
    reported_model_gaps.add(key)
    console.error(
      `[model-asset] unavailable: class="${url_class}" file="${filename}" is unpublished or unresolvable; model stays in its error/placeholder state`
    )
  }
  return null
}

/**
 * Accept runtime model URLs only after re-homing an absolute URL onto the configured asset host. The sole
 * relative exception is the explicit `/models/**` authoring path in a Vite DEV session; it is not a fallback.
 * @param {unknown} value
 * @param {{ allow_dev_models?: boolean }} [opts]
 * @returns {string | null}
 */
export function canonical_model_source_url(value, { allow_dev_models = false } = {}) {
  if (typeof value !== 'string' || !value) return null
  const canonical = canonical_asset_url(value)
  if (is_absolute_model_url(canonical)) return canonical
  if (allow_dev_models && import.meta.env.DEV && value.startsWith('/models/') && !value.startsWith('//'))
    return value
  console.error(`[model-asset] refused non-canonical model URL "${value}"; model stays in its error/placeholder state`)
  return null
}

/** Test isolation for the session-level missing-model log dedupe. */
export function reset_model_asset_errors_for_test() {
  reported_model_gaps.clear()
}
