// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Your-turn cue — the unmissable "it's your move" beat at the ACTIVE turn-start, closing the no-dead-interactions
// gap with a reference-feel turn banner. On the RISING EDGE of my active turn it fires a corpus-extracted ding
// (the reference corpus's sound for a new turn, replacing the synthesized chime that lived in sfx.js but was never
// wired) — and flashes a prominent top-center banner for ~1.5s, so control handing to the
// player is never silent (the placement→active handoff reading as "clicking doesn't move" was the real
// root cause). DOM-only; the 3D ground flash is the engine polish track. Never for a spectator (no turn).

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { play_sfx } from '../../core/audio/sfx.js'
import { use_fight_view } from '../../store.js'

export function TurnBanner() {
  const { t } = useTranslation()
  const fight = use_fight_view() // SYNCHRONOUS core truth (S2 mirror kill) — never the lagging copy
  // ACTIVE + mine + not over + not a spectator. Placement uses its own banner (FightPlacementBanner), so gate it out
  // here — the cue marks the transition INTO acting, which is exactly what the silent handoff was missing.
  // HANDOVER GATE (the turn order can already show my name and timer while other mobs are still moving): the
  // chain flips active_entity_id back to me the instant a mob cascade lands, but the paced replay is still
  // playing out AND the chain is still spending that cascade's resolution budget. Gate on `playable` — the SAME
  // folded fact the board's input arming and the END TURN control mount on (#1808) — so the "your turn" ding +
  // banner fire exactly once, when the turn is genuinely mine.
  const my_turn =
    !!fight &&
    !fight.placement &&
    fight.winner === -1 &&
    !fight.spectator &&
    fight.playable &&
    fight.active_entity_id != null &&
    fight.active_entity_id === fight.my_entity_id

  const turn_key = my_turn ? `${fight.fight_id}:${fight.active_entity_id}:${fight.turn_deadline_ms ?? 0}` : null
  const announced_turn = useRef(null)
  const [show, set_show] = useState(false)

  useEffect(() => {
    if (!turn_key || announced_turn.current === turn_key) return
    announced_turn.current = turn_key
    play_sfx('turn_start') // corpus-extracted ding — the reference corpus's sound for a new turn
    set_show(true)
    const id = setTimeout(() => set_show(false), 1500)
    return () => clearTimeout(id)
  }, [turn_key])

  if (!show) return null
  return (
    <div className="hud-turnbanner" role="status" aria-live="assertive">
      <span className="hud-turnbanner__title">{t('dungeons.your_turn')}</span>
    </div>
  )
}
