// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Board-hover fight tooltip — the fighter under the cursor on the tactical board, shown with its name + a
// TWEENED HP (hp eases at the house pace, never snaps — useTweenedHp) and, while a spell is armed,
// the EXACT PREDICTED OUTCOME of that cast on the target: show exactly what will happen — the damage
// taken, effects, kill — e.g. life (6 −4) with the −4 in red, "kills the mob". A fight is seed-deterministic, so
// whether the cast crits is a FACT (#163): the head figure shows the resolved life-swing and, when it is a crit,
// paints that number bold + orange — there is NO separate "CRITICAL n%" line. The prediction runs through the
// client cast-prediction path (predict_cast → @aresrpg/sim, the ONE damage home) via useTargetPrediction; this
// component (via TooltipCard) only PROJECTS its canonical actions into: the head life-swing (−N red / +N green,
// orange on a crit), a KILLS line, the spell's secondary effect rows (shared seed_effect_line formatter), and a
// push/pull line. It never re-simulates and never reads authored damage RANGES (ranges were the bug).
// Reads the hovered id + cursor from `state.fight_hover` (published by the imperative roam layer on pointermove)
// and the fighter off the AUTHORITATIVE `state.fight` slice. Hidden when not hovering a fighter / not in a fight /
// the fighter is dead. Works for mobs AND players.
//
// FEEL WAVE (F4): the card FADE+SCALES in (0.15s, entity-tooltip.css) and, on leave, FADES OUT instead of
// snapping away — the last view-model is held frozen (position + content) for the exit beat so it recedes
// in place. Content updates (hovering a different fighter) mutate the live DOM node without remounting, so
// the entrance never re-fires: the numbers swap with zero flicker.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { decode, manhattan } from '@aresrpg/fight/los'

import './entity-tooltip.css'
import { useGameState, useFightView, useFightVisibleEntities } from '../../store.js'
import { spell_state_name_resolver } from '../../data/spell-text.js'
import { useSpellCorpus } from '../../data/use_spell_corpus.js'
import { useTweenedHp } from './use_tweened_hp.js'
import { useTargetPrediction } from './use_target_prediction.js'
import { EMPTY_OUTCOME, predicted_target_outcome } from './target_outcome.js'
import { TooltipCard } from './tooltip_card.jsx'

// re-export so existing importers (and the unit test) keep resolving the derivation from here too.
export { predicted_target_outcome }

/**
 * The target's predicted displacement as { cells, pull }: the manhattan distance it is shoved (chain
 * displacements are axis-aligned — fight_displacement's four directions — so this IS the shove length) and whether that is
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
  const cells = manhattan(from, to)
  if (cells <= 0) return null
  const caster = caster_cell ?? null
  return { cells, pull: caster ? manhattan(caster, to) < manhattan(caster, from) : false }
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
  const { t, i18n } = useTranslation()
  const spell_corpus = useSpellCorpus()
  const locale = i18n.resolvedLanguage || i18n.language || 'en'
  const resolve_state_name = useMemo(
    () => spell_state_name_resolver(spell_corpus, locale),
    [spell_corpus, locale]
  )
  const fight = useFightView() // synchronous core view (S2 mirror kill); hover stays a game-core slice
  const entities = useFightVisibleEntities() // the canonical entity rows — board positions answer from here
  const hover = useGameState((s) => s.fight_hover)
  // live predict_cast for the armed spell on this target — the SINGLE resolved outcome (crit or not is a
  // seed-deterministic fact, decided upstream), its is_crit flag, and the spell's secondary effect rows.
  const { prediction, is_crit, effects, target_ref } = useTargetPrediction()

  const fighter = fight && hover ? fight.fighters.get(hover.entity_id) : null
  const active = !!fighter && !fighter.dead

  // Delayed unmount so the card can FADE OUT: while a fighter is hovered we render live; when the hover
  // leaves we keep the last snapshot mounted (with the `--out` class) for EXIT_MS, then unmount for real.
  const [mounted, set_mounted] = useState(false)
  const [exiting, set_exiting] = useState(false)
  const last_vm = useRef(/** @type {any} */ (null))

  // TARGET PREVIEW: while a spell is armed, the head hp gains the EXACT resolved life-swing the cast lands
  // (−N red / +N green; a deterministic crit paints that figure bold-orange), plus a KILLS line, the spell's
  // effect rows, and a push/pull line — all from the prediction's actions (the ONE damage home) + the spell row,
  // never an authored range, never a probability. Frozen with the last snapshot through the fade-out.
  const outcome = active
    ? predicted_target_outcome(prediction, target_ref, fighter.health)
    : (last_vm.current?.outcome ?? EMPTY_OUTCOME)
  // #1993 WP5 — SCREEN COORDINATES STAY LOCAL, BOARD POSITIONS ARE CANONICAL. `hover.x/y` (viewport pixels,
  // published by the roam layer) are this component's own fact and stay where they are; the two BOARD cells this
  // preview reasons about — the target's and the caster's — come from the canonical entity rows' COMMITTED cell,
  // the same truth the prediction that produced `displaced_to` resolved against. They used to be the projection's
  // DISPLAY cells, which hold an in-flight walk at its pre-move position: mid-walk the push/pull verdict was
  // computed from where a body was standing a beat ago.
  const displacement = active
    ? displacement_of(
        entities[hover.entity_id]?.cells.committed_xy,
        outcome.displaced_to,
        entities[fight?.my_entity_id]?.cells.committed_xy
      )
    : (last_vm.current?.displacement ?? null)
  const vm = active
    ? {
        ...build_vm(hover, fighter),
        outcome,
        displacement,
        is_crit,
        effects,
        // #1993 WP6 — the canonical entity row's ACTIVE-STATUS rows, verbatim: the SAME frozen collection the
        // turn card's badges render, so the hover card and the timeline cannot disagree about what is on a
        // fighter. Distinct from `effects` above, which is the armed-spell PREVIEW, not an active status.
        status_effects: entities[hover.entity_id]?.statuses.rows ?? [],
        key: hover.entity_id,
      }
    : null
  if (vm) last_vm.current = vm

  const view = vm ?? last_vm.current
  // HP TWEEN (life updates were too fast on the hud and the nameplate) — ease the shown hp at
  // the house pace, keyed on the fighter so a fresh hover snaps to ITS hp (never counts between two entities).
  const shown_hp = useTweenedHp(view?.health ?? 0, view?.key)

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

  return (
    <TooltipCard
      team={view.team}
      style={view.style}
      exiting={exiting}
      name={view.name}
      shown_hp={shown_hp}
      outcome={view.outcome}
      is_crit={view.is_crit}
      displacement={view.displacement}
      effects={view.effects}
      status_effects={view.status_effects}
      t={t}
      locale={locale}
      resolve_state_name={resolve_state_name}
    />
  )
}
