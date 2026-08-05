// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mob look resolver: maps a wire mob `Entity` to its real 3D art. Used by BOTH the roam world and the fight
// board (each renders the GLB creature via the rig loader). ONE seam — switching it flips world_spawns,
// spawn_rigs, cave_mobs, the dungeon dimension AND the fight board (voxel_fight_folds) at once.
//
// SOURCE OF TRUTH ("extract the exact reference-corpus mobs — no fallback"): every mob renders its
// OWN reference-corpus model, extracted from the vanilla reference asset archive by the extraction script (which
// runs the GLB conversion script per model) and published under the asset host's models/mobs family. The mapping key is
// the mob's `appearance` (the reference-corpus model id the mob is authored as); the published mob_catalog
// (mob_catalog.js) resolves the catalog key/variant → { appearance, glb } in one hop (merged at publish).
//
// NO KOSHI FALLBACK: an appearance with no reference-corpus source (the 61 `Custom_*` AresRPG-invented
// mobs + ~18 invented names — Anorak, Crabito, Talokan_*, …) resolves to a LOUD console.error naming the
// appearance + an obvious magenta debug cube (hy__missing.glb), so a content gap is impossible to miss —
// never a silent koshi swap. Re-run the extractor to add a model the moment a reference-corpus source exists for it.

import { mob_icon_url, asset_url } from '@aresrpg/sdk/jobs'

import { catalog_name_of } from '../../content/mob_name_overrides'
import { seed_manifest } from '../../content/seed_manifest'
import { fast_travel_asset_refs } from '../fast_travel_assets.js'
import { model_asset_url } from '../model_asset_url.js'
import { get_catalog } from './mob_catalog.js'
import { get_pet_catalog } from './pet_catalog.js'

/** The single display predicate for authored archi-tier MobTemplates. */
export const is_archi_tier = (/** @type {string | null | undefined} */ tier) => tier?.toLowerCase() === 'archi'

// GLBs serve from unhashed asset-host URLs (browsers cache across re-extractions). Pin each model to its
// first resolved absolute source for the page lifetime. A late manifest refresh cannot make an already-roaming
// mob and its fight-board twin parse different GLB bytes.
/** @type {Map<string, string>} */
const resolved_mob_urls = new Map()
const FALLBACK_MODEL_FILE = 'hy__missing.glb'

/** @param {string} glb */
const mob_model_filename = (glb) => (glb.endsWith('.glb') ? glb : `${glb}.glb`)

export const resolve_mob_visual_url = (
  /** @type {Map<string, string>} */ cache,
  /** @type {string} */ glb,
  /** @type {(url_class:string, filename:string) => string | null} */ resolve_asset = asset_url
) => {
  const filename = mob_model_filename(glb)
  let url = cache.get(filename)
  if (!url) {
    url = model_asset_url('mob', filename, resolve_asset)
    if (url) cache.set(filename, url)
  }
  return url ?? null
}

let allowed_mob_catalog = /** @type {Record<string, {glb?: string | null}> | null} */ (null)
let allowed_pet_catalog = /** @type {Record<string, {glb?: string | null}> | null} */ (null)
let allowed_mob_files = /** @type {Set<string>} */ (new Set())
const rejected_mob_files = new Set()

/** Rebuild only when a late catalog load (or a test seam) swaps either catalog object. */
function catalog_mob_files() {
  const mob_catalog = get_catalog()
  const pet_catalog = get_pet_catalog()
  if (mob_catalog !== allowed_mob_catalog || pet_catalog !== allowed_pet_catalog) {
    // A catalog object replacement is a new publication snapshot. Preserve page-lifetime pinning while the
    // snapshot is stable, but never let URLs from an older snapshot/test configuration leak into the new one.
    resolved_mob_urls.clear()
    allowed_mob_catalog = mob_catalog
    allowed_pet_catalog = pet_catalog
    allowed_mob_files = new Set([
      FALLBACK_MODEL_FILE,
      ...fast_travel_asset_refs.filter(({ url_class }) => url_class === 'mob').map(({ filename }) => filename),
      ...Object.values(mob_catalog).flatMap(({ glb }) => (glb ? [mob_model_filename(glb)] : [])),
      ...Object.values(pet_catalog).flatMap(({ glb }) => (glb ? [mob_model_filename(glb)] : [])),
    ])
  }
  return allowed_mob_files
}

