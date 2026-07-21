// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE presentational card for the board-hover fight tooltip — the hovered fighter's name + HP head (with the
// predicted life-swing folded INSIDE the hp parens) and the preview lines (kill / effects / push). Split into its
// OWN dependency-free module (target_outcome.js's precedent) so renderToStaticMarkup unit-tests the markup WITHOUT
// dragging in the wiring shell's store/auth graph (EntityTooltip → store.js → Enoki, which needs a browser window).
// Pure props (`t` rides in). The shell (EntityTooltip) owns the store reads + on-screen positioning; this owns DOM.

import { EMPTY_OUTCOME } from './target_outcome.js'
import { seed_effect_line } from './seed-effect-line.js'

/**
 * @param {{ team: number, style: any, exiting: boolean, name: string, shown_hp: number,
 *   outcome: any, crit_chance?: number, displacement: any, effects?: any[], t: Function }} props
 */
export function TooltipCard({ team, style, exiting, name, shown_hp, outcome, crit_chance, displacement, effects, t }) {
  const o = outcome ?? EMPTY_OUTCOME
  const dmg = o.delta < 0 ? -o.delta : 0 // life reduction magnitude (red "−N")
  const heal = o.delta > 0 ? o.delta : 0 // heal magnitude (green "+N")
  const push = displacement
  const crit = o.crit // { delta, kills } | null — the crit branch, only when it differs from the base
  // the crit swing as a SIGNED string ("−9" a harder hit / "+9" a bigger heal) so a heal-crit never reads "−0".
  const crit_val = crit ? (crit.delta < 0 ? `−${-crit.delta}` : `+${crit.delta}`) : ''
  const chance = crit_chance ?? 0
  const fx_lines = effects ?? [] // secondary effects (DoT/states/buffs) — the immediate hit rides the head
  const has_preview = o.kills || crit || push || fx_lines.length > 0

  // The head line (name + tweened hp + the predicted non-crit life-swing) plus, while aiming, the
  // kill / crit / effect / displacement lines.
  return (
    <div className={`ent-tt ${team === 0 ? 'ally' : 'enemy'}${exiting ? ' ent-tt--out' : ''}`} style={style}>
      <div className="ent-tt__head">
        <span className="ent-tt__dot" aria-hidden="true" />
        <span className="ent-tt__name">{name || t('fight.fighter')}</span>
        <span className="ent-tt__hp-paren">
          ({shown_hp}
          {dmg > 0 && <span className="ent-tt__delta ent-tt__delta--dmg"> −{dmg}</span>}
          {heal > 0 && <span className="ent-tt__delta ent-tt__delta--heal"> +{heal}</span>})
        </span>
      </div>
      {has_preview && (
        <div className="ent-tt__preview">
          {o.kills && <div className="ent-tt__kill">{t('fight.predicted_kill')}</div>}
          {crit && (
            <div className="ent-tt__crit">
              {crit.kills
                ? t('fight.predicted_crit_kill', { chance })
                : t('fight.predicted_crit', { chance, value: crit_val })}
            </div>
          )}
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
