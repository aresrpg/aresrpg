// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH SETTINGS PERSISTENCE (#2029) — the scouter's configured group survives a reload.
//
// The house pref idiom (quality_pref.js / engine_flags_pref.js / hp_display_pref.js): a pure localStorage
// module that imports only the fold's own defaults, so the adapter can hydrate the atom at creation without
// pulling React, the engine, or the chain. No new mechanism — this app has no zustand `persist` middleware
// anywhere, and one preference key shape is enough.
//
// WHAT IS PERSISTED IS ONLY THE SETTINGS GROUP — never the run state. `armed` / `fee_pending` / `phase` are
// deliberately absent: every zone search the loop fires is a real gas-burning transaction behind an explicit
// fee confirmation, and a scouter that came back ARMED after a page reload would spend with nobody watching.
//
// Reads are TOTAL: a corrupt, foreign, or half-written payload degrades to the shipped defaults field by
// field rather than throwing into the boot path — a bad preference must never cost the player their game.

import {
  DEFAULT_RANGE_FROM_M,
  DEFAULT_RANGE_TO_M,
  DEFAULT_TARGETS,
  TARGET_MODES,
} from './auto_search.js'

export const AUTO_SEARCH_STORAGE_KEY = 'aresrpg.auto_search_settings'

/** @typedef {import('./auto_search.js').AutoSearchSettings} AutoSearchSettings */

/** @returns {AutoSearchSettings} */
const defaults = () => ({
  from_m: DEFAULT_RANGE_FROM_M,
  to_m: DEFAULT_RANGE_TO_M,
  wanted: [],
  wanted_resources: [],
  targets: DEFAULT_TARGETS,
})

/** A finite, non-negative distance, or the shipped default. @param {unknown} value @param {number} fallback */
const distance_or = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback

/** A list of ids, or empty — a non-array (or a bare string) is a foreign payload, never a one-element list. */
const ids_or_empty = (/** @type {unknown} */ value) =>
  Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id).map(String) : []

/**
 * The persisted settings group, or the shipped defaults. Total: never throws, never half-applies a payload.
 * @returns {AutoSearchSettings}
 */
export function read_auto_search_settings() {
  const base = defaults()
  let raw = null
  try {
    raw = localStorage.getItem(AUTO_SEARCH_STORAGE_KEY)
  } catch {
    return base // private mode / disabled storage — session-only settings
  }
  if (!raw) return base
  /** @type {any} */
  let saved = null
  try {
    saved = JSON.parse(raw)
  } catch {
    return base // a corrupt payload is not a reason to fail the boot
  }
  if (!saved || typeof saved !== 'object') return base
  const from_m = distance_or(saved.from_m, base.from_m)
  const to_m = distance_or(saved.to_m, base.to_m)
  return {
    // the fold's own invariant (config_set): the annulus is stored low-to-high whatever order it arrives in
    from_m: Math.min(from_m, to_m),
    to_m: Math.max(from_m, to_m),
    wanted: ids_or_empty(saved.wanted),
    wanted_resources: ids_or_empty(saved.wanted_resources),
    targets: TARGET_MODES.includes(saved.targets) ? saved.targets : base.targets,
  }
}

/**
 * Persist the settings group. Fail-open: a storage refusal leaves the session working, unpersisted.
 * @param {AutoSearchSettings} settings @returns {void}
 */
export function save_auto_search_settings(settings) {
  try {
    localStorage.setItem(
      AUTO_SEARCH_STORAGE_KEY,
      JSON.stringify({
        from_m: settings.from_m,
        to_m: settings.to_m,
        wanted: settings.wanted,
        wanted_resources: settings.wanted_resources,
        targets: settings.targets,
      })
    )
  } catch {
    /* non-fatal — session-only (private mode / quota) */
  }
}