/** The ONE production constructor for a catalog mob-model URL. Accepts a catalog GLB stem or filename so
 * manifest-sealed models (the travel dragons) and mob/pet catalog rows share the identical construction path.
 * An unlisted key can never become a speculative network request: it reports once and resolves the explicit
 * magenta fallback instead. */
export const mob_model_url = (/** @type {string} */ glb) => {
  const filename = mob_model_filename(glb)
  if (catalog_mob_files().has(filename)) return resolve_mob_visual_url(resolved_mob_urls, filename)
  if (!rejected_mob_files.has(filename)) {
    rejected_mob_files.add(filename)
    console.error(
      `[mob-model-catalog] refused unlisted mob GLB "${filename}"; rendering catalog fallback "${FALLBACK_MODEL_FILE}"`
    )
  }
  return resolve_mob_visual_url(resolved_mob_urls, FALLBACK_MODEL_FILE)
}

/** The visible magenta fallback, resolved by the same catalog constructor as every primary mob model. */
export const mob_model_fallback_url = () => mob_model_url(FALLBACK_MODEL_FILE)

/** Normalize a mob display NAME into a mob_catalog key: lowercase, every run of non-alnum chars
 * collapsed to one underscore, edges trimmed. Matches the legacy dataset's own id convention (verified against
 * seed/.prod-snapshot/mobs/all.json: "Aberrant Hulk" -> "aberrant_hulk", "Test Brute" -> "test_brute").
 * Single-homed: the ONLY place a name becomes a key. `catalog_name_of` undoes an interim display override
 * FIRST (mob_name_overrides.ts) — the reference-corpus catalog is keyed by the raw chain/seed name, so a
 * caller holding the overridden display string must still resolve the real model/icon.
 * @param {string | undefined | null} name @returns {string | null} */
