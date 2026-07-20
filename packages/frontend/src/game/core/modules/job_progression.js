// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// JOB PROGRESSION — the transient JOB level-up congrats card slice + its transition detector. The sibling of
// player_experience.js's CHARACTER level-up detection, kept as its OWN module (single responsibility, trivially
// deletable) so the freshly-tuned fight-result loop stays untouched. Truth is the chain: gathering.move /
// crafting bank job xp on-chain (character_link `add_job_xp`, per-job dynamic field); the read-model projects it
// back as `character.jobs` ({ [job_id]: total_xp } — the SAME map the JobsDrawer + gather_gate read). This module
// watches the ACTIVE character's per-job xp across the roster refresh and fires the card when a job crosses a
// level — mirroring the experience-delta pattern, so the moment the jobs projection lands it lights up live.
//
// DATA DEPENDENCY (declared, out of this module's reach): the indexer defers job-xp projection today (RpcCharacter
// carries no `jobs`; read_character doesn't decode the per-job dynamic fields), so `character.jobs` is currently
// unpopulated and this detector stays dormant until that projection lands. The detector + card + unlock math are
// proven by unit tests (job_progression.test.js) against synthetic `jobs` deltas — correct and ready, not faked.

import { job_level } from '@aresrpg/sdk/jobs'

/**
 * The transient job level-up congrats card slice. null when nothing is showing.
 * @typedef {object} JobLevelUpSlice
 * @property {string} job_id         the job that leveled (JOBS id — e.g. 'miner', 'armorsmith')
 * @property {number} level          the job's level AFTER the gain
 * @property {number} levels_gained  levels crossed in this gain (>= 1)
 */

/**
 * Fold one `action/job_level_up/*` into the slice (pure). open replaces (a fresh celebration always wins the
 * card); close clears it.
 * @param {JobLevelUpSlice | null} slice
 * @param {string} type
 * @param {any} payload
 * @returns {JobLevelUpSlice | null}
 */
export const fold_job_level_up = (slice, type, payload) => {
  switch (type) {
    case 'action/job_level_up/open':
      return {
        job_id: payload.job_id,
        level: payload.level,
        levels_gained: payload.levels_gained,
      }
    case 'action/job_level_up/close':
      return null
    default:
      return slice
  }
}

/**
 * PURE detection — the job level-ups between a previous and a next per-job xp map for ONE character. A job
 * fires only on a real xp GAIN that crosses a level boundary (`job_level(next) > job_level(prev)`); an absent
 * prior job reads as 0 xp (level 1). The caller guarantees `prev` is a real prior SNAPSHOT (never the
 * first-ever paint) so the whole roster doesn't flash cards on load. In practice a single gather/craft banks
 * xp into ONE job, so this returns 0 or 1 entries; it handles many defensively.
 * @param {Record<string, number> | null | undefined} prev_jobs
 * @param {Record<string, number> | null | undefined} next_jobs
 * @returns {{ job_id: string, level: number, levels_gained: number }[]}
 */
export function detect_job_level_ups(prev_jobs, next_jobs) {
  /** @type {{ job_id: string, level: number, levels_gained: number }[]} */
  const ups = []
  for (const [job_id, raw_next] of Object.entries(next_jobs ?? {})) {
    const next_xp = Number(raw_next ?? 0)
    const prev_xp = Number(prev_jobs?.[job_id] ?? 0)
    if (next_xp <= prev_xp) continue
    const before = job_level(prev_xp)
    const after = job_level(next_xp)
    if (after > before) ups.push({ job_id, level: after, levels_gained: after - before })
  }
  return ups
}

/** @type {import('../game.js').Module} */
export default function job_progression() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      if (type.startsWith('action/job_level_up/'))
        return { ...state, job_level_up: fold_job_level_up(state.job_level_up, type, payload) }
      return state
    },
    /** @param {import('../game.js').Context} context */
    observe({ events, dispatch }) {
      // Per-character last-seen job map, so we surface DELTAS across the roster refresh (load_roster repaints
      // `character.jobs` after a gather/craft tx confirms). Keyed by character id: a first sighting SNAPSHOTS
      // silently (no card flood on load); only a subsequent map with a higher per-job level fires. Tracking
      // every character (not just the selected one) keeps a character SWITCH from false-firing a stale delta —
      // but the card only opens for the SELECTED character (the one actually working a job).
      /** @type {Map<string, Record<string, number>>} */
      const last = new Map()
      let last_characters = null

      events.on('STATE_UPDATED', state => {
        const characters = state.sui?.characters
        if (characters === last_characters) return
        last_characters = characters
        // D245 guard (mirrors player_experience): the roster can transiently be undefined mid-fight/claim.
        for (const character of characters ?? []) {
          const next_jobs = character.jobs ?? {}
          const prev_jobs = last.get(character.id)
          // snapshot regardless (so the NEXT delta compares against fresh truth)
          last.set(character.id, { ...next_jobs })
          if (!prev_jobs) continue // first sighting — snapshot only, never a card
          if (character.id !== state.selected_character_id) continue // only the active char celebrates

          const ups = detect_job_level_ups(prev_jobs, next_jobs)
          if (ups.length === 0) continue
          // A single gather/craft banks into ONE job, so `ups` is length 1 in practice; if several ever
          // cross at once, celebrate the biggest jump (the slice shows one at a time — YAGNI on a queue).
          const top = ups.reduce((a, b) => (b.levels_gained > a.levels_gained ? b : a))
          dispatch('action/job_level_up/open', top)
        }
      })
    },
  }
}
