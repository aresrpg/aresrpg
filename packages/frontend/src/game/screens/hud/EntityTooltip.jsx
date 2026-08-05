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
 * The layout facts every card on this surface places itself against, read ONCE per render — the UI scale and the
 * fight layer's viewport origin. Hoisted out of `anchor_style` because #2175 renders one card per covered entity
 * and a per-card `getComputedStyle` + `getBoundingClientRect` on a per-frame surface is a layout thrash.
 * @returns {{ scale: number, off: { left: number, top: number } }}
 */
function read_layout() {
  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1
  // CONTAINER RE-BASE (the "STILL offset" fix — mount-tree law: the offset lived in the MOUNTING
  // component, not the projector): this card is `position:fixed`, but its containing block is the fight
  // layer `.gw-fight-layer`, which is `transform:scale(--ui-scale)` AND `position:absolute; inset:0` inside
  // the game-area CARD (right of the ~224px sidebar) — so a fixed child's left/top are relative to THAT box's
  // top-left, not the viewport. The old math divided by scale but omitted the box OFFSET, so the card parked
  // ~a sidebar-width to the right of the fighter. `off` is the container's viewport origin (0,0 fallback keeps
  // the full-bleed spectate layout correct, where the container fills the window).
  const layer = /** @type {HTMLElement | null} */ (document.querySelector('.gw-fight-layer'))
  return { scale, off: layer ? layer.getBoundingClientRect() : { left: 0, top: 0 } }
}

/**
 * A fighter's projected head (VIEWPORT pixels — D60: the roam layer projects the WORLD head to screen, camera +
 * zoom aware, so it pins just above the model rather than at the raw cursor) → this card's container-local
 * position, clamped fully on-screen. THE one anchor→style home: the hovered card and every #2175 zone card place
 * themselves through it, so a second card can never drift from the first by a different clamp.
 * @param {{ x: number, y: number }} anchor @param {{ scale: number, off: { left: number, top: number } }} layout
 * @returns {{ left: number, top: number }}
 */
function anchor_style(anchor, { scale, off }) {
  const w = CARD_W * scale
  const h = CARD_H * scale
  const gap = ANCHOR_GAP * scale
  // default ABOVE the fighter so the card never covers them; flip below when it would overflow the top.
  let vy = anchor.y - h - gap
  if (vy < SCREEN_MARGIN) vy = anchor.y + gap
  vy = Math.max(SCREEN_MARGIN, Math.min(vy, window.innerHeight - h - SCREEN_MARGIN))
  // horizontally centred on the fighter, then clamped fully on-screen.
  let vx = anchor.x - w / 2
  vx = Math.max(SCREEN_MARGIN, Math.min(vx, window.innerWidth - w - SCREEN_MARGIN))
  // viewport → container-local (subtract the layer's viewport origin) → un-scale into its scaled coord space.
  return { left: (vx - off.left) / scale, top: (vy - off.top) / scale }
}

/**
 * Build the tooltip view-model (screen position + display fields) for the hovered fighter. Extracted so
 * the render can freeze the LAST value during the fade-out. Pure — reads only its args + the DOM layout.
 * The name + hp head line; the caller layers the armed-spell preview + the hp tween on top.
 * @param {{ x: number, y: number }} anchor @param {any} fighter @param {number} display_health the vitals record's display HP
 * @param {{ scale: number, off: { left: number, top: number } }} layout
 * @returns {{ style: { left: number, top: number }, team: number, name: string, health: number }}
 */
