// The persisted HP-GEM DISPLAY preference (keep in localStorage whether we're showing
// health as percent or as stacked) — the ONE home for the stored mode, mirroring the quality_pref.js
// idiom (world/quality_pref.js): a pure-localStorage module importing NOTHING, guarded getters, an
// explicit value whitelist so garbage in storage falls back to the default instead of leaking into state.
// Consumed by GameWorldHud.jsx's Vitals (the HP gem click-toggle: percent "71%" vs stacked current/max).

/** localStorage key holding the chosen mode. */
export const HP_DISPLAY_STORAGE_KEY = 'ares.hp_display_mode'

/** The two modes: 'fraction' (stacked current/max — the DEFAULT: HP HUD defaults
 *  to numbers not percents) | 'percent' (the gem-click alternate). */
export const HP_DISPLAY_MODES = /** @type {const} */ (['percent', 'fraction'])

/** The saved mode, or 'fraction' (the numbers default) when unset/unrecognized/storage-unavailable. @returns {string} */
export function get_saved_hp_display() {
  try {
    const v = localStorage.getItem(HP_DISPLAY_STORAGE_KEY)
    return v && HP_DISPLAY_MODES.includes(/** @type {any} */ (v)) ? v : 'fraction'
  } catch {
    return 'fraction'
  }
}

/** Persist the mode ('percent' | 'fraction'); storage failures (private mode, quota) are silently ignored —
 *  the toggle still works for the session, it just won't survive a reload. @param {string} mode */
export function save_hp_display(mode) {
  try {
    localStorage.setItem(HP_DISPLAY_STORAGE_KEY, mode)
  } catch {
    /* non-fatal — session-only toggle */
  }
}
