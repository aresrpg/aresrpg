// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Self plate (Option B "Minimal Float") — bottom-center, ALWAYS-ON exploration HP plate. Vitals
// (GameWorldHud.jsx) stays fight-only (HP + AP/MP pips); this is the lobby equivalent: level + name,
// an HP bar (value/max), and a thin XP sliver. HP/max/level derivation is copied verbatim from Vitals'
// selector (selected character + the active Expedition run) so the two bars never disagree.
//
// FEEL WAVE (F4): the plate is never static under a state change (micro-animation law). HP DRAIN leaves
// a trailing GHOST bar (the fast main fill snaps to the new value; a slower, delayed ghost fill lingers
// at the old width so the lost sliver reads as a receding drain). A DAMAGE moment micro-shakes the whole
// card (0.3s decaying jitter). An XP GAIN pulses the gold sliver (a brief bloom). All envelopes 0.15-0.4s.

import './game-world-hud.css'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { character_max_hp } from '../../../../chain/read_character.js'
import { experience_to_level, xp_progress } from '@aresrpg/sdk/experience'

import { use_projected_hp } from '../../../../hooks/use_projected_hp.js'
import { use_fight, use_game_state } from '../../../store.js'
import { use_expedition, STATUS_ACTIVE } from '../../../../roster/store'
import { world_fight_view } from '../../../../world-shell/fight_session_scope.js'

// `my_entity_id` comes from the CORE fight view (S2 mirror kill) — passed in, never re-read off game-core state.
const selected_character = (state, my_entity_id) =>
  state.sui.characters.find((character) => character.id === (my_entity_id ?? state.selected_character_id))

// `use_game_state` snapshots are compared with Object.is. Keep the rich row selector for rendering, plus this
// primitive HP revision so a source that preserves a hydrated row's identity still repaints the integer.
const character_hp_revision = (state, my_entity_id) => {
  const character = selected_character(state, my_entity_id)
  return [
    character?._type,
    character?.current_hp,
    character?.hp_updated_ms,
    character?.hp_previsional_ms, // #1643 — the previsional base is a projection input, so it is a repaint input
    character?.health,
    character?.experience,
    character?.level,
    character?.vitality,
    character?.gear_vitality,
    character?.equipment_stats?.vitality,
    character?.classe ?? character?.class,
  ].join(':')
}

// The last XP fraction we saw, persisted at MODULE scope (there is exactly one SelfPlate). XP almost
// always grows while the plate is UNMOUNTED (a fight awards it, then the plate remounts), so an in-mount
// ref would never see the jump — this lets the gold pulse fire once on the post-gain remount too.
let last_xp_pct = /** @type {number | null} */ (null)

/**
 * Fire a one-shot CSS-animation flag each time `signal` increments (retriggerable — the false→rAF→true
 * toggle forces the browser to replay the keyframes even on a back-to-back hit). @param {number} signal
 * @returns {boolean}
 */
function use_oneshot(signal) {
  const [on, set_on] = useState(false)
  useEffect(() => {
    if (signal === 0) return // no event yet
    set_on(false)
    const id = requestAnimationFrame(() => set_on(true))
    return () => cancelAnimationFrame(id)
  }, [signal])
  return on
}

/** @returns {import('react').ReactElement} */
export function SelfPlate() {
  const { t } = useTranslation()
  const fight = use_fight(world_fight_view)
  const me = fight && fight.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
  const character = use_game_state((state) => selected_character(state, fight?.my_entity_id ?? null))
  use_game_state((state) => character_hp_revision(state, fight?.my_entity_id ?? null))
  const expedition = use_expedition((s) => s.expedition)
  const run = !me && expedition?.status === STATUS_ACTIVE ? expedition : null

  const experience = character?.experience ?? 0
  const level = run?.char_level ?? experience_to_level(experience)
  // T76 HP TRUTH: in a fight `me` wins, on an active run `run` wins (live combat truth, untouched); OUT of both
  // (the lobby), project the on-chain current_hp so the plate reads honest HP, not stale full. The chain-exact
  // max (character_max_hp) pairs with current_hp's own scale — see read_character.js re: not get_max_health.
  const projection_live = !me && !run && Boolean(character?._type)
  const projected_health = use_projected_hp(character, projection_live)
  const health = me?.health ?? run?.carried_hp ?? projected_health ?? character?.health ?? 0
  const max_health = me ? me.health_max : run ? run.max_hp : character?._type ? character_max_hp(character) : 0
  const hp_pct = max_health > 0 ? Math.max(0, Math.min(100, (health / max_health) * 100)) : 0
  // XP bar — the SDK's SSOT progress-within-level helper (the single home for the level/xp-bar math the HUD
  // used to compute in four places — reuse it, don't re-derive). `into`/`span` are the current/needed
  // XP numbers shown beside the bar (same shape Stats.jsx renders); `pct` drives the fill width.
  const { into: xp_into, span: xp_span, pct: xp_pct } = xp_progress(experience)

  const name = character?.name || t('party.adventurer')

  // ── DAMAGE shake: fire when HP DROPS (per-mount ref so a post-fight remount at lower HP never false-shakes).
  const prev_hp = useRef(health)
  const [hit_signal, set_hit_signal] = useState(0)
  useEffect(() => {
    if (health < prev_hp.current) set_hit_signal((n) => n + 1)
    prev_hp.current = health
  }, [health])
  const shaking = use_oneshot(hit_signal)

  // ── XP pulse: fire when the gold sliver GROWS, comparing against the module-persisted last value so the
  // common case (XP awarded during a fight → plate remounts wider) still blooms once.
  const [xp_signal, set_xp_signal] = useState(0)
  useEffect(() => {
    if (last_xp_pct != null && xp_pct > last_xp_pct) set_xp_signal((n) => n + 1)
    last_xp_pct = xp_pct
  }, [xp_pct])
  const xp_pulsing = use_oneshot(xp_signal)

  return (
    <div className={`gw-selfplate gw-panel${shaking ? ' gw-selfplate--hit' : ''}`}>
      <div className="gw-selfplate__top">
        <span className="gw-selfplate__name">{name}</span>
        <span className="gw-selfplate__lvl">{t('party.level_chip', { level })}</span>
      </div>
      <div className="gw-selfplate__hp-row">
        <div className="gw-selfplate__hp-bar">
          {/* GHOST fill (behind) trails slowly + delayed → the receding "damage drain" sliver. */}
          <span className="gw-selfplate__hp-ghost" style={{ width: `${hp_pct}%` }} />
          <span className="gw-selfplate__hp-fill" style={{ width: `${hp_pct}%` }} />
        </div>
        <span className="gw-selfplate__hp-t">
          {health}/{max_health}
        </span>
      </div>
      <div className="gw-selfplate__xp-row">
        <div className={`gw-selfplate__xp-bar${xp_pulsing ? ' gw-selfplate__xp-bar--pulse' : ''}`}>
          <span className="gw-selfplate__xp-fill" style={{ width: `${xp_pct}%` }} />
        </div>
        <span className="gw-selfplate__xp-t">
          {xp_into.toLocaleString()}/{xp_span.toLocaleString()}
        </span>
      </div>
    </div>
  )
}
