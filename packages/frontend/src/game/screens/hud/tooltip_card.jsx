// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE presentational card for the board-hover fight tooltip — the hovered fighter's name + HP head (with the
// predicted life-swing folded INSIDE the hp parens) and the preview lines (kill / effects / push). Split into its
// OWN dependency-free module (target_outcome.js's precedent) so renderToStaticMarkup unit-tests the markup WITHOUT
// dragging in the wiring shell's store/auth graph (EntityTooltip → store.js → Enoki, which needs a browser window).
// Pure props (`t` rides in). The shell (EntityTooltip) owns the store reads + on-screen positioning; this owns DOM.

import { EMPTY_OUTCOME } from './target_outcome.js'
import { ActiveEffectRows } from './EffectBadges.jsx'
import { seed_effect_line } from './seed-effect-line.js'

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
  locale = 'en',
  resolve_state_name,
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
      {/* ACTIVE EFFECTS — fighter.effects comes only from engine_view's presented fighter projection. The board
          hover and turn card share this exact localized row renderer; the armed-spell preview below remains a
          separate "what would happen" projection. */}
      <ActiveEffectRows
        effects={status_effects}
        t={t}
        locale={locale}
        resolve_state_name={resolve_state_name}
      />
      {has_preview && (
        <div className="ent-tt__preview">
          {o.kills && <div className="ent-tt__kill">{t('fight.predicted_kill')}</div>}
          {fx_lines.map((fx, i) => (
            <div key={i} className="ent-tt__fx">
              {seed_effect_line(t, fx, { locale, resolve_state_name })}
            </div>
          ))}
          {push && (
            <div className="ent-tt__fx">
              {t(push.pull ? 'spells.fx_pull' : 'spells.fx_push', { value: push.cells })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