export const mob_identity_key = (name) => {
  const key = catalog_name_of(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return key || null
}

/**
 * The authored TIER of a mob (`archi` / `boss` / `protector` / `normal`), by NAME — the same key every other
 * authored display fact resolves on here (get_mob_model / mob_icon_url). The tier is authored content the
 * chain does not carry: `MobTemplate` has no role field and `/v1` projects none, so the deployment receipt is
 * the only source — and it may be read ONLY the way it is read here, keyed on the mob's own name.
 *
 * NEVER key this on a template id. The receipt is a build-time artifact and its ids are re-minted by every
 * republish: measured against the live testnet on 2026-07-29, ZERO of the receipt's 374 mob ids matched any of
 * the 383 rows `/v1` was serving, while the normalized NAME matched 374 of them (all 60 authored archi mobs
 * among them). Names are authored and survive a re-mint; ids do not. Same lesson as #1467/#1510.
 *
 * A miss decorates nothing (null → no badge) — this never filters or hides a live row.
 * @param {string | undefined | null} name @returns {string | null}
 */
export const get_mob_tier = (name) => mob_tiers_by_key().get(mob_identity_key(name) ?? '') ?? null

/** @type {Map<string, string | null> | null} */
let mob_tiers = null
const mob_tiers_by_key = () => {
  if (!mob_tiers)
    mob_tiers = new Map(
      Object.values(seed_manifest.mobs).map(({ name, role }) => [
        mob_identity_key(name) ?? '',
        role?.toLowerCase() ?? null,
      ])
    )
  return mob_tiers
}

/** (appearance) keys already error'd about — the fight board re-derives specs every frame, so the error dedupes
 * per distinct unresolved appearance instead of flooding at 60Hz. Module-scoped. */
const warned_appearances = new Set()

/**
 * Resolve the GLB model + world size for a mob entity (ROAM world + fight board). Two-key lookup into the
 * published mob_catalog for the mob's `{ appearance, glb }`: `variant` (a legacy roster string id) matches
 * DIRECTLY, tried first; `name` (MobTemplate.name — the only visual-adjacent fact a live on-chain mob carries)
 * is normalized to a catalog key and tried second, since a chain mob's `variant` is its Sui object id and can
 * never hit the first key. The appearance then resolves to its extracted reference-corpus GLB. No match → a LOUD
 * console.error (deduped per appearance) + the debug cube — NEVER a silent koshi fallback.
 * @param {{ name?: string, type?: string, variant?: string, size?: number }} mob
 * @returns {{ url: string | null, variant: string | null, size: number }}
 */
export function get_mob_model(mob) {
  const wire = typeof mob.size === 'number' && mob.size > 0 ? mob.size : 1
  const size = 1.4 * wire
  const catalog = get_catalog()
  const by_variant = mob.variant == null ? undefined : catalog[mob.variant]
  const entry = by_variant ?? catalog[mob_identity_key(mob.name) ?? '']
  const appearance = entry?.appearance ?? null
  const glb = entry?.glb ?? null
  // Asset-host only: an unpublished `mob` class returns null and the caller keeps its honest placeholder state.
  if (glb)
    return {
      url: mob_model_url(glb),
      variant: null,
      size,
    }

  // No reference-corpus model for this appearance (Custom_* / AresRPG-invented / unmapped id) — LOUD so the gap is
  // visible, DEDUPED per appearance (the fight board would otherwise flood at 60Hz). Debug cube, never koshi.
  const gap = appearance ?? `<no catalog entry: name="${mob.name ?? ''}" variant="${mob.variant ?? ''}">`
  if (!warned_appearances.has(gap)) {
    warned_appearances.add(gap)
    console.error(
      `[mob-model] NO REFERENCE-CORPUS MODEL for appearance="${gap}" (mob name="${mob.name ?? ''}" variant="${mob.variant ?? ''}") — rendering the debug cube. Extract its reference-corpus source or fix its appearance in mob_models.json.`
    )
  }
  return { url: mob_model_fallback_url(), variant: null, size }
}

/**
 * The 2D encyclopedia icon URL for a mob, by NAME (the only visual-adjacent fact the /v1 bestiary
 * projection carries — see bestiary_tab.tsx: `get_encyclopedia('mobs')` has no `appearance`/GLB field).
 * SAME catalog lookup as get_mob_model (variant / mob_identity_key(name) → the published mob_catalog), but
 * the FILENAME is the matched CATALOG KEY, never the entry's glb: the two mob namespaces are keyed
 * differently on the asset host — geometry by the GLB basename (`models/mobs/hy_boar.glb`), the icon by
 * the mob key (`mobs/boar.png`). #1013: naming the icon after the glb 404'd every mob, loudest on the
 * ruled-mapping rows (glb ≠ `hy_` + key — 755/770 of the published catalog, e.g. Broodfather →
 * hy_scarak_broodmother_model_default). The catalog entry still gates: no extracted GLB means no
 * rendered icon exists to ask for.
 * scripts/render_mob_icons.mjs renders the icons offline under GLB basenames (`{glb}.png` /
 * `{glb}_hd.png`); any publish preparation feeding this resolver must re-key or alias those renders to
 * the catalog filenames requested above. Mob icons use the SAME thumb/_hd two-tier system item_icon_url
 * uses (spells are single-size .webp — #884).
 * The MinIO asset host is the ONLY origin — no local/bundled fallback (#353: the pre-CDN local copy was
 * migration residue, gitignored and never shipped past a dev's own disk). No catalog match → null, NEVER
 * the GLB debug-cube swapped in as a 2D image (caller degrades to its own glyph, mirroring ItemImage's
 * category-glyph fallback).
 * @param {{ name?: string, variant?: string }} mob
 * @param {{ hd?: boolean }} [opts]
 * @returns {string | null}
 */
export function get_mob_icon_url(mob, { hd = false } = {}) {
  const catalog = get_catalog()
  const key =
    mob.variant != null && catalog[mob.variant] ? mob.variant : (mob_identity_key(mob.name) ?? '')
  if (!catalog[key]?.glb) return null
  return mob_icon_url(`${key}${hd ? '_hd' : ''}.png`)
}