function build_vm(anchor, fighter, display_health, layout) {
  const { name, team } = fighter
  // #1993 WP7 — the head HP is the canonical entity row's DISPLAY value, handed in by the caller. It used to be
  // the projection's optimistic `health`, so this card and the turn card rendered two different numbers for the
  // same fighter in one frame — and the armed-spell preview then subtracted its swing from the already-
  // decremented one, showing the hit twice.
  return { style: anchor_style(anchor, layout), team, name, health: display_health }
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
  const { prediction, is_crit, effects, target_ref, previews } = useTargetPrediction()

  const fighter = fight && hover ? fight.fighters.get(hover.entity_id) : null
  // The canonical row for the hovered fighter — vitals, liveness and board cells answer from the SAME record
  // (#1993 WP7). `display_alive` is RENDERED liveness: the card stays up through a killing beat until it lands,
  // exactly like the body it is anchored to.
  const hovered = hover ? (entities[hover.entity_id] ?? null) : null
  const display_health = hovered?.vitals?.display ?? null
  const active = !!fighter && !!hovered?.vitals?.display_alive

  // Delayed unmount so the card can FADE OUT: while a fighter is hovered we render live; when the hover
  // leaves we keep the last snapshot mounted (with the `--out` class) for EXIT_MS, then unmount for real.
  const [mounted, set_mounted] = useState(false)
  const [exiting, set_exiting] = useState(false)
  const last_vm = useRef(/** @type {any} */ (null))

  // TARGET PREVIEW: while a spell is armed, the head hp gains the EXACT resolved life-swing the cast lands
  // (−N red / +N green; a deterministic crit paints that figure bold-orange), plus a KILLS line, the spell's
  // effect rows, and a push/pull line — all from the prediction's actions (the ONE damage home) + the spell row,
  // never an authored range, never a probability. Frozen with the last snapshot through the fade-out.
  // The preview's swing is computed against the number the card SHOWS, so "−N" always reads as the transition
  // the player is looking at rather than a second, differently-anchored one.
  const outcome = active
    ? predicted_target_outcome(prediction, target_ref, display_health ?? 0)
    : (last_vm.current?.outcome ?? EMPTY_OUTCOME)
  // #1993 WP5 — SCREEN COORDINATES STAY LOCAL, BOARD POSITIONS ARE CANONICAL. `hover.x/y` (viewport pixels,
  // published by the roam layer) are this component's own fact and stay where they are; the two BOARD cells this
  // preview reasons about — the target's and the caster's — come from the canonical entity rows' COMMITTED cell,
  // the same truth the prediction that produced `displaced_to` resolved against. They used to be the projection's
  // DISPLAY cells, which hold an in-flight walk at its pre-move position: mid-walk the push/pull verdict was
  // computed from where a body was standing a beat ago.
  const displacement = active
    ? displacement_of(
        hovered?.cells.committed_xy,
        outcome.displaced_to,
        entities[fight?.my_entity_id]?.cells.committed_xy
      )
    : (last_vm.current?.displacement ?? null)
  const layout = active || (previews?.length ?? 0) > 0 ? read_layout() : null
  const vm = active
    ? {
        ...build_vm(hover, fighter, display_health ?? 0, /** @type {any} */ (layout)),
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

  // #2175 — THE ZONE'S OTHER BODIES. An AoE is aimed at a CELL, so the cast usually covers fighters nobody is
  // hovering — and the anchor itself is usually empty, which used to mean no forecast at all. Every entity the
  // prediction touches gets the SAME card the hovered one gets, pinned to its own projected head. The set comes
  // straight from `previews` (the ONE prediction's own answer to "who did I touch"); this loop re-simulates
  // nothing, resolves no zone, and reuses `predicted_target_outcome` verbatim for each body's numbers. The
  // hovered fighter is excluded — its card above already renders, with the fade-out machinery this set does not
  // need (a zone card appears and disappears with the aim, exactly like the red footprint under it).
  const zone_cards = (previews ?? []).flatMap((row) => {
    if (row.entity_id === hover?.entity_id) return []
    const entity = entities[row.entity_id]
    const anchor = hover?.anchors?.[row.entity_id]
    const body = fight?.fighters?.get(row.entity_id)
    if (!entity || !anchor || !body || !entity.vitals?.display_alive || !layout) return []
    const hp = entity.vitals?.display ?? 0
    const zone_outcome = predicted_target_outcome(prediction, row.target_ref, hp)
    return [
      {
        ...build_vm(anchor, body, hp, layout),
        key: row.entity_id,
        outcome: zone_outcome,
        displacement: displacement_of(
          entity.cells.committed_xy,
          zone_outcome.displaced_to,
          entities[fight?.my_entity_id]?.cells.committed_xy
        ),
        status_effects: entity.statuses?.rows ?? [],
      },
    ]
  })

  if (!zone_cards.length && (!mounted || !view)) return null

  return (
    <>
      {mounted && view && (
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
      )}
      {zone_cards.map((card) => (
        <TooltipCard
          key={card.key}
          team={card.team}
          style={card.style}
          exiting={false}
          name={card.name}
          shown_hp={card.health}
          outcome={card.outcome}
          is_crit={is_crit}
          displacement={card.displacement}
          effects={effects}
          status_effects={card.status_effects}
          t={t}
          locale={locale}
          resolve_state_name={resolve_state_name}
        />
      ))}
    </>
  )
}
