// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight turn controls — End-turn, Ready, and Forfeit grouped CENTER-BOTTOM next to the vitals card (a
// correction: they were scattered — end-turn in the turn list, ready floating center, leave-combat top-
// center). Big, clear targets sitting beside the bottom-center life card so the player's eyes never leave
// the action. Which control shows depends on the phase:
//   - PLACEMENT: the big READY button (force-start on all-ready or the 60s timer) + Forfeit.
//   - YOUR TURN: the big END TURN button + Forfeit.
//   - COMMITTING: END TURN stays visible but disabled; its countdown is gone.
//   - OTHERS' TURN / presenting: just Forfeit (End turn unmounts with its countdown).
//   - SPECTATING: local Leave spectate only; no participant or chain-write controls.
// FORFEIT (S-80): `actions::abandon` on the ENGINE package — you can abandon
// any fight; it's considered a death. Universal now (every fight type has this door — a WORLD fight used to
// have none, so it was hidden there); always present, always behind an in-app CONFIRM (never a native
// dialogs) that says outright the character dies. DISTINCT from a dungeon RUN's "leave dungeon" (that consumes
// the RunPass directly — no death, no loot): DungeonBoard renders that as its OWN separate control when a run
// is live; this component only ever owns the fight-forfeit door.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { turn_input_armed } from '../../../world-shell/voxel_fight_folds.js'
import {
  should_auto_end_turn,
  should_report_stall,
  turn_overdue_ms,
} from '../../../world-shell/fight_expiry_gate.js'
import { use_dungeon_turn } from '../dungeon-turn.js'
import { fight_store } from '@aresrpg/fight/store'
import { use_fight, use_fight_view } from '../../store.js'
import { push_event_toast } from '../../core/toast.js'
import { min_turn_left } from '@aresrpg/fight/project'
import { auto_commit_fire_at } from '@aresrpg/fight/draft_budget'
import { ConfirmDialog } from './world/ConfirmDialog.jsx'
import { copy_fight_bug_report, fight_bug_report_issue_url } from './fight_bug_report.js'

// DEFAULT handlers = the live on-chain path (the ONLY fight backend now the WS server is gone). The dungeon
// board INJECTS a richer End Turn (draft-flush) + Ready (place_at the picked cell) as props that ALWAYS win
// over these; FORFEIT has no richer injection to win over it — DungeonBoard relies on this SAME default (it
// drives the SAME `use_dungeon` store for both a dungeon room fight and a world fight — world_fight.js reuses
// the store wholesale), so one implementation correctly covers both fight types. Each store action self-guards
// on fight_id/character_id, so it safely no-ops with no live session.
const default_end_turn = () => use_dungeon.getState().commit_turn([]) // empty batch = pass the turn (act_pass)
const default_abandon = () => use_dungeon.getState().abandon_fight()
const default_leave_spectate = () => use_dungeon.getState().reset_local() // local-only: no seat and no chain write
const default_ready = () => {
  const pick = use_dungeon_turn.getState().placement_pick
  if (pick != null) use_dungeon.getState().place_at_cell(pick)
}

/**
 * One turn-control phase verdict for the END TURN button and its auto-commit cue. Resolve the actor through the
 * live fighter map, exactly like voxel_fight_adapter's input gate: an id without a fighter is a transient/incoherent
 * turn, never a playable one. `busy` flips synchronously when commit starts (before chain confirmation), while
 * `presenting` stays true while another actor's replay drains.
 * @param {any | null} fight
 * @param {boolean} busy
 * @param {string | null | undefined} [entity_id]
 * @returns {'hidden' | 'armed' | 'committing'}
 */
export function fight_turn_control_phase(fight, busy, entity_id = fight?.my_entity_id) {
  const active = fight?.active_entity_id ? fight?.fighters?.get?.(fight.active_entity_id) : null
  const chain_my_turn =
    !!fight && !fight.spectator && fight.winner === -1 && entity_id != null && active?.id === entity_id
  if (!turn_input_armed(chain_my_turn, false, !!fight?.presenting)) return 'hidden'
  return turn_input_armed(chain_my_turn, busy, false) ? 'armed' : 'committing'
}

