// Turn order — INDEPENDENT floating cards (no containing panel). Each fighter in the
// resolved initiative order (the server's interleaved `turn_order`) is its OWN card, ported from the
// approved initiative tokens in public/hud-design/demo-tacticians-table.html (the `.token` row: an
// independent flex item per fighter, active scales up + accent border, enemy = red border, dead dims).
// Lifted into the house tokens and extended to a SQUARE portrait + name + "Lv N" +
// a RED-gradient HP bar with the raw health number. The active card additionally shows the 30s turn
// timer (from `turn_deadline_ms`) and OWNS the final-5s `warn` tick SFX (S-71 §2.1) — the old comment
// here claiming "the fight overlay" owned that beep was stale (fight-overlay.js was deleted; nothing
// replaced it, so the beep was silent until this wire).
// The turn controls (End-turn / Ready / Abandon) live CENTER-BOTTOM next to the vitals card (FightControls),
// NOT in this left column — this is the read-only initiative timeline only.

import { useEffect, useRef } from 'react'

import { play_fight_sfx } from '../../core/audio/sfx.js'
import { fight_store } from '@aresrpg/fight'
import { use_fight_view } from '../../store.js'
import { COMMIT_BUFFER_MS, effective_deadline } from '@aresrpg/fight'
import { Tooltip } from './Tooltip.jsx'
import { EffectBadges } from './EffectBadges.jsx'
import { game_log } from '../../../core/log.js'

// [fight-polish 07-12] Active-turn highlight variant switch (a real highlight, not a blue border).
// 'a' = gold-filled row + glow (SHIPPED); 'b' = gold edge + bigger scale + brightened portrait. Both styled in
// hud.css (.hud-turn.active.active-a / .active-b). Trivial const so the pick can flip post-hoc.
const ACTIVE_HIGHLIGHT_VARIANT = 'a'

