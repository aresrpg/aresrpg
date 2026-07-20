// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The onboarding QUEST LADDER — RUNTIME STORE (the side-effecting half; the pure reducer + data live in
// quest_ladder.js). Framework-agnostic (a snapshot + subscribe pair, useSyncExternalStore-safe, mirroring
// toast.js), so the objective card binds without prop-drilling. Three jobs:
//   1) DETECTION — wire the five quest signals off surfaces the client already sees:
//        fight win  → engine bus `action/fight_result/resolve` (the victory-truth lane; zero touch),
//        loot/craft → the s.sui.items bag via STATE_UPDATED (bag-change gated),
//        equip      → note_equip(), called from equip_actions.js when the equip tx lands,
//        gather     → note_gather(), called from gather_actions.js when the gather tx lands.
//   2) PERSIST + CELEBRATE — latch completions to localStorage (quest_ladder.js), and on each real
//        completion fire the reused search-juice beat: gold vignette flash + discovery chime + a success
//        toast (no celebration on a SKIP — skip just advances).
//   3) SKIP — per-quest skip + a dismiss-forever "skip all".
//
// Wiring runs ONCE at module load (imported by the card + the two action hooks), guarded so a re-import
// never double-subscribes. No engine dispatch flows back out — this is a pure read/observe consumer.

import i18n from '../../../../i18n'
import { context } from '../../../core/game.js'
import { play_discovery_sfx } from '../../../core/audio/sfx.js'
import { push_event_toast, trigger_search_flash } from '../../../core/toast.js'

import {
  QUESTS,
  QUEST_COUNT,
  TARGET_TOOL,
  active_index,
  dismiss_all,
  is_hidden,
  item_label,
  load_progress,
  loot_progress,
  mark_skipped,
  reduce_signal,
  save_progress,
} from './quest_ladder.js'

let progress = load_progress()

/** @returns {any[]} the live bag (never throws — a pre-init read degrades to empty). */
function current_items() {
  try {
    return context.get_state()?.sui?.items ?? []
  } catch {
    return []
  }
}

/**
 * @typedef {{
 *   hidden: boolean, index: number, total: number,
 *   quest_id: string | null, kind: string | null,
 *   loot: { rows: {id:string,have:number,need:number}[], met:boolean, have:number, need:number } | null,
 *   done_count: number,
 * }} QuestSnapshot
 */

/** @returns {QuestSnapshot} */
function build_snapshot() {
  const index = active_index(progress)
  const quest = QUESTS[index] ?? null
  return {
    hidden: is_hidden(progress),
    index,
    total: QUEST_COUNT,
    quest_id: quest?.id ?? null,
    kind: quest?.kind ?? null,
    loot: quest?.kind === 'loot' ? loot_progress(current_items()) : null,
    done_count: progress.done.filter(Boolean).length,
  }
}

/** A compact render-affecting signature — the snapshot ref only changes when this does (subscribe stability). */
const sig = (s) =>
  [s.hidden, s.index, s.done_count, s.loot ? s.loot.rows.map((r) => `${r.have}/${r.need}`).join(',') : '']
    .join('|')

let snapshot = build_snapshot()
/** @type {Set<() => void>} */
const listeners = new Set()

export const quest_store = {
  /** @returns {QuestSnapshot} a referentially-stable snapshot between changes (useSyncExternalStore-safe) */
  get: () => snapshot,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
}

/** Rebuild the snapshot; notify subscribers only when a render-affecting field actually changed. */
function refresh() {
  const next = build_snapshot()
  if (sig(next) === sig(snapshot)) return
  snapshot = next
  for (const cb of listeners) {
    try {
      cb()
    } catch {
      /* a listener must never break the store */
    }
  }
}

/** The reused reward beat: gold vignette flash + discovery chime + a success toast. Best-effort, never throws. */
function celebrate(index) {
  try {
    trigger_search_flash()
  } catch {
    /* presentation only */
  }
  try {
    play_discovery_sfx()
  } catch {
    /* presentation only */
  }
  try {
    const lang = i18n?.language || 'en'
    const id = QUESTS[index]?.id
    const quest = i18n.t(`quests.${id}_title`, { tool: item_label(TARGET_TOOL, lang) })
    push_event_toast({ state: 'success', title: i18n.t('quests.completed_toast', { quest }) })
  } catch {
    /* i18n not ready — the flash + chime still fired */
  }
}

/**
 * Fold one detection signal into the ladder. On a real completion: latch + persist + celebrate (unless
 * `silent`, used for the boot eval so a returning player already past a state-step isn't re-celebrated).
 * @param {{ kind: 'fight_won'|'items'|'equip'|'gather' }} signal @param {{ silent?: boolean }} [opts]
 */
function ingest(signal, { silent = false } = {}) {
  // (reduce_signal folds nothing into a dismissed ladder — no advance, no celebration.)
  const { progress: next, completed } = reduce_signal(progress, signal, current_items())
  if (completed.length) {
    progress = next
    save_progress(progress)
    if (!silent) celebrate(completed[completed.length - 1])
  }
  refresh()
}

// ── public actions (card buttons + the action-seam hooks) ────────────────────────────────────────

/** Skip the active quest (advances, NO celebration). */
export function skip_current() {
  const index = active_index(progress)
  if (index >= QUEST_COUNT) return
  progress = mark_skipped(progress, index)
  save_progress(progress)
  refresh()
}

/** Dismiss the whole ladder forever (the overflow "skip all"). */
export function skip_all() {
  progress = dismiss_all(progress)
  save_progress(progress)
  refresh()
}

/** An equip tx landed — completes the EQUIP quest when it is the active step. */
export function note_equip() {
  ingest({ kind: 'equip' })
}

/** A gather tx landed — completes the GATHER quest when it is the active step. */
export function note_gather() {
  ingest({ kind: 'gather' })
}

// ── detection wiring (once) ──────────────────────────────────────────────────────────────────────

let last_items = /** @type {any[] | null} */ (null)
let wired = false

function wire() {
  if (wired) return
  wired = true
  try {
    // FIGHT WIN — the victory-truth lane's resolve (dungeon_settlement.js dispatches it on a real win, xp>0).
    context.events.on('action/fight_result/resolve', () => ingest({ kind: 'fight_won' }))
    // LOOT / CRAFT — react to a real bag change only (STATE_UPDATED fires on every action; the items ref is
    // stable until action/sui_data replaces it).
    context.events.on('STATE_UPDATED', () => {
      const items = current_items()
      if (items === last_items) return
      last_items = items
      ingest({ kind: 'items' })
    })
  } catch {
    /* engine not ready — the card still renders from the persisted snapshot */
  }
  // Boot eval: complete any state-step already satisfied at load (returning player), silently.
  ingest({ kind: 'items' }, { silent: true })
  last_items = current_items()
}

wire()