/** The END TURN companion cue exists only in the same armed phase as the control itself. Pure.
 *  HONEST DEADLINE (#323): the cue counts to the AUTO-COMMIT FIRE moment (`auto_commit_fire_at` = deadline −
 *  COMMIT_BUFFER_MS), NOT the raw chain deadline — the SAME honest deadline FightTimeline shows. While a draft
 *  exists the turn LOCKS when the background commit fires (buffer seconds before the chain deadline), so counting
 *  to the raw deadline over-promised the drafting window by the buffer and the turn "auto-ended" while the cue
 *  still read time left. `turn_ms` feeds the short-admin-dial clamp (0 = the default deadline − buffer). */
export function turn_commit_countdown_s(turn_phase, has_draft, deadline_ms, now_ms, turn_ms = 0) {
  if (turn_phase !== 'armed' || !has_draft || !deadline_ms) return null
  return Math.ceil((auto_commit_fire_at(deadline_ms, turn_ms) - now_ms) / 1000)
}

/** Hook-free action seam: the real button used below and by the click fixture.
 * @param {{ phase: 'hidden' | 'armed' | 'committing', disabled?: boolean, on_end_turn: () => void,
 *   end_label: string, disabled_label?: string | null, title?: string }} props
 */
export function FightEndTurnButton({ phase, disabled = false, on_end_turn, end_label, disabled_label, title }) {
  if (phase === 'hidden') return null
  return (
    <button
      type="button"
      className="hud-fightctl__btn hud-fightctl__end"
      onClick={on_end_turn}
      disabled={disabled || phase !== 'armed'}
      title={title}
    >
      {disabled_label ?? end_label}
    </button>
  )
}

/**
 * Turn controls chrome (End turn / Ready / Forfeit). REUSABLE across every on-chain fight (world + dungeon —
 * both drive the same `use_dungeon` store). The DEFAULTS drive it directly (see above); the dungeon board
 * INJECTS its own End Turn/Ready handlers (the local turn-draft flush / the one placement pick) that override
 * them. FORFEIT owns its OWN in-app confirm (below) so every mount — including a bare one with no injected
 * props — gets the death warning before it ever signs; no caller needs to build its own modal for this door.
 * @param {{
 *   on_end_turn?: () => void, on_abandon?: () => void, on_ready?: () => void, on_leave_spectate?: () => void,
 *   end_label?: string, abandon_label?: string, ready_label?: string, waiting_label?: string,
 *   leave_spectate_label?: string,
 *   end_disabled?: boolean, abandon_disabled?: boolean, ready_disabled?: boolean,
 *   placement_deadline_ms?: number, placement_label?: (n: number) => string,
 *   turn_deadline_ms?: number, has_turn_draft?: boolean, auto_commit_label?: (n: number) => string,
 * }} [props]
 */
