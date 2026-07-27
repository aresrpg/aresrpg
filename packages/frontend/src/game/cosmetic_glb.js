// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TR-97 — SSOT for cosmetic / mount 3D-model resolution + mount detection.
//
// Models are convention-linked, not stored as on-chain URLs (no Move change is in scope). Mount authoring
// uses `cosmetics/<template_id>.glb`; shipped worn cosmetics use the asset-host quilt's
// `cosmetics/<appearance>.glb` plus an optional KHR material variant. This is the one resolution home for
// both conventions; the actual hat/cloak attachment stays in engine create_worn_cosmetics.
//
// TRAILER (dev) path: `?mount=<name|models-path>` forces a mount off a repo `./models` GLB served by the
// dev middleware at `/models/**` — so a dev can ride ANY authored model on the spot, no mint
// needed (mirrors `?dragon=1` / `?biome=` and the existing `__force_mount` DEV hooks).

import { legacy_cosmetic_variants } from '@aresrpg/sdk/deployment/aresrpg'
import { canonical_asset_url } from '@aresrpg/sdk/jobs'

import { seed_manifest } from '../content/seed_manifest'

import { cosmetic_icon_of } from './cosmetic_icons.js'
import { canonical_model_source_url, model_asset_url } from './model_asset_url.js'
import { mount_speed_multiplier } from './mount_speed.js'
import { resolve_pet_companion } from './pet_companion_resolver.js'

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
  // fast-travel dragons (skin is user-selectable; fire = default) — a DELIBERATE exception to the 2.2
  // rideable ceiling below (#175 second live report: "reads a bit bigger than current" — bumped from the
  // old 2.2 ceiling to ~1.36×, cinematic-tier, still bounded by cosmetic_glb.test.js's dedicated dragon check)
  'dragon-fire': 3,
  'dragon-frost': 3,
  'dragon-void': 3,
}
export const MOUNT_FALLBACK_H = 1.6 // unknown ids ride at a sane mid-quadruped height

/** Pick the idle/move clip PAIR by name convention. Ground vocabulary: run/walk/move/hop/gallop. Flight
 *  vocabulary: fly/flap/wing (the sky_dragon.js ambient dragon's own proven names — #175: mount_rig's old
 *  fly-only fallback missed a plain "Flap"/"Wing" clip name, silently falling through to the fragile
 *  clips[1] positional guess). `flight` (mount_is_flight — a dragon is ridden airborne only) flips which
 *  vocabulary wins when a model ships BOTH: the 2026-07-28 dragon-fire re-author added a real `fly` loop next
 *  to its `walk`, and a flying dragon must not run in mid-air. Either way the other vocabulary is still the
 *  fallback, so a flight mount with no fly clip keeps its gait (dragon-frost) and a ground mount whose only
 *  loop is a hover keeps working (corbac). Pure — no mixer, no GLB.
 *  @param {{name:string}[]} clips @param {{ flight?: boolean }} [opts]
 *  @returns {{ idle: {name:string}|null, move: {name:string}|null }} */
export function pick_mount_clips(clips, { flight = false } = {}) {
  const idle = clips.find((/** @type {any} */ c) => /idle/i.test(c.name)) ?? clips[0] ?? null
  const gait = clips.find((/** @type {any} */ c) => /run|walk|move|hop|gallop/i.test(c.name)) ?? null
  const air = clips.find((/** @type {any} */ c) => /fly|flap|wing/i.test(c.name)) ?? null
  const move = (flight ? [air, gait] : [gait, air]).find(Boolean) ?? (clips.length > 1 ? clips[1] : null)
  return { idle, move: move && move !== idle ? move : null }
}

// FLIGHT MOUNTS — ridden ONLY in the air (the fast-travel dragons: the pilot spawns one at takeoff and
// disposes it on touchdown, so every frame of their rig's life is airborne). The one thing this changes is
// the animation loop mount_rig.js picks: a flight mount prefers its fly/flap/wing clip over a walk/run gait,
// where a ground mount keeps preferring the gait. Keyed by the same file stem as MOUNT_TABLE.
const FLIGHT_MOUNTS = new Set(['dragon-fire', 'dragon-frost', 'dragon-void'])

