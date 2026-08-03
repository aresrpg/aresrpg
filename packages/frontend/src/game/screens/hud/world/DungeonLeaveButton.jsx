// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The PLANE "Leave dungeon" HUD button (unconditional) — the SIBLING of the mid-fight
// ABANDON. During an ACTIVE board fight the FightControls ABANDON (bottom-right) is the exit; on the plane
// (OPEN waiting-room / ROOM_CLEARED between rooms) that control isn't mounted, so the ONLY "exit" was the
// dungeon modal's ✕ — which closed the modal but never unescrowed the character (a player could get stranded in an OPEN
// dungeon). This restores an always-there exit for the WHOLE session: same bottom-right slot + chrome as the
// mid-fight abandon (consistent grammar — in a fight = abandon; on the plane = leave). It hides during the
// ACTIVE fight (FightControls owns the exit there) and during the terminal card (WON/FAILED — nothing to
// abandon; the result card owns the close), so there's never a double-exit and never a wrong-state abandon.
//
// ConfirmDialog (never a native dialog — standing house law), with HONEST copy that differs by state:
//   - OPEN/waiting  → "Leave the dungeon? Your character returns."   (never fought — a clean exit)
//   - ROOM_CLEARED  → "Abandon the dungeon? Your character's HP drops to 0."  (mid-run — reuses the abandon copy)
// Confirm → dungeon_store.abandon() (unescrows the char; works on OPEN — dungeon_claim asserts only
// is_participant). No chain jargon; one self-mutating toast is owned by abandon() itself.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { fight_scope_sim, fight_session_in_scope } from '../../../../world-shell/fight_session_scope.js'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { useFightPhase } from './use_fight_phase.js'
import { should_mount_board, should_show_result } from '../../../../fight-engine/phase.js'

const STATUS_OPEN = 0

