// TR-97 — SSOT for cosmetic / mount 3D-model resolution + mount detection.
//
// Models are convention-linked, not stored as on-chain URLs (no Move change is in scope). Mount authoring
// uses `cosmetics/<template_id>.glb`; shipped worn cosmetics use the Walrus quilt's
// `cosmetics/<appearance>.glb` plus an optional KHR material variant. This is the one resolution home for
// both conventions; the actual hat/cloak attachment stays in engine create_worn_cosmetics.
//
// TRAILER (dev) path: `?mount=<name|models-path>` forces a mount off a repo `./models` GLB served by the
// dev middleware at `/models/**` — so a dev can ride ANY authored model on the spot, no mint
// needed (mirrors `?dragon=1` / `?biome=` and the existing `__force_mount` DEV hooks).

import { legacy_cosmetic_variants } from '@aresrpg/sdk/deployment/aresrpg'
import { canonical_walrus_asset_url, walrus_asset_url } from '@aresrpg/sdk/jobs'

import { ASSETS_URL } from '../env'
import { get_encyclopedia } from '../rpc/client'

import { cosmetic_icon_of } from './cosmetic_icons.js'
import { mount_speed_multiplier } from './mount_speed.js'

// Call-time read on purpose: vite statically inlines `import.meta.env.DEV` (true in dev serve,
// false in prod builds — the QA branches stay dead there), while bun tests can toggle the QA
// paths per-call via process.env.DEV instead of racing the process-global module registry.
const is_dev = () => Boolean(import.meta.env.DEV)

// ── MOUNT WORLD SIZE (the code must stay author-agnostic — GLB author units are inconsistent, a raw
// siluri renders cow-sized). Per-mount target height in WORLD BLOCKS; the rig normalises every mount to
// this (scale = target_h / measured bbox height — the ambient_mobs SPAWN_TABLE target_h pattern). ONE
// home read by BOTH rider paths (local embed_voxel + remote_players ride the same create_mount_rig).
// Ruler: the player avatar is 1.5 blocks — a ridden mount should put the seated head ~2.5-3 blocks.
/** @type {Record<string, number>} */
export const MOUNT_TABLE = {
  // small birds / critters
  corbac: 1.1,
  mosho: 1.1,
  zot: 1.05,
  yago: 1.0,
  // mid quadrupeds / swimmers
  suicune: 1.9,
  vaporeon: 1.7,
  talokan: 1.7,
  krinan: 1.7,
  siluri: 1.6,
  suifren_capy: 1.7,
  suifren_bullshark: 1.8,
  pet_beru: 1.6,
  oeuftermath: 1.9,
  // fast-travel dragons (skin is user-selectable; fire = default) — the biggest sane rideable size, tunable
  // (plan §1/⑤; capped at the table's 2.2 rideable ceiling — the cosmetic_glb range invariant)
  'dragon-fire': 2.2,
  'dragon-frost': 2.2,
  'dragon-void': 2.2,
}
export const MOUNT_FALLBACK_H = 1.6 // unknown ids ride at a sane mid-quadruped height

/**
 * Target world height (blocks) for a mount GLB — keyed by the URL's file stem (`.../pet/corbac.glb` and
 * `${ASSETS_URL}/cosmetics/corbac.glb` both resolve 'corbac'); unknown stems fall back to MOUNT_FALLBACK_H.
 * @param {string | null | undefined} glb_url @returns {number}
 */
