// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DungeonBoard's READY / END TURN / exit chrome. Split out of DungeonBoard.jsx (issue #2069);
// the render section is unchanged.
import { FightControls } from '../FightControls.jsx'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { is_active as phase_is_active, is_placement as phase_is_placement } from '../../../../fight-engine/phase.js'

/**
 * @returns {import('react').ReactElement}
 */
export function DungeonBoardControls({
  t,
  phase,
  dungeon,
  busy,
  run_pass_id,
  effective_pick,
  has_draft,
  leave_confirm,
  set_leave_confirm,
  on_end_turn,
  on_ready,
  on_leave_dungeon,
  on_leave_dungeon_confirmed,
}) {
  return (
    <>
      {/* ONE FightControls chrome for BOTH board phases (bottom-right, NOT nested in the transformed .dgb panel).
          FightControls itself switches by `fight.placement` (presence-truth): PLACEMENT → the big READY (fires the
          ONE place_at) + FORFEIT; ACTIVE → END TURN + FORFEIT. So the machine mounts it for is_placement OR
          is_active — the internal switch, not a second gate, decides which button shows (that was the D83-cascade
          fix: ONE canon card, never a double-button / a placement branch with no READY). Machine-derived so it
          never renders over a half-init board (mount decision) and the READY
          shows the instant the slice is in placement even if `dungeon.status` still lags (D89 presence-truth).
          S-80: FORFEIT (FightControls' own default + confirm, actions::abandon) needs no props here anymore — it
          works identically for a dungeon room fight or a bare world fight (both drive `use_dungeon`). A LIVE
          RunPass gets a SECOND, separately-labeled "leave dungeon" control alongside it (the pre-S-80 RUN door,
          dungeon::abandon) so the two stay honest — see the leave-dungeon block right below. */}
      {(phase_is_placement(phase) || phase_is_active(phase)) && (
        <div className="hud-bottom">
          <FightControls
            placement={phase_is_placement(phase)} /* W4/D77 steer-2: the MACHINE's verdict drives READY↔END-TURN,
              not the raw fight.placement flag (which stayed stale-TRUE after the chain went ACTIVE) */
            on_end_turn={on_end_turn}
            on_ready={on_ready} /* THE ready — fires the ONE place_at(picked), never the dead WS sender */
            end_label={t('dungeons.end_turn')}
            ready_label={t('dungeons.ready')}
            waiting_label={t('dungeons.waiting')}
            placement_deadline_ms={dungeon.placement_deadline_ms} /* D110: REAL chain force-start deadline */
            placement_label={(n) => t('dungeons.placement_starts_in', { n })}
            turn_deadline_ms={dungeon.turn_deadline_ms}
            fight_status={dungeon.status} /* #882: with the deadline above, the whole input of the expiry gate */
            has_turn_draft={has_draft}
            turn_deadline_label={(n) => t('dungeons.turn_deadline_in', { n })}
            abandon_disabled={busy}
            ready_disabled={effective_pick == null || busy} /* D109: seeded cell is the default pick → enabled */
          />
          {/* S-80: the RUN door (dungeon::abandon) — a SEPARATE, distinctly-labeled exit alongside FightControls'
              own fight-forfeit. Only on a genuine dungeon run (run_pass_id set); a bare world fight has no run to
              leave. Same red/danger chrome as DungeonLeaveButton's plane-only twin (`.hud-fightctl__abandon`).
              Design ruling (2026-07-12): no separate "leave dungeon" button while in fight — the forfeit
              action ends the fight, which inherently leaves the dungeon. During the ACTIVE fight the FightControls
              FORFEIT (actions::abandon) IS the exit — it dies, settles, and lands the player in the lobby (verified:
              dungeon_store.abandon_fight → terminal claim → collapse-to-lobby), so this redundant no-death door is
              hidden there. It stays through PLACEMENT (pre-combat) as a graceful, non-death exit before the fight begins. */}
          {run_pass_id != null && !phase_is_active(phase) && (
            <div className="hud-fightctl">
              <button
                type="button"
                className="hud-fightctl__btn hud-fightctl__abandon"
                onClick={on_leave_dungeon}
                disabled={busy}
              >
                {t('dungeons.leave_cta')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ROOM_CLEARED renders NO panel here — this board unmounts on clear (fight_mode drops); the player free-
          roams the plane and clicks the next mob cluster to advance (dungeon_dimension engage → start_next_room),
          with the reward recap sliding in (RewardRecap.jsx). WON/FAILED keep the board mounted so the terminal
          auto-claim above fires the Victory/Defeat summary card (FightResult / FightSummary). */}

      {/* LEAVE DUNGEON confirm — the in-app modal (never a native window.confirm); confirming runs the RUN
          abandon (dungeon::abandon). Unchanged copy/keys from before S-80 — that door only ever consumed the
          RunPass, no HP/death write, so the confirm copy never claimed a death (fixed to say so honestly). */}
      <ConfirmDialog
        open={leave_confirm}
        title={t('dungeons.abandon_confirm_title')}
        message={t('dungeons.abandon_confirm')}
        confirm_label={t('dungeons.abandon')}
        cancel_label={t('dungeons.abandon_keep')}
        danger
        on_confirm={on_leave_dungeon_confirmed}
        on_cancel={() => set_leave_confirm(false)}
      />
    </>
  )
}