/** @returns {import('react').ReactElement | null} */
export function DungeonLeaveButton() {
  const { t } = useTranslation()
  const in_session = use_dungeon(s => s.in_session)
  const fight_id = use_dungeon(s => s.fight_id)
  const run_pass_id = use_dungeon(s => s.run_pass_id)
  // DECLINED (#1993 carve-out): this IS `fight_visible_view.turn.status` — the same `projected_status(s)`,
  // reached through `use_dungeon`'s mirror of the fight store. It stays put on purpose. Every other read in this
  // hook is a genuine run-session fact (latches, flight flags, the abandon doors), so migrating this one scalar
  // would subscribe a dungeon-session control to the fight projection — a re-render on every fight publish to
  // remove one mirror hop. It migrates for free when the surrounding session facts get their own record.
  const status = use_dungeon(s => s.dungeon?.status)
  const busy = use_dungeon(s => s.busy)
  const spectating = use_dungeon(s => s.spectating)
  const simulator_session = use_dungeon(s => fight_session_in_scope(s, fight_scope_sim))
  const abandon = use_dungeon(s => s.abandon)
  const abandon_fight = use_dungeon(s => s.abandon_fight)
  const reset_local = use_dungeon(s => s.reset_local)
  // W4: the single-exit coordination is now a MACHINE READ, not the DungeonBoard-written `hud_mounted` flag.
  // The board's own ABANDON is THE exit exactly when the board is mounted (PLACEMENT/ACTIVE); the result card
  // owns the close in TERMINAL. So this fallback shows on every OTHER escrowed state (plane OPEN/ROOM_CLEARED,
  // and any half-init hold where the board deliberately did NOT mount) — never a double-exit, never zero.
  const phase = useFightPhase()
  const [confirm, set_confirm] = useState(false)

  // P0 STRANDED WORLD FIGHT: a BARE world fight reuses this store with run_pass_id:null AND in_session:false
  // (world_fight.js), so the old `in_session` gate hid this escape for it. But a latched fight_id IS an escrowed
  // on-chain seat — when its board can't mount (the coords guard refused an unplaceable anchor, or a half-init
  // hold parks the phase at ROAM), this was the ONLY missing exit ⇒ a LIVE fight with NO reachable UI (a player
  // could get stuck in ROAM with a latched character). A latched fight_id/run_pass_id is a live session too. The door then
  // forks: a world fight forfeits via `abandon_fight` (actions::abandon — a death); a dungeon run leaves via
  // `abandon` (dungeon::abandon — consumes the RunPass). Mutually exclusive with the board's own FightControls
  // ABANDON by the should_mount_board gate below, so never a double-exit.
  const world_fight = fight_id != null && run_pass_id == null
  const latched = in_session || fight_id != null || run_pass_id != null

  // D59e (regression: a stuck session with NO exit): this is now the ALWAYS-THERE, HUD-INDEPENDENT escape for EVERY
  // escrowed state (OPEN / PLACEMENT / ACTIVE / ROOM_CLEARED — and even mid-init when status is still
  // undefined). The old gate hid it during ACTIVE "because FightControls owns the exit there" — but when the
  // fight HUD half-inits (board mounts, FightControls never does), that left ZERO exits and stranded him in a
  // fight he never chose. Any status can be abandoned. Only the TERMINAL cards (WON/FAILED — the result card
  // owns the close) suppress it. Rendered in the BOTTOM-RIGHT card slot —
  // the top-right position is DEAD everywhere; the player learns ONE place for exit controls. Presence
  // rule below still guarantees it never coexists with FightControls' abandon.
  // Single-exit law: the fight HUD's ABANDON is THE exit while the board is mounted — this fallback renders
  // ONLY when the board is absent (half-init / plane states) AND no result card owns the close. Machine-derived
  // so it can never disagree with what actually mounted (the old `hud_mounted` flag could lag a frame).
  const show = latched && !should_mount_board(phase) && !should_show_result(phase)
  if (simulator_session || !show) return null

  // A WATCH session owns no participant and must never expose either chain abandon door. During initial sync (or
  // an honest half-init hold) this is the reachable local-only escape; ACTIVE uses FightControls' identical door.
  if (spectating)
    return (
      <div className="hud-leave-persistent">
        <div className="hud-fightctl">
          <button type="button" className="hud-fightctl__btn hud-fightctl__abandon" onClick={reset_local}>
            {t('fights.leave_spectate')}
          </button>
        </div>
      </div>
    )

  const open_leave = status === STATUS_OPEN
  const on_confirmed = async () => {
    set_confirm(false)
    if (world_fight) await abandon_fight()
    else await abandon()
  }

  // Copy by door: a WORLD-fight forfeit is a DEATH (actions::abandon — same warning FightControls shows); a dungeon
  // leave/abandon keeps its run copy (clean OPEN exit vs mid-run abandon). CTA reads FORFEIT for the fight, LEAVE
  // for the plane, so the grammar matches what actually happens on confirm.
  const cta = world_fight ? t('dungeons.abandon_fight') : t('dungeons.leave_cta')
  const dlg = world_fight
    ? {
        title: t('dungeons.abandon_fight_confirm_title'),
        message: t('dungeons.abandon_fight_confirm'),
        confirm: t('dungeons.abandon_fight'),
        cancel: t('dungeons.abandon_keep'),
      }
    : open_leave
      ? {
          title: t('dungeons.leave_cta'),
          message: t('dungeons.leave_confirm'),
          confirm: t('dungeons.leave_cta'),
          cancel: t('dungeons.close'),
        }
      : {
          title: t('dungeons.abandon_confirm_title'),
          message: t('dungeons.abandon_confirm'),
          confirm: t('dungeons.abandon'),
          cancel: t('dungeons.abandon_keep'),
        }

  return (
    <>
      <div className="hud-leave-persistent">
        {/* CANON: the chrome is scoped `.hud-fightctl .hud-fightctl__btn` — the wrapper IS part of the
            component; without it the same classes render as bare text (a prior regression class). */}
        <div className="hud-fightctl">
          <button
            type="button"
            className="hud-fightctl__btn hud-fightctl__abandon"
            onClick={() => !busy && set_confirm(true)}
            disabled={busy}
          >
            {cta}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        title={dlg.title}
        message={dlg.message}
        confirm_label={dlg.confirm}
        cancel_label={dlg.cancel}
        danger
        on_confirm={on_confirmed}
        on_cancel={() => set_confirm(false)}
      />
    </>
  )
}