/** The MOUNT_TABLE key a mount GLB URL resolves to — its file stem, lowercased (`.../pet/corbac.glb` and
 *  `<asset-host>/models/cosmetics/corbac.glb?v=2` both resolve 'corbac'). @param {string|null|undefined} glb_url */
export const mount_stem = (glb_url) =>
  String(glb_url ?? '')
    .split(/[?#]/)[0]
    ?.split('/')
    .pop()
    ?.replace(/\.glb$/i, '')
    .toLowerCase() ?? ''

/**
 * Target world height (blocks) for a mount GLB — keyed by the URL's file stem; unknown stems fall back to
 * MOUNT_FALLBACK_H.
 * @param {string | null | undefined} glb_url @returns {number}
 */
export function mount_target_height(glb_url) {
  return MOUNT_TABLE[mount_stem(glb_url)] ?? MOUNT_FALLBACK_H
}

/**
 * Is this mount GLB ridden in the air? Unknown stems are ground mounts. @param {string | null | undefined}
 * glb_url @returns {boolean}
 */
export function mount_is_flight(glb_url) {
  return FLIGHT_MOUNTS.has(mount_stem(glb_url))
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
 * Asset host `cosmetics/<identifier>.glb`. @param {string} identifier @returns {string | null}
 */
export function cosmetic_glb_url(identifier) {
  if (!identifier) return null
  // Asset-host ONLY — geometry has no relative fallback (the SPA rewrite would answer a missing GLB with
  // index.html at status 200); an unpublished `cosmetic` class returns null and the caller stays honest.
  return model_asset_url('cosmetic', `${identifier}.glb`)
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
  const canonical_url = canonical_asset_url(raw)
  if (canonical_url) return canonical_url
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

/** RECOLORED KHR material variants — the seed's stable slug/Display-name vocabulary (mirrored in
 *  cosmetic_icons.js, never hand-edited here — it's a generator SSOT with its own coverage test) keeps
 *  saying "vitality"/"wisdom" forever; only the material variant id baked into the SHIPPED .glb changes
 *  when an item gets recolored. ONE mapping home for that translation, keyed by appearance so a renamed
 *  word never leaks onto an unrelated cosmetic that still ships the old literal variant (e.g. cape_lorito's
 *  own "vitality"/"wisdom" KHR variants are untouched by the Bara recolor — only their shop BADGE label
 *  changed, see shop_gems.ts's LORITO_LEGACY_GEM_KEY). Old variant words are permanent valid INPUTS — a
 *  legacy Display name or a saved selection is never a dead end, it just resolves through this map.
 * @type {Record<string, Record<string, string>>} */
const RECOLORED_VARIANTS = {
  capuche_bara: { vitality: 'obsidian', wisdom: 'moonstone' },
}

/** Apply a recolor rename to a resolved model's variant, when this appearance/variant pair has one.
 * Identity otherwise (including null/no-variant models). @param {WornModel|null} model @returns {WornModel|null} */
function with_recolor(model) {
  if (!model?.variant) return model
  const renamed = RECOLORED_VARIANTS[model.appearance]?.[model.variant]
  return renamed ? { ...model, variant: renamed } : model
}

/** Index `/v1/encyclopedia` item rows by their canonical ItemTemplate object id. Pure/testable; the map is the
 *  missing join between `Character.worn.*.template_id` (0x id) and the template Display name.
 * @param {any[]} items @returns {Map<string, any>} */
export function index_worn_templates(items) {
  return new Map((items ?? []).map((item) => [String(item.template_id ?? ''), item]).filter(([id]) => id))
}

/** Load the template side of the worn join from the boot-resident seed receipt. Only cosmetic slugs enter
 * the map; their ids are the exact deployed template ids and `cosmetic_icon_of` already owns slug → appearance.
 * This keeps the world renderer off the 2.77 MB all-kinds encyclopedia payload.
 * @returns {Promise<Map<string, any>>} */
export async function read_worn_templates() {
  const rows = Object.entries(seed_manifest.items).flatMap(([slug, template_id]) =>
    cosmetic_icon_of({ slug }) ? [{ template_id, slug }] : []
  )
  return index_worn_templates(rows)
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
    return with_recolor({
      appearance,
      variant: String(item.variant ?? item.skin ?? template?.variant ?? template?.skin ?? '') || null,
    })

  // Stable legacy template identities resolve before mutable encyclopedia Display names.
  const legacy_model = Object.hasOwn(legacy_cosmetic_variants, template_id)
    ? legacy_cosmetic_variants[template_id]
    : null
  if (legacy_model) return with_recolor({ appearance: legacy_model.appearance, variant: legacy_model.variant })

  // Back-compat test/admin shapes sometimes carry the seed slug in template_id. Feed it as `slug` for the
  // authored map.
  // 'Corbac Helmet' deliberately resolves NOTHING here: the corbac duplicate was reconciled to the
  // single corbac_head instance (2026-07-17) — the minted helmet template (0 ever sold, sale delisted) is
  // ceremony-rider'd in docs/REPUBLISH_CHECKLIST.md, never aliased back to life client-side.
  const direct = cosmetic_icon_of({ ...item, slug: item.slug ?? template_id })
  const icon = direct ?? cosmetic_icon_of(template)
  if (!icon) return null
  const split = icon.lastIndexOf('-')
  return with_recolor(
    split > 0
      ? { appearance: icon.slice(0, split), variant: icon.slice(split + 1) || null }
      : { appearance: icon, variant: null }
  )
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
 * veteran-title aura); otherwise the active PET (#594 standing ruling: the pet is BOTH a walking companion
 * AND a mountable ride — no dedicated mount equipped falls back to whatever resolve_pet_companion resolves,
 * the SAME catalog join the trailing-companion rig itself uses, so this never invents a second appearance
 * lookup). Pure; safe on a null character.
 * @param {any} character the live selected character (may carry a `.mount` equip slot post-republish, and/or
 *   the `.pet`/`.pet_equipped` fields the companion rig already reads)
 * @param {string} [search] the URL query string (defaults to the live location — injectable for tests)
 * @returns {{ available: boolean, glb_url: string | null, source: 'dev' | 'equip' | 'pet' | null }}
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
    // template_id NEVER falls to `item?.id` — that's the item's own Sui OBJECT ADDRESS on a live read-model,
    // never an art key (owner ruling: one image per type, never per address). No template/type identifier ⇒
    // an honest no-art degrade (cosmetic_glb_url(undefined) → null) instead of requesting a garbage
    // address-named file that can never exist.
    const template_id = item?.template_id ?? item?.item_type
    const explicit = item && (item.glb || item.glb_url)
    // Runtime/on-chain refs are untrusted: an absolute URL is re-homed onto the manifest asset host. Relative
    // paths are refused because the SPA rewrite can answer a missing GLB with index.html-as-200.
    const explicit_url = explicit ? canonical_model_source_url(explicit) : null
    const glb = explicit_url || cosmetic_glb_url(template_id)
    return { available: true, glb_url: glb, source: 'equip' }
  }
  // #594 — no dedicated mount: the active pet (if any) IS a valid ride target.
  const pet = resolve_pet_companion(character, search)
  if (pet.spawn && pet.glb_url) return { available: true, glb_url: pet.glb_url, source: 'pet' }
  return { available: false, glb_url: null, source: null }
}

/**
 * Should the "[X] Mount the pet" world hint be armed right now? Mirrors resolve_mount's own dev > equip >
 * pet precedence rather than re-deriving it (one home for that fact) — armed only when pressing the mount
 * key would actually target the PET specifically, riding isn't already engaged, and no fight is running
 * (mount_up's own guards; a hint for a dead click is worse than no hint — NpcPrompt's no-dead-click law).
 * Pure. @param {any} character @param {boolean} riding @param {boolean} in_fight @param {string} [search]
 * @returns {boolean}
 */
export function pet_mount_hint_visible(character, riding, in_fight, search) {
  if (riding || in_fight) return false
  return resolve_mount(character, search).source === 'pet'
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
