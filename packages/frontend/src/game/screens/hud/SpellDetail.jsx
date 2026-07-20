// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared Spell Detail panel — the per-card readout that visualizes one spell's full schema (header art /
// name / school·kind / AP pill, a facts grid, and an effects list). The in-fight armed-spell readout
// (FightArmedReadout, canon/14) renders it over the normalized sim SpellTemplate (spell-deck-data.js).
// Data only: pass a short `spell_id`; null renders the empty prompt. CSS is scoped in spell-detail.css (`.sd*`).
//
// Faithful to the lineage spell_card.vue field set: AP cost, range, area+shape, line of sight, critical
// (1/N), cooldown (turns to recast), casts per turn, casts per target, and per-effect rows with chance /
// target / duration badges. The mock detail used placeholder numbers; this renders the REAL template data
// in that layout.

import { spell_icon_url } from '@aresrpg/sdk/jobs'

import { spell_detail_view, area_label } from './spell-deck-data.js'
import { use_image_retry } from './image_retry.js'
import './spell-detail.css'

/**
 * Spell art tile with a graceful fallback: only ~24 seeded spells carry CDN art, so a missing/404 asset
 * falls back to an element-tinted initial (never a blank dark square). An `<img>` is used so the load
 * error is detectable. A transient failure (cold Walrus edge) self-heals through the shared retry
 * ladder (image_retry.js) instead of pinning the initial until a refresh; the tint pins only once the
 * ladder exhausts. Shared by the detail header + the deck-builder cards.
 * @param {{ icon: string, color: string, name: string, className?: string }} props
 */
export function SpellArt({ icon, color, name, className = '' }) {
  const resolved = spell_icon_url(icon)
  const { url, attempt, on_failed_attempt } = use_image_retry(resolved ? [resolved] : [])
  if (!url)
    return (
      <span
        className={`sd__art sd__art--fallback ${className}`}
        style={/** @type {import('react').CSSProperties} */ ({ '--el': color })}
        aria-hidden="true"
      >
        {(name || '?').slice(0, 1).toUpperCase()}
      </span>
    )
  return (
    <img
      key={`${url}#${attempt}`}
      className={`sd__art ${className}`}
      src={url}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={on_failed_attempt}
      // An HTTP-ok response with an undecodable body fires onLoad with naturalWidth 0, never onError —
      // treat a zero-dimension load as a failure too (#22b, same guard as ItemIcon / mob_image).
      onLoad={(e) => {
        if (!e.currentTarget.naturalWidth) on_failed_attempt()
      }}
    />
  )
}

/** One effect badge chip (chance / target / duration). @param {{ text: string, tone?: string }} props */
const Badge = ({ text, tone }) => <span className={`sd__badge${tone ? ` sd__badge--${tone}` : ''}`}>{text}</span>

/**
 * The shared Spell Detail panel. Resolves the spell from its short id; renders an empty prompt for a null
 * id (nothing selected). @param {{ spell_id: string | null }} props
 */
export function SpellDetail({ spell_id }) {
  const view = spell_id ? spell_detail_view(spell_id) : null
  if (!view)
    return (
      <div className="sd sd--empty">
        <span className="sd__empty-text">Tap any card</span>
      </div>
    )

  const facts = /** @type {[string, string][]} */ ([
    ['AP cost', `${view.cost}`],
    ['Range', `${view.range[0]}-${view.range[1]}`],
    ['Area', area_label(view.area, view.area_type)],
    ['Line of sight', view.line_of_sight ? 'Required' : 'Free'],
    ['Critical', view.critical_chance > 0 ? `1 / ${view.critical_chance}` : 'None'],
    ['Cooldown', view.cooldown > 0 ? `${view.cooldown} turn${view.cooldown > 1 ? 's' : ''}` : 'None'],
    ['Casts / turn', view.casts_per_turn > 0 ? `${view.casts_per_turn}` : 'No limit'],
    ['Casts / target', view.casts_per_target > 0 ? `${view.casts_per_target}` : 'No limit'],
  ])

  return (
    <div className="sd" style={/** @type {import('react').CSSProperties} */ ({ '--el': view.color })}>
      <div className="sd__head">
        <span className="sd__head-art">
          <SpellArt icon={view.icon} color={view.color} name={view.name} />
        </span>
        <div className="sd__head-id">
          <span className="sd__head-name">{view.name}</span>
          <span className="sd__head-sub">{view.school ? `${view.school} · ${view.kind}` : view.kind}</span>
        </div>
        <span className="sd__cost">
          <span className="sd__cost-n hud-num">{view.cost}</span>
          <span className="sd__cost-unit">AP</span>
        </span>
      </div>

      <div className="sd__facts">
        {facts.map(([label, value]) => (
          <div className="sd__fact" key={label}>
            <span className="sd__fact-label">{label}</span>
            <span className="sd__fact-val hud-num">{value}</span>
          </div>
        ))}
      </div>

      {view.effects.length > 0 && (
        <div className="sd__effects">
          <div className="sd__section-head">Effects</div>
          {view.effects.map((fx, i) => (
            <div className="sd__effect" key={i}>
              <span className="sd__effect-dot" style={{ background: fx.color }} aria-hidden="true" />
              <div className="sd__effect-body">
                <span className="sd__effect-text">{fx.text}</span>
                <span className="sd__effect-badges">
                  {fx.chance != null && <Badge text={`${fx.chance}% chance`} />}
                  {fx.target && <Badge text={fx.target} tone="target" />}
                  {fx.turns != null && <Badge text={`${fx.turns} turn${fx.turns > 1 ? 's' : ''}`} />}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
