// #96 LOCAL ITEM AUTHORING — browser client for the DEV-ONLY `local_content_plugin` middleware. The
// admin item editor authors items into the repo's seed JSON + local PNGs through here, sees them badged
// LOCAL-ONLY vs ON-CHAIN, then publishes (mint PTB + this module's bucket upload). Guarded by `LOCAL_AUTHORING`
// (import.meta.env.DEV): in a production build the middleware doesn't exist, so authoring is unavailable and the
// admin shows chain items only — exactly like before this feature. The browser NEVER touches the FS or bucket
// directly; every call is a POST/GET to a fixed dev endpoint.

// True only in the dev server, where the middleware is mounted. Rollup keeps the const; the DEV checks guard the
// fetches so a prod bundle never calls a dead endpoint.
export const LOCAL_AUTHORING = import.meta.env.DEV

/** GET the full local catalog (seed/production/release_items.json). Returns [] outside dev or on any failure. */
export async function read_local_items() {
  if (!LOCAL_AUTHORING) return []
  try {
    const res = await fetch('/__local_items')
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * #96 GET the full seeded bestiary (seed/production/release_bestiary.json) so the admin mob list shows
 * ALL seeded mobs badged LOCAL vs ON-CHAIN — same read-only shape as read_local_items. Returns [] outside dev
 * or on any failure. There is no mob-authoring/publish counterpart (mobs are display-only in the admin).
 */
export async function read_local_mobs() {
  if (!LOCAL_AUTHORING) return []
  try {
    const res = await fetch('/__local_mobs')
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** Upsert (by id) an authored item into the local seed JSON. Throws (humanized upstream) on failure. */
export async function save_local_item(item) {
  if (!LOCAL_AUTHORING) throw new Error('Local authoring is only available in the dev server')
  if (!item?.id) throw new Error('item.id is required')
  const res = await fetch('/__save_item', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(item),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `save_item failed (${res.status})`)
  return body
}

/** Write a generated PNG (raw bytes) to the local image dir. `hd` picks the {id}_hd.png variant. */
export async function save_local_item_image(id, bytes, hd = false) {
  if (!LOCAL_AUTHORING) throw new Error('Local authoring is only available in the dev server')
  const res = await fetch(`/__save_item_image?id=${encodeURIComponent(id)}&hd=${hd ? 1 : 0}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `save_item_image failed (${res.status})`)
  return body
}

/**
 * Upload the item's local PNG(s) to the image storage bucket, skipping any variant already present.
 * Returns { normal, hd } each one of 'uploaded' | 'skipped' | 'missing'.
 */
export async function publish_item_image(id) {
  if (!LOCAL_AUTHORING) throw new Error('Image upload is only available in the dev server')
  const res = await fetch(`/__publish_item_image?id=${encodeURIComponent(id)}`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `publish_item_image failed (${res.status})`)
  return body
}

/** Dev URL that serves a locally-authored PNG before it reaches the bucket (ItemImage fallback candidate). */
export function local_item_image_url(id, hd = false) {
  if (!LOCAL_AUTHORING || !id) return null
  return `/__local_item_image?id=${encodeURIComponent(id)}&hd=${hd ? 1 : 0}`
}
