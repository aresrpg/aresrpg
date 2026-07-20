// The BRIDGE from the settings-page graphics section to the live voxel engine — mirrors render_quality.js's
// split (quality_pref.js = pure boot-read; render_quality.js = the reboot-triggering bridge only the HUD/
// settings UI imports, never embed_voxel.js itself, to avoid a cycle). Three of the six graduated flags
// (sun_follow, sky_couple, taau_medium) are boot-time-baked engine dials with a genuine `globalThis.__ARES_*`
// escape hook (engine_flags_pref.js's header) — a change re-applies the SAME way a quality-tier change does:
// reboot_voxel_session_tier() re-creates the live session in place (no page reload), and embed_voxel.js's
// create_session calls apply_saved_engine_flags() fresh on every (re)construction, so the freshly-persisted
// value is what the rebuilt renderer reads. The other three (ambience, far-field-experimental, reveal style)
// have no engine-side hook to trigger at all (bare `location.search` reads, no config param, no global
// anywhere in the engine) — their setters below only persist a preference for a future engine pass.
//
// embed_voxel.js is imported DYNAMICALLY (never at module scope) so visiting /settings alone never pulls
// the ~900-line voxel/world/dungeon import graph into that route's chunk — the same lazy-import idiom
// embed_voxel.js itself uses for cave_session.js/sky_dragon.js.

import { push_event_toast } from '../../../core/toast.js'
import i18n from '../../../../i18n'
import { get_saved_quality } from './quality_pref.js'
import {
  get_saved_sun_follow,
  save_sun_follow,
  get_saved_sky_couple,
  save_sky_couple,
  get_saved_taau_medium,
  save_taau_medium,
  save_ambience,
  save_far_field_experimental,
  save_reveal_style,
} from './engine_flags_pref.js'

/**
 * Persist a new value for one of the 3 boot-time-baked flags and, if a world session is live, reboot it in
 * place so the change takes effect with NO page reload — the exact idiom render_quality.js's set_quality()
 * uses for a tier change. A live dungeon fight owns the board/cave and refuses the swap: reverts the
 * persisted value, toasts, and returns false so the caller's optimistic UI reverts too (mirrors
 * QualitySelect.jsx's on_change). No live session (logged out / meta tab) ⇒ nothing to reboot; the
 * persisted value simply applies on the next boot.
 * @param {() => boolean} get_previous @param {(v: boolean) => void} persist @param {boolean} enabled
 * @returns {Promise<boolean>} true when applied (or persisted for a later mount); false when a live fight blocked it
 */
async function apply_wireable_flag(get_previous, persist, enabled) {
  const previous = get_previous()
  if (previous === enabled) return true // already this value — nothing to reboot
  persist(enabled)
  const { get_voxel_engine, reboot_voxel_session_tier } = await import('../../../embed_voxel.js')
  if (!get_voxel_engine()) return true // no live session — persisted value applies on next boot
  const result = reboot_voxel_session_tier(get_saved_quality() || 'high')
  if (!result.ok && result.reason === 'fight') {
    persist(previous)
    push_event_toast({ state: 'error', title: i18n.t('world.quality_fight_blocked') })
    return false
  }
  return true
}

/** @param {boolean} enabled @returns {Promise<boolean>} */
export const set_sun_follow = (enabled) => apply_wireable_flag(get_saved_sun_follow, save_sun_follow, enabled)
/** @param {boolean} enabled @returns {Promise<boolean>} */
export const set_sky_couple = (enabled) => apply_wireable_flag(get_saved_sky_couple, save_sky_couple, enabled)
/** @param {boolean} enabled @returns {Promise<boolean>} */
export const set_taau_medium = (enabled) => apply_wireable_flag(get_saved_taau_medium, save_taau_medium, enabled)

// The 3 needs-a-setter flags (ambience / far-field-experimental / reveal-style — see engine_flags_pref.js's
// header survey): no engine hook exists yet, so these persist ONLY. settings.tsx renders their rows disabled
// with a "not yet applied" hint — never silently pretending the toggle changes live behavior (rule: no
// silent failure).
/** @param {boolean} enabled */
export const set_ambience = (enabled) => save_ambience(enabled)
/** @param {boolean} enabled */
export const set_far_field_experimental = (enabled) => save_far_field_experimental(enabled)
/** @param {string} value */
export const set_reveal_style = (value) => save_reveal_style(value)
