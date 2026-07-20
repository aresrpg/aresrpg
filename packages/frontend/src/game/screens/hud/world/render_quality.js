// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D157 — the WORLD-tab render-quality override. The persisted preference lives in quality_pref.js (the ONE
// home, shared with the engine mount so BOOT reads the pick); this module is the BRIDGE to the live voxel
// engine — the instant render-scale swap + the re-boot that applies the boot-time dials a pref change needs.
//
// Access pattern: the engine is a MODULE SINGLETON created in embed_voxel.js, which exposes the live handle
// on `window.__voxel_engine`. We READ that handle (never mutate embed_voxel's boot code) — the engine boots
// async, so apply_saved_tier polls briefly for it, then no-ops if it never appears.
//
// [S-85 ladder wiring] The tier is chosen at TWO moments. (1) BOOT: embed_voxel.js reads get_saved_quality()
// and passes it to create_engine({ tier }) — so the atlas texel size (32/64/128), load radius (4/7/8), leaf
// fins, grass sway, motion blur, foliage shadows and godrays all bake at the player's tier. (2) LIVE: those
// boot-time dials can't hot-swap (the atlas is baked once; the ring reads its radius at construct), and EVERY
// tier changes at least one of them — so a real change RE-BOOTS the graphics pipeline IN PLACE via
// embed_voxel.reboot_voxel_session_tier: the engine+world re-create at the new tier behind the boot veil with
// NO page reload (the page, auth session, stores and chain state all survive; the player resumes their exact
// pose and the world re-streams). Default = no saved value = the engine's boot-tier default (mount picks
// 'high' when unset — see embed_voxel.js mount_voxel_scene).

import { get_voxel_engine, reboot_voxel_session_tier } from '../../../embed_voxel.js'
import { push_event_toast } from '../../../core/toast.js'
import i18n from '../../../../i18n'
import { QUALITY_STORAGE_KEY, LABEL_TO_TIER, get_saved_quality } from './quality_pref.js'
import { game_log } from '../../../../core/log.js'

// Re-exported so the dropdown (QualitySelect.jsx) keeps its single import surface (public API unchanged).
export { QUALITY_OPTIONS, get_saved_quality } from './quality_pref.js'
export { QUALITY_STORAGE_KEY } from './quality_pref.js'

/** Live engine handle — D220 ROOT: the old read was `window.__voxel_engine`, which is DEV-ONLY (the
 *  embed exposes window globals inside `import.meta.env.DEV`), so on any preview/prod build apply_tier
 *  silently no-oped FOREVER ("changing resolution does nothing"). The D157 prod fold-in created the real
 *  module path — get_voxel_engine() — and this file never switched to it. Window global stays as the
 *  DEV/probe fallback. @returns {any | null} */
const engine_handle = () => get_voxel_engine() ?? /** @type {any} */ (window).__voxel_engine ?? null

/** Push a label's tier into the engine now, if the handle is live. @param {string} label @returns {boolean} */
function apply_tier(label) {
  const tier = LABEL_TO_TIER[label]
  const engine = engine_handle()
  if (!tier || !engine?.set_tier) return false
  try {
    engine.set_tier(tier)
    return true
  } catch (error) {
    game_log('quality', 'set_tier failed', error)
    return false
  }
}

/**
 * Persist a new selection AND apply it LIVE. '' clears the override (removes the key → the no-pref default).
 *
 * The boot-only dials (atlas texel size, ring radius, leaf fins, grass sway, motion blur, foliage shadows)
 * are baked at engine construction and CANNOT hot-swap, and every tier changes at least one — so a REAL tier
 * change on a live world RE-BOOTS the graphics pipeline IN PLACE (reboot_voxel_session_tier: the engine+world
 * re-create at the new tier behind the boot veil, NO page reload — the page/session/stores/chain state
 * survive, the player resumes their pose, the world re-streams). A dungeon run BLOCKS the swap (it owns the
 * board/cave): we toast and do NOT persist, so the dropdown pick never lies (the caller reverts on false). No
 * live world (meta tab / logged out) ⇒ nothing to re-boot; just persist for the next mount.
 * @param {string} label one of QUALITY_OPTIONS, or '' to clear
 * @returns {boolean} true when applied (or persisted for a later mount); false when blocked by a live fight
 */
export function set_quality(label) {
  const previous = get_saved_quality()
  const changed = (label || '') !== (previous || '')
  if (!changed) return true // the live world already runs this tier — nothing to do
  // A live session must re-boot to bake the boot-only dials at the new tier. '' (auto) re-boots the no-pref
  // default ('high' — mount_voxel_scene's fallback), exactly what a page reload would have produced.
  if (engine_handle()) {
    const result = reboot_voxel_session_tier(LABEL_TO_TIER[label] ?? 'high')
    // Only a LIVE fight hard-blocks: toast + revert the dropdown + don't persist (the run owns the board/cave).
    // 'no_session' (spectate backdrop / meta tab / stale handle) just means there's no world to re-boot — fall
    // through and persist for the next real mount, exactly like the no-engine case.
    if (!result.ok && result.reason === 'fight') {
      push_event_toast({ state: 'error', title: i18n.t('world.quality_fight_blocked') })
      return false
    }
  }
  try {
    if (label) localStorage.setItem(QUALITY_STORAGE_KEY, label)
    else localStorage.removeItem(QUALITY_STORAGE_KEY)
  } catch {
    /* private-mode / disabled storage — the live re-boot above already took effect this session */
  }
  return true
}

/**
 * On world mount: re-apply the saved tier once the engine handle is live. With the boot-seam wiring the
 * engine already boots at the saved tier, so this is belt-and-suspenders (idempotent render-scale re-apply)
 * that also covers a handle that appeared after boot. The engine boots async and may not exist when the HUD
 * first mounts, so poll a bounded number of times, then give up quietly. No saved value → do nothing.
 * Returns a cleanup that stops the poll.
 * @returns {() => void}
 */
export function apply_saved_tier() {
  const label = get_saved_quality()
  if (!label) return () => {}
  if (apply_tier(label)) return () => {}
  let tries = 0
  const timer = setInterval(() => {
    if (apply_tier(label) || ++tries >= 40) clearInterval(timer) // ~10s at 250ms, then stop
  }, 250)
  return () => clearInterval(timer)
}
