// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Spell hand — the optE SPELL BAR: the equipped-WEAPON basic attack (slot 0) + at least SPELL_SLOTS spell
// sockets: the hotbar has a fixed FLOOR, it never shrinks below it — supersedes the earlier S-25 "no empty
// placeholder slots" rider this bar used to follow. LAYOUT: the weapon is a FULL-HEIGHT anchor column on the
// left, the spell slots sit beside it — keybinds flow 1-5 across the top row, 6-9 across the bottom (reading
// order; the ragged edge ends bottom-right). Pure CSS (hud.css `.hud-socketgrid` grid + `grid-row: span 2`
// on the weapon) — this component just emits weapon + N sockets in order and hands the grid its DERIVED
// column count (deck-socket-grid.js): the bar caps at three rows and WIDENS as the book grows (#1044), so a
// 20-spell character gets a wider tray instead of a four-row wall, at the same socket size. Every slot the
// character hasn't unlocked yet still renders as a hollow empty-socket frame, so the bar's width holds
// steady while `fight.hand` (the REAL on-chain spells, resolved from the seeded SpellTemplates by
// DungeonBoard) grows from 0 toward SPELL_SLOTS. A FILLED socket is a rounded CARVED tile holding a glossy element-tinted icon-gem, a
// select-key cap (top-left, first nine only) and an AP-cost pip (bottom-right); HOVERING it drives the single
// socket-anchored spell card (the weapon socket keeps its own facts tooltip). An EMPTY socket is the same
// hollow carved tile with just its dimmed keybind number —
// nothing to hover, nothing to click. The Vitals box + XP strip are mounted beside this grid by GameWorldHud
// inside `.hud-spellbar--optE`.
//
// CAST INTERACTION (S-25 — the drag-and-release system DIED): LEFT-CLICK a socket to PICK it (arm — a pure
// store toggle, no packet), then LEFT-CLICK a target cell on the board to CAST (the board's on_cell_click
// already casts an armed spell on a castable-cell click, and treats a non-castable click as a no-op while
// armed — DungeonBoard D301). Number keys mirror the clicks: 1-9 pick the matching hand card (only the first
// nine are hotkeyed), 0 picks the weapon; inert while a text input has focus. Escape disarms. The
// armed_spell_id is the shared SSOT the board reads.
//
// React 19 note: a NATIVE `disabled` button suppresses mouseenter, which would kill the hover preview on a
// greyed (off-turn / unaffordable) socket — so an unavailable socket is styled+aria-disabled and its CLICK is
// gated, never given the `disabled` attribute (the root-cause fix for the pointer/mouse-event gotcha).

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Sword } from 'lucide-react'

import { use_fight_view } from '../../store.js'
import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { character_cast_clock, use_dungeon_turn } from '../dungeon-turn.js'
import { arm_spell, hover_spell, spell_card, spell_element, WEAPON_ATTACK_ID } from '../../core/modules/fight.js'
import { fight_spell, seat_spell_row } from './fight-spells.js'
import { cooldown_display, cap_of } from '@aresrpg/fight/draft_budget'
import { crit_clock_of } from '@aresrpg/fight/predict_cast'
import { element_color } from './element-colors.js'
import { spell_category } from './spell-category.js'
import { Tooltip } from './Tooltip.jsx'
import { SpellSeedTip } from './tooltip-content.jsx'
import { resolve_key_arm, deck_my_turn, is_arm_key } from './deck-key-arm.js'
import { next_slot_crit, socket_glows, next_hit } from './deck-crit-glow.js'
import { use_fight_phase } from './world/use_fight_phase.js'
import { use_mobile_input_mode } from '../../touch/mobile_input_mode.js'
import { SpellSocket } from './deck-spell-socket.jsx'
import { SpellHoverTip } from './spell-hover-tip.jsx'
import { socket_columns, socket_slots } from './deck-socket-grid.js'

