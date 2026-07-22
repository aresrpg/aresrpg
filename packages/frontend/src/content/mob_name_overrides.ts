// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// INTERIM CLIENT-SIDE DISPLAY OVERRIDE for a shipped on-chain MobTemplate name that must not reach a
// player. The chain string is mint-only until the identity rename door ships (#521) — until then this
// is the ONE home a bad chain name gets swapped for display. Every render path that shows a mob name
// already holds the CHAIN NAME AS MINTED (encyclopedia `mob.name`, fight/world `mob_names` meta) — none
// reliably threads the authoring slug/key through to display — so the map is keyed on that string; the
// slug is documented per entry for traceability back to seed_manifest.mobs.
//
// TWO directions, one table:
//  - `display_mob_name` (forward) — applied where a raw chain name first enters a cache/state a render
//    path reads for TEXT (bestiary/world rows, the `mob_names` roster meta and its writers).
//  - `catalog_name_of` (reverse) — a chain mob's NAME doubles as the 3D-model/2D-icon catalog lookup key
//    (game/data/mobs.js `catalog_key_of` — "the ONLY place a name becomes a key"); that resolver un-does
//    the override first, so a caller holding the DISPLAY name still resolves the real asset. Without this
//    half, overriding the text would silently regress the model/icon to the debug-cube fallback.
//
// Delete an entry (and this file, if it's the last one) the moment its chain string is renamed via
// #521 — this table must not outlive the door it stands in for.
const MOB_NAME_OVERRIDES: Record<string, string> = {
  // draugr_retarded (world-3, Bonekin lineage) — seed_manifest.mobs.draugr_retarded
  'Retarded Draugr': 'Shambling Draugr',
}

const REVERSE_MOB_NAME_OVERRIDES: Record<string, string> = Object.fromEntries(
  Object.entries(MOB_NAME_OVERRIDES).map(([raw, display]) => [display, raw])
)

/** Resolve a chain/authored mob name through the interim override table above (identity absent a hit). */
export function display_mob_name(name: string | null | undefined): string {
  if (!name) return name ?? ''
  return MOB_NAME_OVERRIDES[name] ?? name
}

/** Undo the override for catalog/asset lookups (game/data/mobs.js) — accepts either the raw chain name
 * or the display name and always returns the raw name the model/icon catalog is keyed by. */
export function catalog_name_of(name: string | null | undefined): string {
  if (!name) return name ?? ''
  return REVERSE_MOB_NAME_OVERRIDES[name] ?? name
}
