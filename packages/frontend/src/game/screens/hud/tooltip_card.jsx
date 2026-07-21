// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE presentational card for the board-hover fight tooltip — the hovered fighter's name + HP head (with the
// predicted life-swing folded INSIDE the hp parens) and the preview lines (kill / effects / push). Split into its
// OWN dependency-free module (target_outcome.js's precedent) so renderToStaticMarkup unit-tests the markup WITHOUT
// dragging in the wiring shell's store/auth graph (EntityTooltip → store.js → Enoki, which needs a browser window).
// Pure props (`t` rides in). The shell (EntityTooltip) owns the store reads + on-screen positioning; this owns DOM.

import { EMPTY_OUTCOME } from './target_outcome.js'
import { seed_effect_line, seed_effect_parts } from './seed-effect-line.js'
import { project_spell_effect } from './fight-spells.js'

// (#301) the nametag stays SMALL — beyond this many LIVE persistent effects, one "+N" overflow marker.
// EffectBadges.jsx's MAX_VISIBLE precedent, independently tuned: this card is narrower than the turn-order
// sidebar it sits beside.
const MAX_STATUS_DOTS = 4

/**
 * (#301) The hovered fighter's currently ACTIVE persistent effects — buffs/debuffs already ON them (the
 * fight-state truth: sim/effect_board.js FighterStatus rows, projected through engine_view as `fighter.effects`)
 * — as a capped colored-dot model. Distinct from `effects` below (the ARMED-SPELL preview lines: what a cast
 * WOULD do). Each dot's colour reuses the SAME kind→tone grammar seed_effect_parts already assigns that
 * effect's value on the spell card (element hue for damage-class DoTs, buff-green / penalty-red for stat/state
 * kinds) — no invented palette, no new asset pipeline (v1: a colored dot + an overflow count).
 * @param {(key: string, params?: object) => string} t
 * @param {{ id?: string|number, kind: number, remaining_turns: number, element?: number|null, value?: number|null,
 *   stat?: number|null, chance?: number|null }[] | undefined} raw_statuses
 * @returns {{ dots: { id: string, color: string }[], overflow: number }}
 */
export const status_dot_view = (t, raw_statuses) => {
  const active = (raw_statuses ?? []).filter((row) => (Number(row?.remaining_turns) || 0) > 0)
  const dots = active.slice(0, MAX_STATUS_DOTS).map((row, i) => {
    const parts = seed_effect_parts(t, project_spell_effect(row))
    return { id: row.id ?? `${row.kind}-${i}`, color: parts.dot ?? parts.tone }
  })
  return { dots, overflow: Math.max(0, active.length - dots.length) }
}

/**
 * @param {{ team: number, style: any, exiting: boolean, name: string, shown_hp: number,
 *   outcome: any, is_crit?: boolean, displacement: any, effects?: any[], status_effects?: any[], t: Function }} props
 */
export function TooltipCard({
  team,
  style,
  exiting,
  name,
  shown_hp,
  outcome,
  is_crit,
  displacement,
  effects,
  status_effects,
  t,
}) {
  const o = outcome ?? EMPTY_OUTCOME
  const dmg = o.delta < 0 ? -o.delta : 0 // life reduction magnitude (red "−N")
  const heal = o.delta > 0 ? o.delta : 0 // heal magnitude (green "+N")
  const push = displacement
  const fx_lines = effects ?? [] // secondary effects (DoT/states/buffs) — the immediate hit rides the head
  const has_preview = o.kills || push || fx_lines.length > 0
  // DETERMINISTIC CRIT (#163): a crit is a FACT, not a chance — owner's ruling is to show it IN the (−X), bold +
  // orange, with NO second line. The resolved life-swing already IS the crit number; the modifier is the whole
  // tell. (A crit heal takes the same modifier — a crit is a crit whichever way the life swings.)
  const crit_mod = is_crit ? ' ent-tt__delta--crit' : ''
  const { dots, overflow } = status_dot_view(t, status_effects)

  // The head line (name + tweened hp + the predicted life-swing; a crit paints the figure orange). While aiming,
  // the kill / effect / displacement lines follow — the crit no longer earns a line of its own.
  return (
    <div className={`ent-tt ${team === 0 ? 'ally' : 'enemy'}${exiting ? ' ent-tt--out' : ''}`} style={style}>
      <div className="ent-tt__head">
        <span className="ent-tt__dot" aria-hidden="true" />
        <span className="ent-tt__name">{name || t('fight.fighter')}</span>
        <span className="ent-tt__hp-paren">
          ({shown_hp}
          {dmg > 0 && <span className={`ent-tt__delta ent-tt__delta--dmg${crit_mod}`}> −{dmg}</span>}
          {heal > 0 && <span className={`ent-tt__delta ent-tt__delta--heal${crit_mod}`}> +{heal}</span>})
        </span>
      </div>
      {/* (#301) PERSISTENT STATUS DOTS — the fighter's currently active buffs/debuffs, always shown (never
          gated on has_preview/aiming): decorative, capped, aria-hidden — the turn card owns the accessible,
          textual reading of this SAME fighter.effects truth (EffectBadges.jsx). */}
      {dots.length > 0 && (
        <div className="ent-tt__statuses" aria-hidden="true">
          {dots.map((dot) => (
            <span key={dot.id} className="hud-dot" style={{ background: dot.color }} />
          ))}
          {overflow > 0 && <span className="ent-tt__status-more hud-num">+{overflow}</span>}
        </div>
      )}
      {has_preview && (
        <div className="ent-tt__preview">
          {o.kills && <div className="ent-tt__kill">{t('fight.predicted_kill')}</div>}
          {fx_lines.map((fx, i) => (
            <div key={i} className="ent-tt__fx">
              {seed_effect_line(t, fx)}
            </div>
          ))}
          {push && (
            <div className="ent-tt__fx">{t(push.pull ? 'spells.fx_pull' : 'spells.fx_push', { value: push.cells })}</div>
          )}
        </div>
      )}
    </div>
  )
}
