// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SpellBar — the S-25 optE fight bar, and the ONE home of it. Extracted VERBATIM out of
// `world/GameWorldHud.jsx` (#916): it was defined inside that file and never exported, so the simulator's
// fight phase — which mounts the very same production surface (simulator/FightHud.jsx) — had movement and
// END TURN but no spell sockets. Under the #914 zero-drift law this is not a copy: both compositions import
// THIS module, so the world fight and a sim fight render the same bar or neither does.
//
// STYLES: none imported here, by design. Every `.hud-spellbar* / .hud-vbox / .hud-gem2* / .hud-xp*` rule lives
// in `hud.css` + `mobile-fight-hud.css` (+ the world layer's `game-world-hud.css` placement), and BOTH
// compositions already import that trio at their layer root — the #915 lesson holds without a fourth import
// here (the same arrangement DeckCluster.jsx, this bar's own grid half, already ships under).
//
// The bar is a pure reader: fight view + roster/expedition state in, markup out. It sends nothing and gates
// nothing — mounting is the composition's call (the world hides it while spectating; the sim has no
// spectator seat).

import { useMemo, useState } from 'react'

import { get_total_stat, STATISTICS } from '@aresrpg/sdk/stats'
import { xp_progress } from '@aresrpg/sdk/experience'

import { projected_hp, character_max_hp } from '../../../chain/read_character.js'
import { use_expedition, STATUS_ACTIVE } from '../../../roster/store'
import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { use_fight_view, use_game_state } from '../../store.js'
import { DeckCluster } from './DeckCluster.jsx'
import { get_saved_hp_display, save_hp_display } from './hp_display_pref.js'
import { use_tweened_hp } from './use_tweened_hp.js'

// ── fight Vitals — the optE gem box (S-25) ───────────────────────────────────────────────────────
// The gem stat box: a big faceted HP gem showing the HP PERCENT (the hero element, 2× the
// resource gems), plus small AP and MP gems stacked beside it. Live fighter values in
// combat (fight.fighters) win; the ACTIVE Expedition's on-chain carried_hp / max_hp (#42 backend-off) or the
// character's static totals are the fallback. Mounted by SpellBar into the `.hud-vbox` cell of the optE bar;
// the level + XP now live on the XP strip below (SpellBar), so the old HP-gem level chip is gone.

const clamp_pct = (/** @type {number} */ n) => Math.max(0, Math.min(100, n))
// A vertical fill mask cropped to `pct` from the BOTTOM with a soft ~12% feather band at the fill line.
// At full it returns 'none' so a 100% gem is never nicked at the top; at 0 the hex is fully masked out.
const feather_mask = (/** @type {number} */ pct) => {
  if (pct >= 99.5) return 'none'
  const lo = Math.max(0, pct - 6)
  const hi = Math.min(100, pct + 6)
  return `linear-gradient(to top, #000 0%, #000 ${lo}%, transparent ${hi}%)`
}