export function FightControls({
  on_end_turn = default_end_turn,
  on_abandon = default_abandon,
  on_leave_spectate = default_leave_spectate,
  on_ready, // dungeon injects the ONE place_at path; default (below) = place_at the explicit placement pick
  end_label = 'End turn',
  abandon_label,
  leave_spectate_label,
  ready_label,
  waiting_label,
  end_disabled,
  abandon_disabled = false,
  // FORFEIT presence (S-80: always shown now). Every on-chain fight has this door — a WORLD fight used to have
  // NONE (turns::crank only fires PAST the deadline, act_pass just ends your turn, and a dungeon-scoped RunPass
  // doesn't exist there), so it was hidden with `show_abandon={run_pass_id != null}`. `actions::abandon` closed
  // that gap for every fight type, so the old hiding is gone — this defaults true unconditionally.
  show_abandon = true,
  ready_disabled,
  // D110 (no visible placement countdown): the dungeon passes the REAL chain force-start deadline
  // (dungeon.placement_deadline_ms, a wall-clock epoch = flip + 60s) + an i18n label factory. FightControls owns
  // the 1Hz tick + clamp so the READY button shows a live "fight starts in Ns" — the same deadline
  // begin_active_if_expired liquidates on, so the number counts down to the auto-force-start. WS path omits both.
  placement_deadline_ms = 0,
  placement_label,
  // W4 (D77/steer-2): an EXPLICIT placement verdict from the phase machine. The dungeon passes the machine's
  // is_placement here so the READY↔END-TURN switch follows the RECONCILED phase, never the raw `fight.placement`
  // flag (which qa proved can stay stale-TRUE after the chain went ACTIVE → the READY rendered over a live board).
  // The WS path omits it → falls back to the slice flag (byte-identical legacy behaviour, no backend to diverge).
  placement: placement_override,
  // ACTIVE urgency cue. DungeonBoard supplies the chain deadline + draft presence + localized label; this
  // component owns their one clock and phase verdict so the cue cannot outlive the END TURN action.
  turn_deadline_ms = 0,
  has_turn_draft = false,
  auto_commit_label,
  // #882: the CHAIN status beside the chain deadline already drilled above — together they are the whole input
  // of the expiry gate (fight_expiry_gate.js), the SAME two fields the permissionless crank door watches. The
  // dungeon/world board passes `dungeon.status`; a mount that omits it simply never claims a fight is stalled.
  fight_status = null,
} = {}) {
  const { t } = useTranslation()
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)
  const busy = use_dungeon((s) => s.busy)
  // #921 ④ — IS THERE A CHAIN BEHIND THIS FIGHT? The auto-advance below embodies the post-deadline janitors,
  // and those are chain doors. Only a composition that has none says so (simulator/fight_shim.js seeds
  // `chain_backed: false`), so absence reads as the chain — a world/dungeon fight can never opt out by
  // omission.
  const chain_backed = use_dungeon((s) => s.chain_backed !== false)
  // THE CORE FLOOR (@aresrpg/fight store PLAYER_TURN_FLOOR_MS): min_turn_left reads the core's raw
  // `turn_started_at` — a field the projected view (`fight`, above) doesn't carry — so this subscribes to
  // the raw core state via the React binding (game/store.js use_fight; the core store itself is vanilla).
  const fight_state = use_fight()

  // S-80 FORFEIT confirm — in-app modal (never a native dialog, standing rule), owned HERE so every mount
  // gets it for free. Confirming runs `on_abandon` (default: the store's `abandon_fight`).
  const [confirm_open, set_confirm_open] = useState(false)

  // MIN-TURN gate — MUST precede the early return (Rules of Hooks); reads `fight` null-safely. FIGHTREAL finding:
  // the old client gate re-anchored per turn_deadline_ms and mis-scoped the 3s floor PER CAST; the core enforces
  // ONE floor per turn (turn_started_at stamped once, on the turn's own false→true edge — see fight/store.js).
  // The chain stays the real gate; this only spares the honest-toast abort.
  const turn_phase = fight_turn_control_phase(fight, busy)
  const [now_ms, set_now_ms] = useState(() => Date.now())
  const min_turn_left_ms = min_turn_left(fight_state, now_ms)
  const min_turn_gating = min_turn_left_ms > 0
  const placement = placement_override != null ? placement_override : !!fight?.placement && fight?.winner === -1
  const has_placement_deadline = placement_deadline_ms > 0
  const has_turn_deadline = !placement && turn_phase === 'armed' && has_turn_draft && turn_deadline_ms > 0
  const chain_turn = { status: fight_status, turn_deadline_ms }
  // One clock for every countdown rendered by this action bar. The old DungeonBoard urgency interval was a
  // parallel renderer that survived commit-phase changes; it is deliberately gone. A live chain deadline joins
  // it (#882): the stalled notice must appear when the deadline actually lapses, not when a poll next lands.
  const clock_live =
    min_turn_gating ||
    (placement && has_placement_deadline) ||
    has_turn_deadline ||
    (!placement && fight_status != null && turn_deadline_ms > 0)
  useEffect(() => {
    if (!clock_live) return undefined
    const id = setInterval(() => set_now_ms(Date.now()), min_turn_gating ? 200 : 1000)
    return () => clearInterval(id)
  }, [clock_live, min_turn_gating])

  // Commit-pending stays mounted but disabled. An actor/presentation phase change is `hidden`, so the same model
  // unmounts the action and removes its companion cue. Hoisted above the early return: the auto-advance below
  // is a hook and must read the SAME armed verdict the button does.
  const end_is_disabled = (end_disabled ?? false) || min_turn_gating

  // ── #921 · AN EXPIRED TURN ADVANCES ITSELF; IT IS NEVER NARRATED ────────────────────────────────────────
  // Two banners used to print operational instructions about deadlines — "your turn is late, press END TURN",
  // "this fight is stalled, forfeit". Both told the player to do what the client can simply DO, and deadline
  // machinery is not game grammar. So:
  //   · MY overdue turn      → auto-press END TURN. The chain grants the late press grace (turns.move:177),
  //                            which is exactly why the banner could say "press it" — so press it.
  //   · SOMEONE ELSE'S       → the permissionless `turns::crank`, which every watching client already fires
  //                            from its own poll (fight-liquidation.js, jitter + single-flight + the
  //                            executed-failure latch). One home; nothing is re-fired from here.
  //   · NEITHER WORKED       → one console.error naming the fight and its state. Developer telemetry, not
  //                            player prose. FORFEIT stays where it always was, without a sign pointing at it.
  //
  // IT ARMS ON CHAIN SEMANTICS ALONE (`chain_backed`, above). The simulator's local sim stamps a turn
  // deadline off its OWN wall clock, so the predicate alone would happily fire there — auto-passing the turn
  // of a theorycrafter who is reading the board. It is the composition, not the clock, that decides.
  const bar_state = { turn_phase, end_armed: !end_is_disabled, busy }
  const auto_end = chain_backed && should_auto_end_turn(chain_turn, bar_state, now_ms)
  const report_stall = chain_backed && should_report_stall(chain_turn, bar_state, now_ms)
  const auto_ended_for = useRef(0)
  const reported_stall_for = useRef(0)
  useEffect(() => {
    if (!auto_end || auto_ended_for.current === turn_deadline_ms) return
    auto_ended_for.current = turn_deadline_ms // once per deadline — a fresh turn is a fresh key
    on_end_turn()
  }, [auto_end, turn_deadline_ms, on_end_turn])
  useEffect(() => {
    if (!report_stall || reported_stall_for.current === turn_deadline_ms) return
    reported_stall_for.current = turn_deadline_ms
    console.error('[fight] expired turn could not be advanced', {
      fight_id: fight?.fight_id ?? null,
      status: fight_status,
      turn_deadline_ms,
      active_entity_id: fight?.active_entity_id ?? null,
      my_entity_id: fight?.my_entity_id ?? null,
      overdue_ms: turn_overdue_ms(chain_turn, now_ms),
    })
    // `now_ms` deliberately absent: it ticks every second and would re-run this on a latch that already holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report_stall, turn_deadline_ms, fight, fight_status])

  if (!fight) return null

  const i_am_ready = fight.my_entity_id != null && fight.ready.has(fight.my_entity_id)
  const abandon_button_label = abandon_label ?? t('dungeons.abandon_fight')

  // D110: seconds until the chain force-starts the fight (begin_active_if_expired). Clamped ≥0; shown only in
  // placement with a real deadline + a label factory (the dungeon path).
  const countdown_s =
    placement && has_placement_deadline ? Math.max(0, Math.ceil((placement_deadline_ms - now_ms) / 1000)) : null
  const commit_in_s = turn_commit_countdown_s(turn_phase, has_turn_draft, turn_deadline_ms, now_ms, fight?.turn_ms ?? 0)
  const show_commit_cue = !placement && commit_in_s != null && commit_in_s <= 15 && !!auto_commit_label

  const on_forfeit_confirmed = () => {
    set_confirm_open(false)
    on_abandon()
  }

  // Issue #166 / #885 — the only effect edge for the compact report: snapshot the fight core at PRESS, open
  // GitHub's new-issue page ALREADY PREFILLED (title + body skeleton) so Create is the last remaining click,
  // and copy the trace locally for the one paste the URL cannot carry. The window.open is SYNCHRONOUS inside
  // the click: deferring it behind the clipboard promise is what popup blockers kill. Clipboard rejection is
  // still surfaced — the issue page stands on its own, the reporter just has no trace to paste.
  const on_bug_report = () => {
    const state = fight_store.getState()
    if (typeof window !== 'undefined')
      window.open(fight_bug_report_issue_url(state), '_blank', 'noopener,noreferrer')
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
    if (!clipboard?.writeText) {
      push_event_toast({ state: 'error', title: t('fight.bug_report_copy_failed') })
      return
    }
    void copy_fight_bug_report(state, (blob) => clipboard.writeText(blob)).then(
      () => push_event_toast({ state: 'success', title: t('fight.bug_report_copied') }),
      () => push_event_toast({ state: 'error', title: t('fight.bug_report_copy_failed') })
    )
  }

  if (fight.spectator)
    return (
      <div className="hud-fightctl">
        <span className="hud-fightctl__watching">{t('fights.spectating')}</span>
        <button type="button" className="hud-fightctl__btn hud-fightctl__abandon" onClick={on_leave_spectate}>
          {leave_spectate_label ?? t('fights.leave_spectate')}
        </button>
        <button type="button" className="hud-fightctl__btn hud-fightctl__report" onClick={on_bug_report}>
          {t('fight.bug_report')}
        </button>
      </div>
    )

  return (
    <>
      {show_commit_cue && (
        <div className="dgb-commit-cue" role="status">
          {auto_commit_label?.(Math.max(0, commit_in_s ?? 0))}
        </div>
      )}
      <div className="hud-fightctl" data-controlled-character={fight.my_entity_id ?? undefined}>
        {placement && countdown_s != null && placement_label && (
          <span className="hud-fightctl__countdown" role="status" aria-live="polite">
            {placement_label(countdown_s)}
          </span>
        )}
        {placement ? (
          <button
            type="button"
            className={`hud-fightctl__btn hud-fightctl__ready${i_am_ready ? ' is-ready' : ''}`}
            onClick={on_ready ?? default_ready}
            disabled={(ready_disabled ?? false) || i_am_ready}
          >
            {i_am_ready ? (waiting_label ?? 'Waiting…') : (ready_label ?? 'Ready')}
          </button>
        ) : (
          <FightEndTurnButton
            phase={turn_phase}
            on_end_turn={on_end_turn}
            disabled={end_is_disabled}
            end_label={end_label}
            disabled_label={min_turn_gating ? `${end_label} · ${Math.ceil(min_turn_left_ms / 1000)}` : null}
            title={min_turn_gating ? t('errors.turn_too_fast') : undefined}
          />
        )}
        {show_abandon && (
          <button
            type="button"
            className="hud-fightctl__btn hud-fightctl__abandon"
            onClick={() => set_confirm_open(true)}
            disabled={abandon_disabled}
          >
            {abandon_button_label}
          </button>
        )}
        <button
          type="button"
          className="hud-fightctl__btn hud-fightctl__report"
          onClick={on_bug_report}
        >
          {t('fight.bug_report')}
        </button>
      </div>
      <ConfirmDialog
        open={confirm_open}
        title={t('dungeons.abandon_fight_confirm_title')}
        message={t('dungeons.abandon_fight_confirm')}
        confirm_label={abandon_button_label}
        cancel_label={t('dungeons.abandon_keep')}
        danger
        on_confirm={on_forfeit_confirmed}
        on_cancel={() => set_confirm_open(false)}
      />
    </>
  )
}
