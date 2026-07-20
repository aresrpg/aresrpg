// The ONE effect-line renderer (no cards, just lines). Renders a structured
// `seed_effect_parts` view: [stat icon | element dot] grey text with the VALUE as its own coloured span
// (`+` grey `1` green ` AP` grey — the exact Vanish-screenshot grammar), and a dim meta suffix (duration /
// crit / zone) only when informative. Shared by the grimoire (Spellbook.jsx) and the encyclopedia class page
// (classes_tab.tsx) so the two surfaces can never drift; the in-fight readout renders the same grammar via
// the flat-string `seed_effect_line` (derived from the same parts).
//
// Icons are the EXISTING statistics set (game/assets/statistics/*.png — the same files Stats.jsx renders),
// keyed by the parts' `icon` field; an element line carries a coloured dot instead (no element icon asset
// exists in the set — the colour is the element identity, matching the fight board's floating numbers).

import action_icon from '../../assets/statistics/action.png'
import movement_icon from '../../assets/statistics/movement.png'
import strength_icon from '../../assets/statistics/strength.png'
import intelligence_icon from '../../assets/statistics/intelligence.png'
import chance_icon from '../../assets/statistics/chance.png'
import agility_icon from '../../assets/statistics/agility.png'
import wisdom_icon from '../../assets/statistics/wisdom.png'
import vitality_icon from '../../assets/statistics/vitality.png'
import health_icon from '../../assets/statistics/health.png'
import range_icon from '../../assets/statistics/range.png'
import crit_icon from '../../assets/statistics/crit.png'
import raw_damage_icon from '../../assets/statistics/raw_damage.png'

import './effect-line.css'

/** parts.icon key → the imported statistics asset (single home; keys = seed-effect-line's STAT/POINT_VIEW). */
const ICONS = {
  action: action_icon,
  movement: movement_icon,
  strength: strength_icon,
  intelligence: intelligence_icon,
  chance: chance_icon,
  agility: agility_icon,
  wisdom: wisdom_icon,
  vitality: vitality_icon,
  health: health_icon,
  range: range_icon,
  crit: crit_icon,
  raw_damage: raw_damage_icon,
}

/**
 * One compact effect line. @param {{ view: import('./seed-effect-line.js').EffectLineView }} props
 */
export function EffectLine({ view }) {
  const icon = view.icon ? ICONS[view.icon] : null
  return (
    <div className="fxl">
      {icon ? (
        <img className="fxl__ic" src={icon} alt="" aria-hidden="true" draggable={false} />
      ) : view.dot ? (
        <span className="fxl__dot" style={{ background: view.dot }} aria-hidden="true" />
      ) : (
        <span className="fxl__gap" aria-hidden="true" />
      )}
      <span className="fxl__txt">
        {view.pre}
        {view.value != null && (
          <b className="fxl__val" style={{ color: view.tone }}>
            {view.value}
          </b>
        )}
        {view.post}
        {view.meta && <span className="fxl__meta"> · {view.meta}</span>}
      </span>
    </div>
  )
}