// §17.27 weapon element id → localized element name (participant.move WL_ELEMENT: 0 fire · 1 water · 2 earth · 3 air).
const WEAPON_ELEMENT_KEYS = ['fire', 'water', 'earth', 'air']
const weapon_element_name = (t, element) => t(`encyclopedia.element.${WEAPON_ELEMENT_KEYS[element] ?? 'neutral'}`)
// Bare hands = the participant.move unarmed_line signature (earth, dmg 4, ap 3, reach 1). No family slug survives
// the on-chain Weapon decode, so this signature is the honest "no weapon equipped" tell for the tooltip label.
const is_bare_hands = (w) => !!w && w.element === 2 && w.damage === 4 && w.ap_cost === 3 && w.reach === 1

// Seeded socket gems follow the selected level's actual-effect category. A legacy simulator-only card has no
// projected spell row here, so it keeps the existing normalized element tint instead of guessing.
const card_color = (spell_id, spell) =>
  spell ? spell_category(spell.levels?.[0]).color : element_color(spell_element(spell_id))

// True while a text field owns focus — the number-key selection must stay inert while the player types in
// chat / any input (typing law). Same guard the world keys use (embed_voxel / NpcPrompt).
const is_typing = () => {
  const el = document.activeElement
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || /** @type {HTMLElement} */ (el).isContentEditable)
  )
}

/**
 * Slot 0 — the equipped-WEAPON basic attack (§17.27). Its own gold icon-gem; picks (arms) the weapon on click,
 * gated on my turn AND affordability (greys once the remaining AP can't afford one swing — the BUG-A budget).
 * The tooltip surfaces the equipped line from the escrow `weapon` (element, AP, damage+crit, reach) so the
 * differentiation (daggers 3 AP vs battleaxe 5 AP; bare hands = flat 3) is visible — and the AP cost is right
 * there, so the greyed state self-explains. aria-disabled (never native `disabled`) keeps the hover tooltip alive.
 * `glow` = the §7 turn-seed crit preview (the NEXT queued strike crits) — gold socket glow + the tooltip's
 * one-line "next hit" swaps to the crit damage (glow only on the socket itself, no badges/numbers).
 * @param {{ armed: boolean, enabled: boolean, weapon: any, glow: boolean, keyCap: string | null,
 *   onPick: () => void, t: (k: string) => string }} props
 */
function WeaponSocket({ armed, enabled, weapon, glow, keyCap, onPick, t }) {
  const name = is_bare_hands(weapon) ? t('fight.weapon_bare') : t('fight.weapon_attack')
  // pass the FACTS object (element name resolved) when the escrow weapon has loaded, else `true` (name-only).
  const facts = weapon
    ? {
        ...weapon,
        element_name: weapon_element_name(t, weapon.element),
        next_hit: { value: next_hit(weapon.damage, weapon.crit_damage, glow), crit: glow },
      }
    : true
  return (
    <Tooltip placement="top" content={<SpellSeedTip t={t} name={name} weapon={facts} />} className="tt-card--solid">
      <button
        type="button"
        className={`hud-socket weapon${armed ? ' armed' : ''}${enabled ? '' : ' disabled'}${glow ? ' crit-glow' : ''}`}
        aria-disabled={!enabled}
        aria-label={name}
        onClick={onPick}
        // A socket must NEVER hold DOM focus (a mouse click was leaving a stray blue selection highlight with
        // the numkeys): the gold `.armed` ring is the ONLY selection indicator, but a mouse-clicked socket keeps
        // browser focus, and the next numkey press flips the browser into keyboard modality → it paints a blue
        // :focus-visible ring on that stale-focused socket. tabIndex -1 keeps it out of the tab order; preventing
        // mousedown's default stops the click from focusing it (the onClick still fires + arms).
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
      >
        {keyCap && (
          <span className="hud-socket__key hud-num" aria-hidden="true">
            {keyCap}
          </span>
        )}
        <span className="hud-socket__gem hud-socket__gem--weapon" aria-hidden="true">
          <Sword size={18} strokeWidth={2.4} />
        </span>
      </button>
    </Tooltip>
  )
}

/**
 * An unfilled spell slot — the FIXED bar (does not scale with the spell amounts) always renders
 * SPELL_SLOTS positions, so a slot beyond the learned spells still holds the bar's width open. Same hollow
 * carved tile as a filled socket, no gem/cost drawn, just its dimmed keybind number. Non-interactive: there
 * is nothing to arm, so no button, no tooltip, no click — a plain decorative frame.
 * @param {{ keyCap: string | null }} props
 */
