// The persisted render-quality PREFERENCE — the ONE home for the stored label, its migration, and the
// label→engine-tier map. Split out of render_quality.js (D157/S-85) so the ENGINE MOUNT (embed_voxel.js)
// can read the saved pick at BOOT — feeding it into create_engine({ tier }) so every boot-time dial
// (atlas texel size, load radius, leaf fins, grass sway, motion blur, foliage shadows, godrays) follows
// the player's choice — WITHOUT importing render_quality.js (which imports the heavy engine chunk, a cycle).
// This module imports NOTHING (pure localStorage) so both the light mount path and the HUD can share it.

/** localStorage key holding the chosen label. */
export const QUALITY_STORAGE_KEY = 'aresrpg_quality'

/** The 3 UI labels, low→high (drives the dropdown order + the i18n option keys `world.quality_<label>`). */
export const QUALITY_OPTIONS = /** @type {const} */ (['low', 'medium', 'high'])

/** UI label → engine tier name (1:1 here; kept explicit so a future label rename can't silently drift). */
export const LABEL_TO_TIER = /** @type {Record<string, string>} */ ({
  low: 'low',
  medium: 'medium',
  high: 'high',
})

/** [S-85] Legacy-pref migration: the retired 5-name ladder's stored values map onto the 3 survivors so a
 *  returning player who last picked potato/ultra is silently upgraded, never left on a dead tier. */
export const LEGACY_LABEL_MIGRATION = /** @type {Record<string, string>} */ ({
  potato: 'low',
  ultra: 'high',
})

/** The saved label — migrating a legacy potato/ultra pref onto low/high — or '' for "no override" (auto).
 *  Anything unrecognized falls back to '' (auto). @returns {string} */
export function get_saved_quality() {
  try {
    const v = localStorage.getItem(QUALITY_STORAGE_KEY)
    if (!v) return ''
    const migrated = LEGACY_LABEL_MIGRATION[v] ?? v
    return migrated in LABEL_TO_TIER ? migrated : ''
  } catch {
    return ''
  }
}
