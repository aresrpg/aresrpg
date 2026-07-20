// Board-hover fight tooltip — the fighter under the cursor on the tactical board, shown with its name + a
// TWEENED HP (hp eases at the house pace, never snaps — use_tweened_hp) and, while a spell is armed,
// the EXACT PREDICTED OUTCOME of that cast on the target: show exactly what will happen — damage
// taken, critical ?, effects, kill — e.g. life (6 −4) with the −4 in red, "kills the mob". The prediction runs
// through the client cast-prediction path (predict_cast → @aresrpg/sim, the ONE damage home) via
// use_target_prediction; this component only PROJECTS its canonical actions into: the head non-crit life-swing
// (−N red / +N green), a KILLS / CRIT-KILLS line, a "CRITICAL n% → −X" crit-branch line, the spell's secondary
// effect rows (shared seed_effect_line formatter), and a push/pull line. It never re-simulates and never reads
// authored damage RANGES for the head (ranges were the bug — the number is the sim's exact outcome).
// Reads the hovered id + cursor from `state.fight_hover` (published by the imperative roam layer on pointermove)
// and the fighter off the AUTHORITATIVE `state.fight` slice. Hidden when not hovering a fighter / not in a fight /
// the fighter is dead. Works for mobs AND players.
//
// FEEL WAVE (F4): the card FADE+SCALES in (0.15s, entity-tooltip.css) and, on leave, FADES OUT instead of
// snapping away — the last view-model is held frozen (position + content) for the exit beat so it recedes
// in place. Content updates (hovering a different fighter) mutate the live DOM node without remounting, so
// the entrance never re-fires: the numbers swap with zero flicker.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { decode } from '@aresrpg/fight'

import './entity-tooltip.css'
import { use_game_state, use_fight_view } from '../../store.js'
import { use_tweened_hp } from './use_tweened_hp.js'
import { use_target_prediction } from './use_target_prediction.js'
import { EMPTY_OUTCOME, predicted_target_outcome } from './target_outcome.js'
import { seed_effect_line } from './seed-effect-line.js'

// re-export so existing importers (and the unit test) keep resolving the derivation from here too.
export { predicted_target_outcome }

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/**
 * The target's predicted displacement as { cells, pull }: the chebyshev distance it is shoved and whether that is
 * a PULL (moved toward the caster) vs a push (away). Reads the prediction's Displaced.to_cell vs the fighter's
 * current cell; caster-relative direction needs no corpus. null when there is no displacement.
 * `fighter_cell`/`caster_cell` are engine_view DECODED {x,y}; only `displaced_to` is an ENCODED int (the
 * Displaced.to_cell action field), so only it is decoded here — decoding the {x,y} pair would yield NaN cells.
 * @param {{x:number,y:number}|null|undefined} fighter_cell @param {number|null} displaced_to
 * @param {{x:number,y:number}|null|undefined} caster_cell
 * @returns {{ cells: number, pull: boolean } | null}
 */
const displacement_of = (fighter_cell, displaced_to, caster_cell) => {
  if (displaced_to == null || fighter_cell == null) return null
  const from = fighter_cell
  const to = decode(displaced_to)
  const cells = cheb(from, to)
  if (cells <= 0) return null
  const caster = caster_cell ?? null
  return { cells, pull: caster ? cheb(caster, to) < cheb(caster, from) : false }
}

// gap from the fighter so the card sits beside/above them, never directly on top of the sprite
const ANCHOR_GAP = 14
// rough card footprint used only for the on-screen clamp / edge-flip so it stays fully in the viewport
const CARD_W = 220
const CARD_H = 120
const SCREEN_MARGIN = 8 // keep the whole card inside the viewport
const EXIT_MS = 160 // hold the frozen snapshot this long so the CSS fade-out (0.15s) can finish

/**
 * Build the tooltip view-model (screen position + display fields) for the hovered fighter. Extracted so
 * the render can freeze the LAST value during the fade-out. Pure — reads only its args + the DOM layout.
 * The name + hp head line; the caller layers the armed-spell preview + the hp tween on top.
 * @param {any} hover @param {any} fighter
 * @returns {{ style: { left: number, top: number }, team: number, name: string, health: number }}
 */
function build_vm(hover, fighter) {
  const { name, health, team } = fighter

  // Anchor the card AT the hovered fighter. `hover.x`/`hover.y` are VIEWPORT pixels — D60: the roam layer
  // projects the fighter's WORLD head to screen (camera + zoom aware), so they pin just above the model
  // (not the raw cursor, which drifted above-right); the block below places the card above that point.
  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1
  // CONTAINER RE-BASE (the "STILL offset" fix — mount-tree law: the offset lived in the MOUNTING
  // component, not the projector): this card is `position:fixed`, but its containing block is the fight
  // layer `.gw-fight-layer`, which is `transform:scale(--ui-scale)` AND `position:absolute; inset:0` inside
  // the game-area CARD (right of the ~224px sidebar) — so a fixed child's left/top are relative to THAT box's
  // top-left, not the viewport. The old math divided by scale but omitted the box OFFSET, so the card parked
  // ~a sidebar-width to the right of the fighter. Convert the VIEWPORT anchor into the
  // container's local space: `(viewport − containerTopLeft) / scale`. `off` is the container's viewport origin
  // (0,0 fallback keeps the full-bleed spectate layout correct, where the container fills the window).
  const layer = /** @type {HTMLElement | null} */ (document.querySelector('.gw-fight-layer'))
  const off = layer ? layer.getBoundingClientRect() : { left: 0, top: 0 }
  const w = CARD_W * scale
  const h = CARD_H * scale
  const gap = ANCHOR_GAP * scale
  // default ABOVE the fighter so the card never covers them; flip below when it would overflow the top.
  let vy = hover.y - h - gap
  if (vy < SCREEN_MARGIN) vy = hover.y + gap
  vy = Math.max(SCREEN_MARGIN, Math.min(vy, window.innerHeight - h - SCREEN_MARGIN))
  // horizontally centred on the fighter, then clamped fully on-screen.
  let vx = hover.x - w / 2
  vx = Math.max(SCREEN_MARGIN, Math.min(vx, window.innerWidth - w - SCREEN_MARGIN))
  // viewport → container-local (subtract the layer's viewport origin) → un-scale into its scaled coord space.
  const style = { left: (vx - off.left) / scale, top: (vy - off.top) / scale }

  return { style, team, name, health }
}

