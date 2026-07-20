// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mob look resolver: maps a wire mob `Entity` to its real 3D art. Used by BOTH the roam world and the fight
// board (each renders the GLB creature via the rig loader). ONE seam — switching it flips world_spawns,
// spawn_rigs, cave_mobs, the dungeon dimension AND the fight board (voxel_fight_folds) at once.
//
// SOURCE OF TRUTH ("extract the exact reference-corpus mobs — no fallback"): every mob renders its
// OWN reference-corpus model, extracted from the vanilla reference asset archive by the extraction script (which
// runs the GLB conversion script per model) into public/sprites/mobs/models/hy_*.glb. The mapping key is
// the mob's `appearance` (the reference-corpus model id the mob is authored as); the published mob_catalog
// (mob_catalog.js) resolves the catalog key/variant → { appearance, glb } in one hop (merged at publish).
//
// NO KOSHI FALLBACK: an appearance with no reference-corpus source (the 61 `Custom_*` AresRPG-invented
// mobs + ~18 invented names — Anorak, Crabito, Talokan_*, …) resolves to a LOUD console.error naming the
// appearance + an obvious magenta debug cube (hy__missing.glb), so a content gap is impossible to miss —
// never a silent koshi swap. Re-run the extractor to add a model the moment a reference-corpus source exists for it.

import { walrus_asset_url } from '@aresrpg/sdk/jobs'

import { get_catalog } from './mob_catalog.js'

// GLBs serve from unhashed /sprites URLs (browsers cache across re-extractions). Pin each model to its first
// resolved source for the page lifetime. A late Walrus manifest refresh therefore cannot make an already-roaming
// mob and its fight-board twin parse different GLB bytes.
/** @type {Map<string, string>} */
const resolved_mob_urls = new Map()
export const resolve_mob_visual_url = (
  /** @type {Map<string, string>} */ cache,
  /** @type {string} */ glb,
  /** @type {(url_class:string, filename:string) => string | null} */ resolve_asset = walrus_asset_url
) => {
  let url = cache.get(glb)
  if (!url) {
    url = resolve_asset('mob', `${glb}.glb`) ?? `/sprites/mobs/models/${glb}.glb`
    cache.set(glb, url)
  }
  return url
}
const mob_visual_url = (/** @type {string} */ glb) => resolve_mob_visual_url(resolved_mob_urls, glb)
const missing_url = () => mob_visual_url('hy__missing')

/** Normalize a mob display NAME into a mob_catalog key: lowercase, every run of non-alnum chars
 * collapsed to one underscore, edges trimmed. Matches the legacy dataset's own id convention (verified against
 * seed/.prod-snapshot/mobs/all.json: "Aberrant Hulk" -> "aberrant_hulk", "Test Brute" -> "test_brute").
 * Single-homed: the ONLY place a name becomes a key. @param {string | undefined | null} name @returns {string | null} */
const catalog_key_of = (name) => {
  const key = name
    ?.toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return key || null
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
 * @returns {{ url: string, variant: string | null, size: number }}
 */
export function get_mob_model(mob) {
  const wire = typeof mob.size === 'number' && mob.size > 0 ? mob.size : 1
  const size = 1.4 * wire
  const catalog = get_catalog()
  const by_variant = mob.variant == null ? undefined : catalog[mob.variant]
  const entry = by_variant ?? catalog[catalog_key_of(mob.name) ?? '']
  const appearance = entry?.appearance ?? null
  const glb = entry?.glb ?? null
  // Walrus (boot manifest) first — the decentralized home — else the bundled /sprites copy (progressive
  // migration; the manifest carries `mob` only after the census→quilt→upload lane publishes it).
  if (glb)
    return {
      url: mob_visual_url(glb),
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
  return { url: missing_url(), variant: null, size }
}

/**
 * The 2D encyclopedia icon URL for a mob, by NAME (the only visual-adjacent fact the /v1 bestiary
 * projection carries — see bestiary_tab.tsx: `get_encyclopedia('mobs')` has no `appearance`/GLB field).
 * SAME resolution as get_mob_model (variant / catalog_key_of(name) → the published mob_catalog → glb),
 * rendered offline by scripts/render_mob_icons.mjs into public/sprites/mobs/icons/{glb}.png (+ `_hd.png`) —
 * the SAME thumb/_hd two-tier system item_icon_url/spell_icon_url use. Walrus (boot manifest, `mob_icon`
 * class) first, else the committed local copy (progressive migration — same fallback order get_mob_model
 * uses for the GLB itself). No catalog match / no rendered file → null, NEVER the GLB debug-cube swapped in
 * as a 2D image (caller degrades to its own glyph, mirroring ItemImage's category-glyph fallback).
 * @param {{ name?: string, variant?: string }} mob
 * @param {{ hd?: boolean }} [opts]
 * @returns {string | null}
 */
export function get_mob_icon_url(mob, { hd = false } = {}) {
  const catalog = get_catalog()
  const by_variant = mob.variant == null ? undefined : catalog[mob.variant]
  const entry = by_variant ?? catalog[catalog_key_of(mob.name) ?? '']
  const glb = entry?.glb ?? null
  if (!glb) return null
  const file = `${glb}${hd ? '_hd' : ''}.png`
  return walrus_asset_url('mob_icon', file) ?? `/sprites/mobs/icons/${file}`
}