export function mount_target_height(glb_url) {
  const stem =
    String(glb_url ?? '')
      .split(/[?#]/)[0]
      ?.split('/')
      .pop()
      ?.replace(/\.glb$/i, '')
      .toLowerCase() ?? ''
  return MOUNT_TABLE[stem] ?? MOUNT_FALLBACK_H
}

/**
 * A repo `./models` GLB URL, served in DEV by the vite `cosmetic_glb_dev_plugin` at `/models/**`. `spec` is
 * either a bare NAME ('suicune' → `models/pet/suicune.glb`, since mounts are authored under models/pet)
 * or an explicit models-relative PATH ('pet/suicune.glb', 'equipment/drakar.glb'). Returns null for empty.
 * @param {string} spec @returns {string | null}
 */
export function models_dev_url(spec) {
  if (!spec) return null
  let path = String(spec).trim().replace(/^\/+/, '')
  if (!path) return null
  if (!/\.glb$/i.test(path)) path = `pet/${path}.glb` // bare name → a pet-folder mount (the authoring convention)
  return `/models/${path}`
}

/**
 * The identifier-derived served model URL for a cosmetic / mount item. Worn cosmetics pass their quilt
 * `appearance` slug here; author-linked mounts may still pass a template slug/id by convention.
 * `${ASSETS_URL}/cosmetics/<identifier>.glb`. @param {string} identifier @returns {string | null}
 */
export function cosmetic_glb_url(identifier) {
  if (!identifier) return null
  // Walrus (boot manifest) first — the decentralized home — else the CDN (progressive migration).
  return walrus_asset_url('cosmetic', `${identifier}.glb`) ?? `${ASSETS_URL}/cosmetics/${identifier}.glb`
}

/**
 * A DEV worn-cosmetic override value → a served `/models` GLB URL. An explicit `.glb` (with or without a
 * folder) streams verbatim (`equipment/cape_fuwa.glb` → `/models/equipment/cape_fuwa.glb`); a bare name
 * defaults to the equipment folder the shop cosmetics live in (`sui_helmet` → `/models/equipment/sui_helmet.glb`);
 * a full URL / absolute path passes through. Null for empty. @param {string} spec @returns {string | null}
 */
export function worn_dev_url(spec) {
  if (!spec) return null
  const raw = String(spec).trim()
  if (!raw) return null
  const walrus_url = canonical_walrus_asset_url(raw)
  if (walrus_url) return walrus_url
  if (/^(https?:)?\//i.test(raw)) return raw // already a URL / absolute served path
  const rel = raw.replace(/^\/+/, '')
  if (/\.glb$/i.test(rel)) return `/models/${rel}` // explicit models-relative path
  return `/models/equipment/${rel}.glb` // bare slug → the shop-cosmetic folder
}

/** The equipped-slot fields a worn item may live on, per RENDER slot (precedence order) — the legacy pair
 *  ONLY (player_equipment.js watches hat + cloak; entities.js equips exactly those two) plus their on-chain
 *  cosmetic_* vocab (ITEM_CATEGORY). A cosmetic hat renders INSTEAD of any headgear (seam 8, SPEC §7.11);
 *  combat gear (helmet/chestplate/weapons) uses the vanilla appearance system, NOT a worn GLB (local_glb.js).
 *  @type {Record<'head'|'back', readonly string[]>} */
const WORN_SLOTS = /** @type {const} */ ({
  head: ['hat', 'cosmetic_hat', 'cosmetic_helmet'],
  back: ['cloak', 'cosmetic_cloak'],
})

/** @typedef {{ appearance:string, variant:string|null }} WornModel */

/** Index `/v1/encyclopedia` item rows by their canonical ItemTemplate object id. Pure/testable; the map is the
 *  missing join between `Character.worn.*.template_id` (0x id) and the template Display name.
 * @param {any[]} items @returns {Map<string, any>} */
export function index_worn_templates(items) {
  return new Map((items ?? []).map((item) => [String(item.template_id ?? ''), item]).filter(([id]) => id))
}

/** Load the template side of the worn join through the keyless `/v1` read layer. `get_encyclopedia` already
 * owns the app-lifetime catalog cache and evicts rejected loads; one bounded second read heals a transient
 * rejection without introducing a parallel cache or a permanent retry loop.
 * @returns {Promise<Map<string, any>>} */
export async function read_worn_templates() {
  const read = async () => index_worn_templates((await get_encyclopedia('items')).items)
  try {
    return await read()
  } catch {
    return read()
  }
}

/** Resolve one equipped item to the cosmetic quilt's base appearance + optional KHR material variant. The
 *  seed's existing cosmetic-icon projection is the identity bridge because `/v1` exposes Display name but not
 *  seed slug/appearance: its canonical icon keys are either `<appearance>` or `<appearance>-<skin>` for every
 *  wearable. This deliberately never treats the generic item_type (`hat`/`cloak`) as an identity.
 * @param {any} item @param {Map<string, any>} [templates] @returns {WornModel|null} */
export function worn_model_of(item, templates = new Map()) {
  if (!item || typeof item !== 'object') return null
  const template_id = String(item.template_id ?? item.template ?? '')
  const template = template_id ? templates.get(template_id) : null

  // Future/read-authoring shape: an explicit appearance is already the quilt key and needs no catalog join.
  const appearance = item.appearance ?? template?.appearance
  if (typeof appearance === 'string' && appearance)
    return {
      appearance,
      variant: String(item.variant ?? item.skin ?? template?.variant ?? template?.skin ?? '') || null,
    }

  // Stable legacy template identities resolve before mutable encyclopedia Display names.
  const legacy_model = Object.hasOwn(legacy_cosmetic_variants, template_id)
    ? legacy_cosmetic_variants[template_id]
    : null
  if (legacy_model)
    return {
      appearance: legacy_model.appearance,
      variant: legacy_model.variant,
    }

  // Back-compat test/admin shapes sometimes carry the seed slug in template_id. Feed it as `slug` for the
  // authored map.
  // 'Corbac Helmet' deliberately resolves NOTHING here: the corbac duplicate was reconciled to the
  // single corbac_head instance (2026-07-17) — the minted helmet template (0 ever sold, sale delisted) is
  // ceremony-rider'd in docs/REPUBLISH_CHECKLIST.md, never aliased back to life client-side.
  const direct = cosmetic_icon_of({ ...item, slug: item.slug ?? template_id })
  const icon = direct ?? cosmetic_icon_of(template)
  if (!icon) return null
  const split = icon.lastIndexOf('-')
  return split > 0
    ? { appearance: icon.slice(0, split), variant: icon.slice(split + 1) || null }
    : { appearance: icon, variant: null }
}

/**
 * The worn hat/cloak model specs for a character's equipped cosmetics — `{ head, back }`, each
 * `{ url, variant }` or null (the legacy player_equipment pair, nothing more). LIVE: `/v1/characters` resolves
 * each equipped cosmetic's category and serves it under `worn` (hat/cloak); `/v1/encyclopedia` joins its 0x
 * template id to Display name, then worn_model_of maps that stable identity to the quilt appearance. The DEV
 * `?equip=head:sui_helmet,back:equipment/cape_fuwa.glb` query or `window.__force_equip` ({ head, back } of
 * slug|path|url) still overrides (the QA path). Pure over the supplied read models. An equipped item that resolves NO
 * slug renders nothing (the load .catch in create_worn_cosmetics is the loud-fail on a missing GLB — no
 * placeholder, per the no-silent-substitute law).
 * @param {any} character the live selected character (carries worn/hat/cloak from the /v1 read-model)
 * @param {Map<string, any>} [templates] `/v1/encyclopedia` items keyed by template object id
 * @param {string} [search] the URL query string (defaults to the live location — injectable for tests)
 * @returns {{ head: {url:string,variant:string|null}|null, back: {url:string,variant:string|null}|null }}
 */
export function resolve_worn_cosmetics(character, templates = new Map(), search) {
  /** @type {{ head: {url:string,variant:string|null}|null, back: {url:string,variant:string|null}|null }} */
  const out = { head: null, back: null }
  // DEV override wins (QA path — no chain equip needed), mirroring resolve_mount's `?mount=` / `__force_mount`.
  if (is_dev()) {
    const query = search ?? (typeof location !== 'undefined' ? location.search : '')
    const forced = /** @type {any} */ (typeof window !== 'undefined' ? window.__force_equip : null)
    const from_query = new URLSearchParams(query).get('equip')
    // Only the two rig slots are ever honored — the slot key comes straight from location.search /
    // window, so an arbitrary key must never become a property write (js/remote-property-injection).
    /** @type {{ head?: string, back?: string }} */ const spec = {}
    if (forced && typeof forced === 'object') {
      if (forced.head) spec.head = String(forced.head)
      if (forced.back) spec.back = String(forced.back)
    }
    if (from_query)
      for (const pair of from_query.split(',')) {
        const [slot, val] = pair.split(':')
        const key = slot?.trim()
        const value = val?.trim()
        if (!value) continue
        if (key === 'head') spec.head = value
        else if (key === 'back') spec.back = value
      }
    if (spec.head || spec.back) {
      for (const slot of /** @type {('head'|'back')[]} */ (Object.keys(out)))
        if (spec[slot]) {
          const url = worn_dev_url(spec[slot])
          if (url) out[slot] = { url, variant: null }
        }
      return out
    }
  }
  // Live path — nested `worn` is authoritative; rpc_to_card's flat spread remains a back-compat fallback.
  if (!character) return out
  const worn = character.worn && typeof character.worn === 'object' ? character.worn : null
  for (const slot of /** @type {('head'|'back')[]} */ (Object.keys(WORN_SLOTS))) {
    for (const field of WORN_SLOTS[slot]) {
      const item = worn ? worn[field] : character[field]
      const model = worn_model_of(item, templates)
      if (model) {
        const url = cosmetic_glb_url(model.appearance)
        if (url) out[slot] = { url, variant: model.variant }
        break
      }
    }
  }
  return out
}

/**
 * Is this item a MOUNT? (category vocab: lowercase 'mount' — see read_templates.js CATEGORIES). Tolerant of
 * the item shape (category / type / item_type) so it reads a template row OR an equipped-slot item alike.
 * @param {any} item @returns {boolean}
 */
export function is_mount_item(item) {
  if (!item || typeof item !== 'object') return false
  const cat = String(item.category ?? item.type ?? item.item_type ?? '').toLowerCase()
  return cat === 'mount'
}

/**
 * Resolve the mount a character can ride THIS session. The DEV `?mount=` override wins (the trailer path);
 * otherwise the character's equipped `.mount` slot — forward-compatible with the cosmetic-equip republish
 * (today the chain read carries no such slot, so the equip branch is inert until then, exactly like the
 * veteran-title aura). Pure; safe on a null character.
 * @param {any} character the live selected character (may carry a `.mount` equip slot post-republish)
 * @param {string} [search] the URL query string (defaults to the live location — injectable for tests)
 * @returns {{ available: boolean, glb_url: string | null, source: 'dev' | 'equip' | null }}
 */
export function resolve_mount(character, search) {
  const query = search ?? (typeof location !== 'undefined' ? location.search : '')
  if (is_dev()) {
    const v = new URLSearchParams(query).get('mount')
    if (v) return { available: true, glb_url: models_dev_url(v), source: 'dev' }
  }
  // Equip slot (forward-compat): an item-like value in `.mount` grants the ride — reuse the SAME item-like
  // gate the speed selector uses, so a stray scalar never counts. GLB = the item's own ref, else convention.
  const item = character?.mount
  if (mount_speed_multiplier(character) > 1) {
    const template_id = item?.template_id ?? item?.item_type ?? item?.id
    const explicit = item && (item.glb || item.glb_url)
    const explicit_local =
      typeof explicit === 'string' && explicit.startsWith('/') && !explicit.startsWith('//') ? explicit : null
    // Runtime/on-chain refs are untrusted: a Walrus blob path is re-homed onto the manifest CDN, a same-origin
    // authoring path stays local, and every other absolute host is discarded in favour of the template convention.
    const glb = canonical_walrus_asset_url(explicit) || explicit_local || cosmetic_glb_url(template_id)
    return { available: true, glb_url: glb, source: 'equip' }
  }
  return { available: false, glb_url: null, source: null }
}

// DEV SCREENSHOT TOOL: `?avatar=<key>` swaps the LOCAL player's rendered body for a
// preview rig — e.g. `primemachin`, the reserved full-body outfit (`models/equipment/primemachin.glb`,
// docs/PET_SHOP_MAP.md §8.3 — "titles that swap the full body, later"; this flag previews that future
// system early, no mint/republish needed). An explicit allowlist, NOT a raw `?mount=`-style path passthrough
// — this is a screenshot utility for named rigs added on request, not a general model loader (an
// arbitrary equipment prop like a sword isn't a viable full-body swap). Exempt from the no-flags-by-default
// law (dev-utility class, never a shipped feature). Add a row here to name another rig.
/** @type {Record<string, string>} */
const DEV_AVATAR_MODELS = {
  primemachin: 'equipment/primemachin.glb',
}

/**
 * DEV-only local-player avatar override. Read ONCE at player boot (embed_voxel_player.js) — never re-read
 * per frame, so it can't fight the live character rig. An unrecognised key returns null (one console.warn)
 * so the caller falls back to the real class rig — never a crash, never a permanently-invisible player.
 * @param {string} [search] the URL query string (defaults to the live location — injectable for tests)
 * @returns {string | null} a served `/models/**` GLB URL, or null (no override / DEV off / unknown key).
 */
export function resolve_avatar_override(search) {
  if (!is_dev()) return null
  const query = search ?? (typeof location !== 'undefined' ? location.search : '')
  const key = new URLSearchParams(query).get('avatar')
  if (!key) return null
  const rel = DEV_AVATAR_MODELS[key]
  if (!rel) {
    console.warn(`[avatar] unknown ?avatar= '${key}' — known: ${Object.keys(DEV_AVATAR_MODELS).join(', ')}`)
    return null
  }
  return `/models/${rel}`
}