function EmptySocket({ keyCap }) {
  return (
    <div className="hud-socket empty" aria-hidden="true">
      {keyCap && (
        <span className="hud-socket__key hud-num" aria-hidden="true">
          {keyCap}
        </span>
      )}
    </div>
  )
}

export function DeckCluster() {
  const { t } = useTranslation()
  const mobile = use_mobile_input_mode()
  const fight = use_fight_view() // synchronous core view (S2 mirror kill) — AP/hand/armed never lag a dispatch
  const hand = fight?.hand ?? []
  const armed = fight?.armed_spell_id ?? null
  const hovered = fight?.hovered_spell_id ?? null

  // The RECONCILED fight phase (fight-engine/phase.js) — read only for the "arm refused" debug line below (which
  // phase a no-op keypress happened in). The bar itself no longer branches on phase to decide whether to MOUNT
  // (see the tail of this function): visibility used to be the placement gate; interactivity always was and
  // still is (my_turn/enabled below), so phase has nothing left to gate here.
  const phase = use_fight_phase()
  const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
  const ap = me?.ap ?? 0 // FOLDED AP: drafted casts debit through the core (ap_cost intents) — sockets grey as AP drains
  // deck_my_turn is the SAME read DungeonBoard's my_turn uses (active seat + unresolved) and does NOT gate on the
  // raw `fight.placement`: that flag stays stale-TRUE through the placement→ACTIVE flip, so gating on it here
  // silently no-opped the turn-start arm keypress while the board was already live (FINDING B). The phase machine
  // owns placement truth; this is pure + unit-tested (deck-key-arm.test.js).
  const my_turn = deck_my_turn(fight)
  // MY escrow row (the truth lane threads it): the §17.27 equipped-weapon line — the weapon socket's tooltip AND
  // its AP-affordability gate (BUG A: greys when the remaining AP can't buy one swing) — plus the §7 turn-seed
  // seat + casts_this_turn the crit preview derives from. null before the read lands.
  const my_row = use_dungeon(
    (s) => s.dungeon?.escrow?.find((p) => (p.character ?? p.character_id) === fight?.my_entity_id) ?? null
  )
  const my_weapon = my_row?.weapon ?? null
  const weapon_affordable = my_turn && (my_weapon?.ap_cost ?? 0) <= ap

  // §7 TURN-SEED CRIT PREVIEW (the socket glow): the NEXT action slot's crit roll, derived
  // byte-identically to the chain (deck-crit-glow.js → @aresrpg/sim) from PUBLIC state: the Fight's static
  // world_seed/spawn_id, this turn's deadline, my seat — and the slot = my committed casts_this_turn + the
  // local AP-queue draft (cast_path; strikes and casts count, moves never), so the glow LIVE-ADVANCES as the
  // player queues actions. null off-turn / pre-read → no socket glows.
  const world_seed = use_dungeon((s) => s.dungeon?.world_seed ?? null)
  const spawn_id = use_dungeon((s) => s.dungeon?.spawn_id ?? null)
  const chain_deadline_ms = use_dungeon((s) => s.dungeon?.turn_deadline_ms ?? null)
  const draft_len = use_dungeon_turn((s) => s.cast_path.length)
  const crit = next_slot_crit(
    my_turn
      ? crit_clock_of({
          fight: { world_seed, spawn_id, turn_deadline_ms: chain_deadline_ms },
          seat_row: my_row,
          draft_len,
        })
      : null
  )
  const weapon_glow = !!crit && socket_glows(crit.crit_roll, my_weapon?.crit_rate ?? 0)

  // FIX 4 COOLDOWN / EXHAUSTION AFFORDANCE (07-14, display promoted to a big centered number by #368) — the
  // SAME cross-turn cooldown + this-turn casts_per_turn gate DungeonBoard already enforces for the ARMED spell
  // only (draft-budget.js cooldown_display/cap_of, mirroring cast.move:160-192 exactly), extended to EVERY
  // socket so the bar warns BEFORE arming instead of only refusing a click after. `last_cast_turn` is
  // DungeonBoard-written store state (dungeon-turn.js);
  // `my_turn_no` is the fold-derived seat-turn counter from the fight core (deadline-independent — a starved chain
  // clock no longer freezes it); `cast_path` is this turn's live drafted queue (a spell already queued N times
  // counts against its own casts_per_turn cap, exactly like DungeonBoard's `armed_queued`).
  const cast_path = use_dungeon_turn((s) => s.cast_path)
  const last_cast_turn = use_dungeon_turn((s) => character_cast_clock(s, fight?.my_entity_id).last_cast_turn)
  const my_turn_no = fight?.my_turn_no ?? 0
  /** @param {string} spell_id @returns {{ on_cd: boolean, cd_left: number, exhausted: boolean }} */
  const cast_gate = (spell_id) => {
    // the SEAT'S rank's row (#1077) — cooldown and casts_per_turn are per-level facts, exactly like the AP cost
    const level = seat_spell_row(me, fight_spell(spell_id))
    const cooldown = level?.cooldown ?? 0
    // a cooldown>0 spell aborts a SAME-turn recast on-chain (cast.move ordering) — its effective per-turn cap
    // is 1 whatever the authored casts_per_turn (the same fold DungeonBoard's cpt_cap_eff applies).
    const cpt_cap = cooldown > 0 ? 1 : cap_of(level?.casts_per_turn)
    const queued = cast_path.reduce((n, e) => (e.spell_key === spell_id ? n + 1 : n), 0)
    // #368: cooldown_display is the ONE derivation (greyed ⇔ turns_left > 0) — on_cd/cd_left are its socket-gate
    // names, never a second on_cooldown/cooldown_left recompute of the same fact.
    const { greyed: on_cd, turns_left: cd_left } = cooldown_display(last_cast_turn[spell_id], my_turn_no, cooldown)
    return { on_cd, cd_left, exhausted: queued >= cpt_cap }
  }

  // KEYBOARD SELECTION (S-25): 1-9 pick the matching hand card, 0/backtick picks the weapon (` before 1 —
  // the physically-left key; e.code Backquote catches layouts where e.key is the §
  // glyph); Escape disarms. Inert while typing (chat/input focus). arm_spell toggles, so pressing a slot's
  // key twice disarms it — the same behaviour as clicking its socket. The actual arm/gate decision is
  // `resolve_key_arm` (pure, unit-tested) so this effect stays a thin DOM/focus wrapper around it. Re-bound
  // when the gating values change so the closure always reads current values.
  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (is_typing()) return
      if (e.key === 'Escape') {
        if (armed) arm_spell(armed) // toggle the armed spell off
        return
      }
      const spell_id = resolve_key_arm(e, { my_turn, weapon_affordable, hand, ap, seat: me })
      // FIX 4: resolve_key_arm knows nothing of cooldown/casts_per_turn (deck-key-arm.js stays test-safe, no
      // store import) — the same gate the click path applies (`affordable` above) closes the keyboard bypass here.
      const cd_gate = spell_id && spell_id !== WEAPON_ATTACK_ID ? cast_gate(spell_id) : null
      if (spell_id && cd_gate && (cd_gate.on_cd || cd_gate.exhausted))
        console.info(
          `[deck] arm refused (key "${e.key}") — on cooldown or casts_per_turn exhausted (phase ${phase.phase})`
        )
      else if (spell_id) arm_spell(spell_id)
      // NO SILENT FAILURE (house telemetry, agent-standard #3): an arm-intent key that resolved to nothing NAMES
      // why. The FINDING B turn-start race (an armed keypress eaten while placement lagged) would surface here as
      // "not my active turn" instead of vanishing — one honest console line, never a swallowed no-op.
      else if (is_arm_key(e))
        console.info(
          `[deck] arm refused (key "${e.key}") — ${!my_turn ? 'not my active turn' : 'slot empty or AP-unaffordable'} (phase ${phase.phase})`
        )
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [armed, my_turn, weapon_affordable, hand, ap, me, phase.phase, cast_path, last_cast_turn, my_turn_no])

  // A bar that unmounts mid-hover (fight teardown) must not strand `hovered_spell_id`. pointerleave never
  // fires on unmount; this cleanup is the honest close.
  useEffect(() => () => hover_spell(null), [])

  // ALWAYS mount once a fight slice exists — placement no longer hides the deck (the spell
  // toolbox stays full even during the start phase, so the player can read their kit while positioning).
  // The gate moves from VISIBILITY to INTERACTIVITY, and interactivity was ALREADY correct: `my_turn`
  // (deck_my_turn) reads false for the entire placement window on both the dungeon and dead-WS paths —
  // `active_entity_id` is null until a fight actually starts (fight_bridge.js's active_entity_id() returns null
  // pre-ACTIVE; both the dungeon spawn and the WS spawn case seed it null) — so every socket's own
  // `enabled`/`affordable` check already renders `.disabled` (dimmed, click-gated, tooltip still live), and
  // next_slot_crit's own `!my_turn` guard already keeps the crit glow dark pre-turn. Nothing else to gate.
  if (!fight) return null

  return (
    <div className="hud-spellbar2__gridwrap">
      <div className="hud-spellbar2__gridcol">
        {/* #1044 — the grid's column count is DERIVED (deck-socket-grid.js) so a 20-spell book never wraps
            past three rows: the tray widens, the sockets keep their size. SpellBar writes the same value on
            `.hud-spellbar` for the bar's anchor math; this one keeps the grid honest wherever it is mounted
            (the design harness mounts DeckCluster without SpellBar). */}
        <div className="hud-socketgrid" style={{ '--sockcols': socket_columns(hand.length) }}>
          {/* slot 0 — the equipped-WEAPON basic attack (always present on my side; its crit_rate rides the
              escrow weapon line, so it previews the §7 glow like any spell socket) */}
          <WeaponSocket
            armed={armed === WEAPON_ATTACK_ID}
            enabled={weapon_affordable}
            weapon={my_weapon}
            glow={weapon_glow}
            keyCap={mobile ? null : '`'}
            onPick={() => weapon_affordable && arm_spell(WEAPON_ATTACK_ID)}
            t={t}
          />
          {/* the spell sockets: at least SPELL_SLOTS positions (more, when the character has more real
              spells than that — never hides one), each either the character's REAL on-chain spell or a
              hollow empty-socket frame. Below the floor the bar's width is constant; above it the grid
              takes extra COLUMNS, never a fourth row. */}
          {Array.from({ length: socket_slots(hand.length) }, (_, i) => {
            const key_cap = !mobile && i < 9 ? String(i + 1) : null // only desktop exposes the 1-9 hotkey caps
            const spell_id = hand[i]
            if (!spell_id) return <EmptySocket key={`empty-${i}`} keyCap={key_cap} />
            const card = spell_card(spell_id, me)
            const spell = fight_spell(spell_id)
            const color = card_color(spell_id, spell)
            const gate = cast_gate(spell_id)
            const affordable = my_turn && card.cost <= ap && !gate.on_cd && !gate.exhausted
            return (
              <SpellSocket
                key={spell_id}
                keyCap={key_cap}
                card={card}
                color={color}
                spell_id={spell_id}
                armed={armed === spell_id}
                enabled={affordable}
                glow={!!crit && socket_glows(crit.crit_roll, card.crit_rate)}
                cd_left={gate.on_cd ? gate.cd_left : 0}
                exhausted={!gate.on_cd && gate.exhausted}
                onPick={() => affordable && arm_spell(spell_id)}
                tip={
                  spell ? (
                    <SpellHoverTip
                      t={t}
                      name={card.name}
                      spell={spell}
                      cd_left={gate.on_cd ? gate.cd_left : 0}
                    />
                  ) : null
                }
                hovered={hovered === spell_id}
              />
            )
          })}
          {/* S-12: never an empty-looking deck — a class with no seeded spells still shows the weapon socket, plus
              this honest hint so the bar reads as "weapon only", not broken. */}
          {hand.length === 0 && <span className="hud-socket__hint">{t('fight.no_spells_hint')}</span>}
        </div>
      </div>
    </div>
  )
}
