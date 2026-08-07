// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** The one derivation from a mob catalog key to its published icon filename. */
export function mob_icon_filename(key, { hd = false } = {}) {
  if (typeof key !== 'string' || !key || !/^[a-z0-9_.-]+$/i.test(key))
    throw new TypeError('mob_icon_filename requires a non-empty catalog key')
  return `${key}${hd ? '_hd' : ''}.png`
}

/**
 * Expand a merged mob catalog into the exact files a complete icon publish must contain. A missing `glb`
 * field is an unverifiable publish input and throws; an explicit null is an honest no-model/no-icon row.
 * @param {Record<string, { glb?: string | null } | undefined>} catalog
 */
export function mob_icon_publish_plan(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
    throw new TypeError('mob icon publish requires a catalog object')
  const plan = []
  for (const [key, row] of Object.entries(catalog)) {
    if (!row || !Object.hasOwn(row, 'glb'))
      throw new TypeError(`mob icon catalog row "${key}" is missing glb`)
    if (row.glb === null) continue
    if (typeof row.glb !== 'string' || !row.glb)
      throw new TypeError(`mob icon catalog row "${key}" has an invalid glb`)
    plan.push({
      key,
      glb: row.glb.replace(/\.glb$/i, ''),
      thumb: mob_icon_filename(key),
      hd: mob_icon_filename(key, { hd: true }),
    })
  }
  return plan
}

/** Throw when a rendered/uploaded file list cannot prove every catalog-key icon is present. */
export function assert_mob_icon_publish_complete(catalog, published_files) {
  if (!published_files || typeof published_files[Symbol.iterator] !== 'function')
    throw new TypeError('mob icon publish verification requires an iterable file inventory')
  const files = new Set(published_files)
  const missing = mob_icon_publish_plan(catalog).flatMap(({ thumb, hd }) =>
    [thumb, hd].filter((filename) => !files.has(filename))
  )
  if (missing.length)
    throw new Error(`mob icon publish incomplete: missing ${missing.length} file(s): ${missing.slice(0, 8).join(', ')}`)
  return true
}