export function FightTimeline() {
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)
  const deadline = fight?.turn_deadline_ms ?? 0
  // Time is a reducer INPUT: one 4/s clock folds auto-commit against the current deadline and also notifies the
  // projection subscribers that repaint this countdown. Draft count already lives in the reducer-owned staged
  // queue; busy + executed-failure feedback re-enters the same door from the transaction edge.
  useEffect(() => {
    if (deadline <= 0) return
    const tick = () => {
      fight_store.getState().input({ type: 'tick' }, Date.now())
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [deadline])

  // Turn-timer window: the bar must diminish from the START of the turn to 0 — not sit static full
  // for the first N seconds then drop. The turn's TOTAL length is unknown here (dungeon = 90s, a duel could
  // differ), so capture it the FIRST time we see each deadline (≈ turn start) and fill = remaining / total.
  // Ref-during-render, guarded by a deadline change, is idempotent (no extra render).
  // Same my-turn gate TurnBanner.jsx uses for the 'turn' chime — the 5s tick is part of the SAME
  // silence-zone contract (§3.2) so it must agree on whose turn counts as "mine" (never a spectator,
  // never mid-placement, never after the fight resolves, and — design ruling 2026-07-12 — never while the mob cascade
  // is still presenting: the chain hands the turn back to me before the paced replay drains, so !presenting
  // keeps the warn cue + active/timer following the PRESENTATION clock, matching DungeonBoard's my_turn).
  const my_turn =
    !!fight &&
    !fight.placement &&
    fight.winner === -1 &&
    !fight.spectator &&
    !fight.presenting &&
    fight.active_entity_id != null &&
    fight.active_entity_id === fight.my_entity_id

  const turn_window = useRef({ deadline: 0, total: 0 })
  if (deadline > 0 && deadline !== turn_window.current.deadline)
    turn_window.current = { deadline, total: Math.max(1, deadline - Date.now()) }

  // FIX 2 (the visible timer read "8s left" while the draft had already auto-committed): when I hold a
  // live draft on MY turn the turn EFFECTIVELY ends at the auto-commit moment (deadline − COMMIT_BUFFER_MS), so
  // the visible clock counts to THAT — one honest deadline, never "time left but locked". Idle (no draft) counts
  // to the raw deadline (the turn runs full length; liquidation ends it there). The draft-presence read is an
  // UNCONDITIONAL store selector (Rules of Hooks) gated by my_turn — the SAME store DungeonBoard drafts into.
  const has_draft = my_turn && (fight?.draft_count ?? 0) > 0
  const eff_deadline = effective_deadline(deadline, has_draft, COMMIT_BUFFER_MS, fight?.turn_ms)
  const remaining_ms = deadline > 0 ? Math.max(0, eff_deadline - Date.now()) : 0
  const remaining_s = deadline > 0 ? Math.ceil(remaining_ms / 1000) : null

  // Turn timer, final 5s (S-71 §2.1): retrigger the unwired `warn` cue once per in-game second for the
  // LAST 5 SECONDS of MY OWN turn only — audio is scarcer than the visual (the `urgent` class arms at
  // ≤10s). `last_warn_s` dedupes the 4/s render tick above so each second fires exactly once.
  const last_warn_s = useRef(null)
  useEffect(() => {
    if (!my_turn || remaining_s == null || remaining_s < 1 || remaining_s > 5) {
      last_warn_s.current = null
      return
    }
    if (last_warn_s.current === remaining_s) return
    last_warn_s.current = remaining_s
    play_fight_sfx('warn')
  }, [my_turn, remaining_s])

  // P0 GEOMETRY PROBE (crop ticket, rounds 3+4): fires ONCE per fight, on the first render with an ACTIVE
  // card (post-placement — so the horizontal active-vs-clip pair below is never undefined in the capture),
  // so the NEXT crop report carries ground truth (viewport, live scale, the rendered band, the
  // active card's right edge) instead of an ambiguous screenshot from a possibly-stale pre-fix session
  // (NO_HMR). Permanent telemetry, not throwaway.
  const probed_fight = useRef(false)
  useEffect(() => {
    if (!fight) return void (probed_fight.current = false)
    if (probed_fight.current || fight.active_entity_id == null) return
    probed_fight.current = true
    const turns = /** @type {HTMLElement | null} */ (document.querySelector('.hud-turns'))
    const r = turns?.getBoundingClientRect()
    // horizontal pair (round 4 — the crop was horizontal): the ACTIVE card's transformed right edge
    // vs the column's real clip edge (padding-box right minus any painted scrollbar). active_right >
    // clip_right = the card IS cropped, whatever the vertical numbers say.
    const active = turns?.querySelector('.hud-turn.active')?.getBoundingClientRect()
    game_log('fight-timeline', 'mount probe', {
      w: innerWidth,
      h: innerHeight,
      dpr: devicePixelRatio,
      ui_scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'),
      turns_top: r?.top,
      turns_bottom: r?.bottom,
      turns_height: r?.height,
      turns_scrollHeight: turns?.scrollHeight,
      active_right: active?.right,
      // clientWidth is LAYOUT px; rects are post-transform (×ui-scale) — scale by the rendered/layout ratio
      clip_right: turns && r ? r.left + turns.clientWidth * (r.width / turns.offsetWidth) : undefined,
      chat_height: document.querySelector('.gw-chat')?.getBoundingClientRect().height,
    })
  }, [fight])

  if (!fight) return null

  const fighters = fight.turn_order.flatMap((id) => {
    const f = fight.fighters.get(id)
    return f ? [f] : []
  })

  // fraction of the (draft-effective) turn window still left → the bar shrinks from 100% at turn start to 0 at the
  // SAME moment the visible seconds hit 0 (deadline − buffer while a draft exists, the raw deadline when idle).
  const effective_buffer = has_draft ? deadline - eff_deadline : 0
  const eff_total = has_draft ? Math.max(1, turn_window.current.total - effective_buffer) : turn_window.current.total
  const timer_pct = eff_total > 0 ? Math.min(100, (remaining_ms / eff_total) * 100) : 0

  // No containing panel — a transparent flow host laying out the independent cards in a row.
  return (
    <div className="hud-turns">
      {fighters.map((f, i) => {
        const team = f.team === 0 ? 'ally' : 'enemy'
        const controlled = fight.controlled_entity_ids?.includes(f.id) ?? false
        // PRESENTATION-SYNCED active card (rebuilt 07-17): the highlight follows the clock the
        // EYE is on — while the mob cascade replays, the currently-animating wave turn's fighter
        // (presenting_entity_id) holds the card; once the wave drains, the chain's active_entity_id (me) takes
        // over. My own card can never light up over a still-playing mob beat, and the acting mob finally can.
        const shown_active_id = fight.presenting ? fight.presenting_entity_id : fight.active_entity_id
        const active = f.id === shown_active_id && fight.winner === -1
        // LEG P (packages/fight project.js engine_view): `presented_health` holds the last COMMITTED value while
        // a wave presents (never jumps ahead of the beat) and, once idle, holds committed truth over my own
        // not-yet-confirmed optimistic prediction (`health`) — the timeline card is the "safe" chain-anchored
        // read; `?? f.health` is only the pre-merge fallback for a fixture/build that hasn't picked up the getter.
        const hp = f.presented_health ?? f.health
        const hp_pct = f.health_max > 0 ? Math.max(0, Math.min(100, (hp / f.health_max) * 100)) : 0
        return (
          <div
            key={`${f.id}-${i}`}
            className={`hud-turn ${team}${active ? ` active active-${ACTIVE_HIGHLIGHT_VARIANT}` : ''}${f.dead ? ' dead' : ''}${controlled ? ' cursor-pointer' : ''}`}
            role={controlled ? 'button' : undefined}
            tabIndex={controlled ? 0 : undefined}
            aria-label={controlled ? f.name : undefined}
            // multi-char select: S3 (core my_key switch) — action/fight/select_controlled_character's fold case
            // retired with the 25-case packet fold; single-controlled behavior is the whole of S2, so a click/
            // Enter on an already-controlled card is a no-op rather than a dead dispatch.
            onClick={controlled ? () => {} : undefined}
            onKeyDown={
              controlled
                ? (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                  }
                : undefined
            }
          >
            <div className="hud-turn__portrait" aria-hidden="true">
              {f.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="hud-turn__body">
              <div className="hud-turn__id">
                <span className="hud-turn__name">{f.name}</span>
                <span className="hud-turn__lvl hud-num">Lv {f.level}</span>
              </div>
              <Tooltip text={`${hp} / ${f.health_max} HP`}>
                <div className="hud-turn__hp">
                  <div className="hud-turn__hp-fill" style={{ width: `${hp_pct}%` }} />
                  <span className="hud-turn__hp-num hud-num">{hp}</span>
                </div>
              </Tooltip>
              {/* PERSISTENT EFFECTS (a fighter's nametag must show any active effect and for how
                  much turn") — f.effects is a BLOCKED-COORDINATE getter (see EffectBadges.jsx docblock): absent
                  on every fighter until packages/fight's engine_view projects it, so this renders nothing at
                  HEAD today and lights up the instant the getter merges. Own + enemy + peer all get it — chain
                  truth is public. */}
              <EffectBadges effects={f.effects} />
              {active && !fight.presenting && remaining_s != null && (
                <div className="hud-turn__timer">
                  <div
                    className={`hud-turn__timer-fill${remaining_s <= 10 ? ' urgent' : ''}`}
                    style={{ width: `${timer_pct}%` }}
                  />
                  <span className="hud-turn__timer-num hud-num">{remaining_s}s</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