export function EntityTooltip() {
  const { t } = useTranslation()
  const fight = use_fight_view() // synchronous core view (S2 mirror kill); hover stays a game-core slice
  const hover = use_game_state((s) => s.fight_hover)
  // live predict_cast for the armed spell on this target — BOTH authored branches + the crit chance + the
  // spell's secondary effect rows (damage taken, critical ?, effects, kill).
  const { base, crit: predicted_crit, crit_chance: predicted_crit_chance, effects, target_ref } = use_target_prediction()

  const fighter = fight && hover ? fight.fighters.get(hover.entity_id) : null
  const active = !!fighter && !fighter.dead

  // Delayed unmount so the card can FADE OUT: while a fighter is hovered we render live; when the hover
  // leaves we keep the last snapshot mounted (with the `--out` class) for EXIT_MS, then unmount for real.
  const [mounted, set_mounted] = useState(false)
  const [exiting, set_exiting] = useState(false)
  const last_vm = useRef(/** @type {any} */ (null))

  // TARGET PREVIEW: while a spell is armed, the head hp gains the EXACT non-crit life-swing the
  // cast lands (−N red / +N green), plus a KILLS / CRIT-KILLS line, a "CRITICAL n% → −X" crit line, the spell's
  // effect rows, and a push/pull line — all from the prediction's actions (the ONE damage home) + the spell row,
  // never an authored range. Frozen with the last snapshot through the fade-out.
  const outcome = active
    ? predicted_target_outcome(base, predicted_crit, target_ref, fighter.health)
    : (last_vm.current?.outcome ?? EMPTY_OUTCOME)
  const displacement = active
    ? displacement_of(fighter.cell, outcome.displaced_to, fight?.fighters?.get(fight?.my_entity_id)?.cell)
    : (last_vm.current?.displacement ?? null)
  const vm = active
    ? { ...build_vm(hover, fighter), outcome, displacement, crit_chance: predicted_crit_chance, effects, key: hover.entity_id }
    : null
  if (vm) last_vm.current = vm

  const view = vm ?? last_vm.current
  // HP TWEEN (life updates were too fast on the hud and the nameplate) — ease the shown hp at
  // the house pace, keyed on the fighter so a fresh hover snaps to ITS hp (never counts between two entities).
  const shown_hp = use_tweened_hp(view?.health ?? 0, view?.key)

  useEffect(() => {
    if (active) {
      set_mounted(true)
      set_exiting(false)
      return
    }
    if (!mounted) return
    set_exiting(true)
    const id = setTimeout(() => {
      set_mounted(false)
      set_exiting(false)
    }, EXIT_MS)
    return () => clearTimeout(id)
  }, [active, mounted])

  if (!mounted) return null
  if (!view) return null

  const o = view.outcome ?? EMPTY_OUTCOME
  const dmg = o.delta < 0 ? -o.delta : 0 // life reduction magnitude (red "−N")
  const heal = o.delta > 0 ? o.delta : 0 // heal magnitude (green "+N")
  const push = view.displacement
  const crit = o.crit // { delta, kills } | null — the crit branch, only when it differs from the base
  // the crit swing as a SIGNED string ("−9" a harder hit / "+9" a bigger heal) so a heal-crit never reads "−0".
  const crit_val = crit ? (crit.delta < 0 ? `−${-crit.delta}` : `+${crit.delta}`) : ''
  const crit_chance = view.crit_chance ?? 0
  const fx_lines = view.effects ?? [] // secondary effects (DoT/states/buffs) — the immediate hit rides the head
  const has_preview = o.kills || crit || push || fx_lines.length > 0

  // The head line (name + tweened hp + the predicted non-crit life-swing) plus, while aiming, the
  // kill / crit / effect / displacement lines.
  return (
    <div className={`ent-tt ${view.team === 0 ? 'ally' : 'enemy'}${exiting ? ' ent-tt--out' : ''}`} style={view.style}>
      <div className="ent-tt__head">
        <span className="ent-tt__dot" aria-hidden="true" />
        <span className="ent-tt__name">{view.name || t('fight.fighter')}</span>
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
                ? t('fight.predicted_crit_kill', { chance: crit_chance })
                : t('fight.predicted_crit', { chance: crit_chance, value: crit_val })}
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