/** @returns {import('react').ReactElement} */
function Vitals() {
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)
  const character = use_game_state((s) =>
    s.sui.characters.find((c) => c.id === (fight?.my_entity_id ?? s.selected_character_id))
  )
  const me = fight && fight.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
  // #42 backend-off: there is no engine fight during exploration — the player's real HP is the ACTIVE
  // Expedition's on-chain carried_hp / max_hp (chain-direct store), so this canonical bar agrees with
  // ExpeditionHud. A live board fight (`me`, e.g. the leave-replay) still wins.
  const expedition = use_expedition((s) => s.expedition)
  const run = !me && expedition?.status === STATUS_ACTIVE ? expedition : null

  const health =
    me?.health ?? run?.carried_hp ?? (character?._type ? projected_hp(character, Date.now()) : (character?.health ?? 0))
  const max_health = me ? me.health_max : run ? run.max_hp : character?._type ? character_max_hp(character) : 0
  const hp_pct = max_health > 0 ? Math.round(Math.max(0, Math.min(100, (health / max_health) * 100))) : 0
  // HP TWEEN (life updates were too fast on the hud and the nameplate) — the SAME animation home
  // the board nameplate uses: ease the DISPLAYED number at the house pace (the gem fill already CSS-transitions).
  // Keyed on the subject so switching character/fight snaps. Aria-label keeps the TRUE hp (accessibility = truth).
  const shown_hp = use_tweened_hp(health, fight?.my_entity_id ?? character?.id ?? 'self')
  const shown_pct = max_health > 0 ? Math.round(Math.max(0, Math.min(100, (shown_hp / max_health) * 100))) : 0
  const ap = me ? me.ap : character ? get_total_stat(character, STATISTICS.ACTION) : 0
  const mp = me ? me.mp : character ? get_total_stat(character, STATISTICS.MOVEMENT) : 0
  // The resource GEMS DRAIN to their fill level (HP the hero; AP/MP the per-turn budget so a
  // queued strike visibly spends AP). The bright faceted hex is vertically cropped to its
  // percent via a FEATHERED mask (~12% soft band at the fill line), with a dimmed/desaturated ghost hex behind
  // for the spent portion. Crop is INLINE-only — the gem's shape/gradient stay in hud.css (reused, not forked).
  const ap_pct = me ? (me.ap_max > 0 ? Math.round(clamp_pct((ap / me.ap_max) * 100)) : 0) : 100
  const mp_pct = me ? (me.mp_max > 0 ? Math.round(clamp_pct((mp / me.mp_max) * 100)) : 0) : 100
  const reduce_motion = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false,
    []
  )
  const fill_style = (pct) => {
    const mask = feather_mask(pct)
    return {
      WebkitMaskImage: mask,
      maskImage: mask,
      // mask-image gradients don't reliably transition, so animate the whole layer's opacity/position implicitly;
      // the crop updates correctly per HP change regardless. reduced-motion (or full) = no transition (instant).
      transition: reduce_motion ? 'none' : 'mask-image 200ms var(--ease, ease)',
    }
  }
  const ghost_style = { filter: 'saturate(0.3) brightness(0.4)' } // the spent (empty) portion, showing through

  // Clicking the HP gem toggles its readout between the PERCENT and the raw current/max
  // FRACTION (the pre-gem bar used to show "85 / 120" outright) — local UI state, no store, no packet.
  // PERSISTED — whether HP shows as percent or as a stacked fraction: hydrated from the hp_display_pref
  // localStorage home on mount, written back on every toggle
  // — same idiom as the render-quality pref (world/quality_pref.js).
  const [show_fraction, set_show_fraction] = useState(() => get_saved_hp_display() === 'fraction')
  const toggle_hp_display = () => {
    const next = !show_fraction
    save_hp_display(next ? 'fraction' : 'percent') // outside the setState updater — updaters stay pure (StrictMode double-invokes them)
    set_show_fraction(next)
  }

  return (
    <div className="hud-vbox">
      <div className="hud-vbox__hp">
        {/* the hero HP gem — a recessed bezel holding a faceted hex, reading HP as a percent or (click) a
            current/max fraction. A real <button> (not a decorative div) — it's a genuine toggle control. */}
        <button
          type="button"
          className="hud-gem-bezel"
          aria-pressed={show_fraction}
          aria-label={`HP ${show_fraction ? `${health} / ${max_health}` : `${hp_pct}%`} — click to toggle`}
          onClick={toggle_hp_display}
        >
          <div className="hud-gem2 hud-gem2--hp">
            <div className="hud-gem2__rim" />
            {/* the drained fill: a dimmed GHOST hex (spent portion) + the bright faceted hex cropped
                to hp_pct with a feathered edge. Both reuse the hud.css __facets shape/gradient (inline crop only). */}
            <div className="hud-gem2__facets" style={ghost_style} />
            <div className="hud-gem2__facets" style={fill_style(hp_pct)} />
            <div className="hud-gem2__spec" />
            {show_fraction ? (
              <span className="hud-gem2__frac">
                <span className="hud-gem2__frac-n">{shown_hp}</span>
                <span className="hud-gem2__frac-bar" />
                <span className="hud-gem2__frac-n">{max_health}</span>
              </span>
            ) : (
              <span>{shown_pct}%</span>
            )}
          </div>
        </button>
      </div>
      <div className="hud-vbox__side">
        <div className="hud-gem2 hud-gem2--ap hud-gem2--stat" aria-hidden="true">
          <div className="hud-gem2__rim" />
          <div className="hud-gem2__fill" style={ghost_style} />
          <div className="hud-gem2__fill" style={fill_style(ap_pct)} />
          <span>{ap}</span>
        </div>
        <div className="hud-gem2 hud-gem2--mp hud-gem2--stat" aria-hidden="true">
          <div className="hud-gem2__rim" />
          <div className="hud-gem2__fill" style={ghost_style} />
          <div className="hud-gem2__fill" style={fill_style(mp_pct)} />
          <span>{mp}</span>
        </div>
      </div>
    </div>
  )
}

// ── SpellBar — the optE bar skeleton (S-25 flip) ─────────────────────────────────────────────────
// The optE composition, now the DEFAULT rendered fight bar: the gem Vitals box + the fixed
// socket grid (DeckCluster) share the `.hud-spellbar2__top` row; the XP strip spans the full bar width below
// them, with the character LEVEL as a small number at its right end (the old HP-gem level chip
// is gone). XP progress binds to the real character curve (xp_progress); a live expedition's char_level wins
// for the displayed level, matching the pre-flip Vitals precedence.

/** @returns {import('react').ReactElement} */
export function SpellBar() {
  const fight_character_id = use_fight_view()?.my_entity_id ?? null // core view (S2 mirror kill)
  const character = use_game_state((s) =>
    s.sui.characters.find((c) => c.id === (fight_character_id ?? s.selected_character_id))
  )
  const session_character_id = use_dungeon((s) => s.character_id)
  const run = use_expedition((s) => (s.expedition?.status === STATUS_ACTIVE ? s.expedition : null))
  const { level: xp_level, pct: xp_pct } = xp_progress(character?.experience ?? 0)
  // The legacy Expedition level belongs to its one session character. During a same-wallet fight turn, every
  // other owned actor uses that character's own roster XP; never carry the selected leader's level into B's HUD.
  const level = run && (!fight_character_id || fight_character_id === session_character_id) ? run.char_level : xp_level
  return (
    <div className="hud-spellbar hud-spellbar--optE">
      <div className="hud-spellbar2__top">
        <Vitals />
        <DeckCluster />
      </div>
      <div className="hud-xprow" aria-hidden="true">
        <div className="hud-xpstrip2">
          <span style={{ width: `${xp_pct}%` }} />
        </div>
        <span className="hud-xplvl hud-num">{level}</span>
      </div>
    </div>
  )
}
