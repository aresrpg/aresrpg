// board #13 — the on-chain dungeon's turn-INPUT bridge + status chrome. The BOARD ITSELF is the rich 3D
// renderer (fight-overlay.js + fight-board-render.js), mounted into the roam scene at DUNGEON_BOARD_ORIGIN.
// What lives HERE is the real on-chain wiring: the turn-draft (a cumulative move PATH + ≤1 cast, mirroring
// dungeon_turn.move's apply_move/apply_cast gates), the SINGLE commit_turn PTB (no separate on-chain end-turn — commit_turn applies
// the batch AND advances the turn), and the terminal/room state machine.
//
// UX (play-test priority #1: make it FEEL like a real game, chain invisible):
//  - INPUT: click an empty reachable cell = draft a MOVE; click / drag-a-spell-card onto a living mob in range
//    = draft a CAST. The pick is made by clicking the rich 3D board (roam raycast → fight-overlay click_cell /
//    a DeckCluster spell drop → drop_cell), relayed here via dungeon-turn.js. `on_cell_click` is the SAME
//    decision logic a flat grid used to call; only the input SOURCE changed. Picks are written back to that
//    store so fight-overlay highlights them on the 3D board (gold tile/ring) — one source of truth.
//  - CONTROLS: END TURN + FORFEIT are the reused sui-branch FightControls chrome, bottom-right. END TURN
//    commits the current draft (move+cast, possibly empty) via commit_turn; FORFEIT (S-80, actions::abandon)
//    dies in THIS fight — normal settlement still runs (loot still rolls). A SEPARATE "Leave dungeon" control
//    (only when a RunPass is live) consumes the RunPass directly (dungeon::abandon) instead — no death write, no
//    loot; it is the pre-S-80 door, kept honest and distinct alongside the new one (see on_leave_dungeon below).
//  - FIGHT-END IS SILENT + AUTOMATIC (never a "claim rewards" step). Clearing a room auto-fires
//    the per-room reward claim SILENTLY (zkLogin signs, no toast/modal); advancing auto-claims first (forfeit
//    impossible); WON/FAILED auto-fire the terminal claim → the Victory/Defeat summary card IS the receipt.
//  - The spell hand (DeckCluster) reads fight.hand; a dungeon has no on-chain spellbook, so we seed the hand
//    from the escrowed character's CLASS spells here (cosmetic — every cast commits the same generic cast).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { xp_progress } from '@aresrpg/sdk/experience'

import { use_game_state, use_fight_view } from '../../../store.js'
import { use_expedition, STATUS_ACTIVE as EXPEDITION_ACTIVE } from '../../../../roster/store'
import { fight_spell_template, resolve_class_spells } from '../fight-spells.js'
import { push_event_toast } from '../../../core/toast.js'
import { WEAPON_ATTACK_ID, WEAPON_ATTACK_RANGE, WEAPON_ATTACK_AP } from '../../../core/modules/fight.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import {
  damage_of,
  subscribe_commit_due,
  subscribe_divergence,
  subscribe_turn_lost,
  staged_turn_paths,
  fight_store,
  fight_view,
} from '@aresrpg/fight'
import { committed_mob_hp, strike_flush_illegal, announce_auto_commit, announce_turn_lost } from '@aresrpg/fight'
import { retarget_cast } from '@aresrpg/fight'
import { synthetic_tackled_events, local_intent_beats, local_move_beats } from '@aresrpg/fight'
import { predict_cast, weapon_spell_template, evolve_flush_casts, committed_state } from '@aresrpg/fight'
import { next_move_tackle } from '@aresrpg/fight'
import { cast_range_set_dungeon } from '../../../../fight-engine/overlay_intents.js' // D139: cast_range_set_dungeon = THE cast-legality home (P1 self-cast)
import { character_cast_clock, use_dungeon_turn } from '../../dungeon-turn.js'
import { GRID_W, GRID_CELLS, encode, decode, lineOfSight, bfsPathCost, bfsPath, bfsReachable } from '@aresrpg/fight'
import { dungeon_grid_of } from '../../dungeon-grid.js'
import { presentation_blocked_cells } from '../../../../world-shell/fight_board_blockers.js'
import { spell_mp_grant, movement_grant, on_cooldown, cooldown_left, casts_at_cell, cap_of } from '@aresrpg/fight'
import { FightControls } from '../FightControls.jsx'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { use_fight_phase } from './use_fight_phase.js'
import { is_active as phase_is_active, is_placement as phase_is_placement } from '../../../../fight-engine/phase.js'
import './dungeon-board.css'
import { game_log } from '../../../../core/log.js'
import { fight_state_trace } from '../../../../world-shell/fight_state_trace.js'
import { humanize_abort } from '../../../core/abort_copy.js'

// FALLBACK cast economics (senshi fire_strike L1) — used only when the class/seed can't be resolved. The LIVE
// values are read per-class from the seeded primary spell (D98 cast_params memo below): range/AP differ by class
// (senshi [1,4]/4, yajin backstab [1,3]/4, …), so a hardcoded constant mis-gated every non-senshi.
const CAST_AP_COST_DEFAULT = 4
const CAST_RANGE_MIN_DEFAULT = 1
const CAST_RANGE_MAX_DEFAULT = 4

// fire_strike L1 non-crit damage — mirrors dungeon_cast.move EXACTLY. Every dungeon cast resolves to fire_strike
// L1 (base 15, element FIRE; the resolver falls back to it for every class), and its ONLY non-deterministic
// input is the 1-in-50 crit boolean — so the client computes the identical base number and only a crit
// reconciles at commit. Formula = spell_formula::final_damage: amplify (base × (100+INT+percent)/100 + raw, no
// physical on fire) then target fire-resist reduction. percent_damage isn't surfaced by read_dungeon yet → 0
// (the on-chain default; a gear/buff that sets it would reconcile at commit — FLAGGED).
const FIRE_STRIKE_BASE = 15
// (predict_fire_strike DELETED — D100: previews now read the armed card's SEEDED base; W2's legality module brings the contract-mirrored formula.)

// Dungeon.status machine (dungeon.move). ROOM_CLEARED is handled in dungeon_store (board unmounts → plane).
const STATUS_ACTIVE = 1 // live fire-time guard for the reducer-derived commit edge
// (STATUS_PLACEMENT removed — the placement chrome gate is now the phase machine's is_placement, not a raw read)

const manhattan = (a, b) => {
  const ax = a % GRID_W
  const ay = (a / GRID_W) | 0
  const bx = b % GRID_W
  const by = (b / GRID_W) | 0
  return Math.abs(ax - bx) + Math.abs(ay - by)
}

// D254 (1.29 cumulative move): the TOTAL MP a drafted move PATH costs = the sum of each segment's bfs_path_cost
// computed from the RUNNING cell with the RUNNING MP — the EXACT sequence commit_turn_core's apply_move loop
// charges (each {kind:0} step spends bfs_path_cost(current → step), then advances the cell). `blocked` is the
// move-blocked set (obstacles ∪ holes ∪ OOB ∪ other living bodies), constant across a turn since only I move on
// my turn. Every drafted step is within the re-anchored reach, so no segment ever overruns the remaining MP.
const draft_move_cost = (path, start, blocked, mp) => {
  let cell = start
  let remaining = mp
  let cost = 0
  for (const step of path) {
    const c = bfsPathCost(cell, step, blocked, remaining)
    cost += c
    remaining = Math.max(0, remaining - c)
    cell = step
  }
  return cost
}

/** @returns {import('react').ReactElement | null} */
export function DungeonBoard() {
  const { t } = useTranslation()
  // W4: this board mounts ONLY when the phase machine says so (GameWorldHud gates on should_mount_board), and
  // the DungeonLeaveButton fallback now reads the SAME machine for the single-exit law — so the old
  // `hud_mounted` store-write handshake is gone (no component writes fight state). The chrome below branches
  // on the machine's is_placement / is_active, never a raw status re-read that could disagree with the mount.
  const phase = use_fight_phase()
  const dungeon = use_dungeon((s) => s.dungeon)
  const busy = use_dungeon((s) => s.busy)
  const commit_turn = use_dungeon((s) => s.commit_turn)
  const claim = use_dungeon((s) => s.claim)
  const mint_loot = use_dungeon((s) => s.mint_loot)
  const abandon = use_dungeon((s) => s.abandon) // RUN door (dungeon::abandon) — consumes the RunPass directly, no death, no loot
  // S-80: FightControls now owns a UNIVERSAL fight-forfeit door (actions::abandon, its own default + confirm)
  // shown on every fight type — no more world-fight hiding here. A LIVE RunPass additionally gets this SEPARATE
  // "leave dungeon" control below (run_pass_id set = a real dungeon run, not a bare world fight) so both stay honest.
  const run_pass_id = use_dungeon((s) => s.run_pass_id)
  const character_id = use_dungeon((s) => s.character_id)
  const fight = use_fight_view() // synchronous core view (S2 mirror kill) — the board never gates on a lagging copy
  const characters = use_game_state((s) => s.sui.characters)
  const controlled_character_id = fight?.my_entity_id ?? character_id

  // LEAVE-DUNGEON confirm modal (replaces the native window.confirm — standing house law: no OS dialogs). The
  // FIGHT-forfeit door's OWN confirm now lives inside FightControls itself (S-80) — this one is only the RUN door.
  const [leave_confirm, set_leave_confirm] = useState(false)
  // The single tx edge keeps the latest flush closure without re-subscribing on every render.
  const auto_submit_ref = useRef(null)
  // TRAP PAINT AT CAST: cells whose trap marker was painted OPTIMISTICALLY at the
  // draft click and is not yet chain-committed. Flush moves survivors to chain truth (they leave this set,
  // marker stays) and rolls back drops/failures; a turn boundary rolls back whatever never committed.
  const pending_trap_cells = useRef(/** @type {Set<number>} */ (new Set()))
  // FIX 4 (cooldown gate) — the CLIENT mirror of cast.move's per-seat turn clock + per-spell last-cast record.
  // `my_turn_no` is the FOLD-derived seat-turn counter (fight core): bumped once per MY PLAYABLE turn-start,
  // DEADLINE-INDEPENDENT, so lag/starvation can no longer freeze it (register #34 — it used to live here as a
  // deadline-gated effect that stalled while last_cast_turn advanced, pinning every cd>0 spell on-cooldown
  // forever). `last_cast_turn` (spell name_key → the turn it cast) still lives in the shared dungeon-turn store so
  // DeckCluster's bar renders the same live cooldown on every socket — this component stays its sole WRITER
  // (stamped at commit = my_turn_no); the reset effect below (keyed on fight_id) clears it on a fresh Fight.
  const my_turn_no = fight?.my_turn_no ?? 0
  const last_cast_turn = use_dungeon_turn((s) => character_cast_clock(s, controlled_character_id).last_cast_turn)
  const record_cast_turns = use_dungeon_turn((s) => s.record_character_cast_turns)
  const reset_cast_clock = use_dungeon_turn((s) => s.reset_character_cast_clocks)

  // Turn-draft (a cumulative move PATH + a STACKED cast/weapon QUEUE, §17.27), shared with the 3D click router.
  const move_path = use_dungeon_turn((s) => s.move_path)
  const cast_path = use_dungeon_turn((s) => s.cast_path)
  const cast_first = use_dungeon_turn((s) => s.cast_first) // D99: casts commit before moves → their kills vacate cells NOW
  const cast_target = use_dungeon_turn((s) => s.cast_target)
  const append_move_step = use_dungeon_turn((s) => s.append_move_step)
  const append_cast_step = use_dungeon_turn((s) => s.append_cast_step)
  const clear_picks = use_dungeon_turn((s) => s.clear_picks)
  const clicked_cell = use_dungeon_turn((s) => s.clicked_cell)
  const clicked_cast = use_dungeon_turn((s) => s.clicked_cast)
  const clicked_seq = use_dungeon_turn((s) => s.clicked_seq)
  // D66 placement predict-first: the LOCAL start-cell pick (set by fight-overlay's click_cell) that READY commits.
  const placement_pick = use_dungeon_turn((s) => s.placement_pick)
  const set_placement_pick = use_dungeon_turn((s) => s.set_placement_pick)
  const place_at_cell = use_dungeon((s) => s.place_at_cell)

  // My escrowed character's on-chain class — drives the seeded primary spell (its range/AP), the deck hand, and
  // the optimistic-cast damage. Resolved once here (single source) so the cast gates below read the SAME seed.
  const my_character = useMemo(
    () => characters.find((ch) => ch.id === controlled_character_id) ?? null,
    [characters, controlled_character_id]
  )
  const my_class =
    my_character?.classe ?? my_character?.class_id ?? fight?.fighters.get(controlled_character_id)?.class_id ?? null
  // The character's LEVEL gates which class spells are UNLOCKED in the bar (the chain re-checks each spell's
  // min_char_level at cast). A live expedition's char_level wins (matches SpellBar's precedence), else the xp
  // curve — belt-and-suspenders for a non-expedition read.
  const expedition_level = use_expedition((s) =>
    s.expedition?.status === EXPEDITION_ACTIVE ? s.expedition.char_level : null
  )
  const my_level =
    controlled_character_id === character_id && expedition_level != null
      ? expedition_level
      : xp_progress(my_character?.experience ?? 0).level
  // The REAL on-chain spells this character can cast (unlock_level ≤ level), each carrying its SpellTemplate
  // object_id — the single source the bar renders and the cast stages. A class with no seed → [] (weapon+move).
  const my_spells = useMemo(() => resolve_class_spells(my_class, my_level), [my_class, my_level])

  // D98 (a "no valid target" bug — targeting felt wrong) — the cast RANGE + AP are PER-CLASS, from the seeded
  // primary spell, NOT a hardcoded [1,4]/4. The old constants matched only senshi's fire_strike ([1,4], 4 AP); a
  // yajin's backstab is [1,3] — so `castable` used to light (and let the player pick) a distance-4 mob the chain's
  // spell_target::can_cast_at then REJECTED (EIllegalCast 114), which read as "I couldn't do anything" and aborted
  // the whole commit. Reading the seed makes the client range/LOS gate agree with the contract cell-for-cell.
  // Falls back to the senshi defaults when the class/seed is missing (never a broken 0-range gate).
  // 3-CARD HAND (17b unlock): the deployed registry carries every class's full starter TRIO ("12 MVP spells
  // seeded (leg #0)" — deployment.ts), so the one-card law below was STALE. The ACTIVE spell = the ARMED card's
  // seed row when a card is armed, else the class primary (the convenient unarmed mob-click default, unchanged).
  // Range/AP/damage/commit-id ALL derive from active_spell so the client gate agrees with the contract for
  // whichever spell is actually cast (the D98 lesson, extended to the trio).
  const armed_row = useMemo(
    () => (fight?.armed_spell_id ? (my_spells.find((sp) => sp.name_key === fight.armed_spell_id) ?? null) : null),
    [fight?.armed_spell_id, my_spells]
  )
  const active_spell = useMemo(() => armed_row ?? my_spells[0] ?? null, [armed_row, my_spells])

  // My escrow seat + turn ownership — resolved BEFORE the cast/weapon params so the weapon strike prices its
  // reach/AP off the SAME on-chain Weapon the seat carries (participant.move). The fight-slice key is the
  // controlled character id; owner address remains authorization metadata.
  const entity_id = fight?.my_entity_id ?? null
  const me = dungeon?.escrow.find((p) => (p.character ?? p.character_id) === entity_id) ?? null
  // PRESENTATION GATE (regression: a player could act while mobs were still animating their turns): the
  // mob-wave crank hands active_entity_id back to me the instant the paced replay STARTS, so a chain-only
  // my_turn read would re-arm End Turn + the hotbar mid-cascade. `fight.presenting` (set by voxel_fight_adapter
  // while the mob beats drain) holds the RE-ARM until the turn is PLAYABLE — chain truth ⋀ presentation done.
  const my_turn = !!fight && fight.active_entity_id === entity_id && fight.winner === -1 && !fight.presenting

  const cast_params = useMemo(() => {
    // WEAPON slot (SPEC §17.27): the HAND / equipped-WEAPON basic attack has no seed row — its range/AP come from
    // the seat's on-chain Weapon (me.weapon.reach / ap_cost), so the `castable` gate + the board wash agree
    // cell-for-cell with actions::act_weapon → cast::weapon_strike (which gates `1 ≤ d ≤ reach`, `ap ≥ ap_cost`).
    // The WEAPON_ATTACK_* constants are only the pre-escrow-read fallback.
    if (fight?.armed_spell_id === WEAPON_ATTACK_ID)
      return {
        range_min: 1,
        range_max: me?.weapon?.reach ?? WEAPON_ATTACK_RANGE[1],
        ap_cost: me?.weapon?.ap_cost ?? WEAPON_ATTACK_AP,
      }
    const lvl = active_spell?.levels?.[0]
    const range = lvl?.range
    return {
      range_min: range?.[0] ?? CAST_RANGE_MIN_DEFAULT,
      range_max: range?.[1] ?? CAST_RANGE_MAX_DEFAULT,
      ap_cost: lvl?.ap ?? CAST_AP_COST_DEFAULT,
    }
  }, [active_spell, fight?.armed_spell_id, me?.weapon])
  // Every hook ABOVE this line runs unconditionally (Rules of Hooks) — the early return is below the last one.
  const obstacles = dungeon?.obstacles ?? []
  // The ENGINE refills AP/MP to base at begin_turn ON-CHAIN (turns.move) and persists it, so the escrow ap/mp
  // read every poll IS the live turn budget the instant it's my turn — no stale pre-refill leftover, no hardcoded
  // 6/3 mirror that mis-gated a char whose base_ap/base_mp differ (an over-budget draft the chain then rejected
  // with abort 104). A local draft doesn't spend on-chain until End Turn, so the whole turn draws against this
  // pool; `reachable`/`castable` subtract the drafted move/cast costs from it.
  // THE POOL IS THE COMMITTED ANCHOR (gate9 P1 — one cast per turn): `me.ap/mp` are the PRESENTED values, and
  // every drafted click also folds its ap_cost/mp_left intent (AP-paint truth), so budgeting against them counts
  // the draft TWICE (12 − 5 folded, − 5 ledger = 2 → the 2nd Ghost Talon the chain accepts was refused). The
  // draft ledger (cast_path/move_path) subtracts from `me.committed` — the chain pool with my intents excluded
  // (project.board_view) — and the presented values stay what they are: the display truth.
  const my_ap = me?.committed?.ap ?? 0
  const my_mp = me?.committed?.mp ?? 0

  // FIX 1 (Vanish MP — regression: move range didn't grow after Vanish): a drafted cast's give_points(MP) grant
  // (seed kind:6/stat:1, e.g. Vanish +1 MP) folds into the optimistic movement pool so the reach grows mid-draft —
  // but ONLY when the cast commits BEFORE the moves (cast_first: the chain's [casts, moves] batch grants the MP,
  // then apply_move spends against the raised pool). A move-FIRST draft ([moves, casts]) charges movement at the
  // base pool, so the grant can't help it this turn — mirrors optimistic_vacated's cast_first gate exactly.
  // give_points is UNCAPPED on-chain (participant.move), so +MP over base is real movement MP now, not clamped.
  // COMPLEMENTARY to the fold's Granted arm (predict_cast.changed_actions → inputs.apply_action 'Granted', ⑤a/⑤b):
  // that arm carries the grant into the PRESENTED pool (engine_view.mp = HUD number, move_wash reach = the blob) so
  // it renders the instant Vanish is cast, no move drafted. THIS shim is the DRAFTED-MOVE half — the click-gate
  // budgets against `me.committed` (intents-EXCLUDED, gate9 anti-double-count), which the optimistic grant is
  // excluded from, and it carries the CAST_FIRST commit-order gate the order-agnostic pool can't express (dropping
  // it would let a move-first draft reach on a grant the chain won't honor → an aborted PTB burns gas). Both live.
  const mp_grant_of = (/** @type {string | null} */ spell_key) => {
    if (spell_key === WEAPON_ATTACK_ID) return 0
    return spell_mp_grant(my_spells.find((sp) => sp.name_key === spell_key)?.levels?.[0])
  }
  // ONE rule (draft_budget.movement_grant, cited by the core's move_wash too): the drafted cast grant funds
  // movement iff cast_first, so the click gate and the green wash never disagree about post-Vanish reach.
  const my_mp_eff = my_mp + movement_grant(cast_first, cast_path.reduce((sum, e) => sum + mp_grant_of(e.spell_key), 0))

  // ── CLIENT AP BUDGET (SPEC §17.27; regression: unlimited weapon-strike spam) — the chain lets a
  //    turn repeat weapon strikes / spells ONLY while AP lasts (each costs its own ap_cost; spells add a
  //    casts_per_turn cap, but every seeded spell today is 255 = UNLIMITED, so AP is the sole live limiter). The
  //    client mirrors it: each QUEUED cast/weapon decrements a client-side remaining-AP seeded from the escrow
  //    me.ap, and `castable` goes EMPTY (greyed sockets) once the budget can't afford another — so the optimistic
  //    beat can NEVER play for an unaffordable action, and the excess phantom beats that read as "mobs regaining
  //    health" (uncommitted casts folding back) are gone: every beat is now 1:1 with a committable action. ──
  const CASTS_UNLIMITED = 255 // spell_bands::CASTS_UNLIMITED — a 255/0 cap means no per-turn limit
  // The AP a single queued action costs, by its pinned spell_key: the weapon → the seat's on-chain Weapon.ap_cost;
  // a spell → its seeded level-1 ap. Mirrors the chain's per-action charge (act_weapon / act_cast) exactly.
  const cost_of = (/** @type {string | null} */ spell_key) => {
    if (spell_key === WEAPON_ATTACK_ID) return me?.weapon?.ap_cost ?? WEAPON_ATTACK_AP
    return my_spells.find((sp) => sp.name_key === spell_key)?.levels?.[0]?.ap ?? cast_params.ap_cost
  }
  // The deterministic optimistic damage a single queued action deals (crit reconciles at commit): weapon → the
  // seat's fixed Weapon.damage; spell → its seeded level-1 DAMAGE base. Fed the CUMULATIVE per-target HP drop.
  const dmg_of = (/** @type {string | null} */ spell_key) => {
    if (spell_key === WEAPON_ATTACK_ID) return me?.weapon?.damage ?? 0
    const lvl = my_spells.find((sp) => sp.name_key === spell_key)?.levels?.[0]
    return damage_of(lvl?.effects)
  }
  const drafted_ap = cast_path.reduce((sum, e) => sum + cost_of(e.spell_key), 0)
  const remaining_ap = Math.max(0, my_ap - drafted_ap) // the AP left after the already-queued strikes/casts
  // casts_per_turn gate for the ARMED spell (the weapon has none). Count how many of it are already queued; at the
  // cap no more are castable. cpt_cap === Infinity for a weapon or any unlimited (255/0) spell — AP alone limits.
  const armed_id = fight?.armed_spell_id ?? null
  const cpt = armed_id === WEAPON_ATTACK_ID ? Infinity : (active_spell?.levels?.[0]?.casts_per_turn ?? CASTS_UNLIMITED)
  const cpt_cap = cpt === CASTS_UNLIMITED || cpt === 0 ? Infinity : cpt
  const armed_key = armed_id === WEAPON_ATTACK_ID ? WEAPON_ATTACK_ID : (active_spell?.name_key ?? null)
  const armed_queued = cast_path.reduce((n, e) => (e.spell_key === armed_key ? n + 1 : n), 0)
  // FIX 4 — the cast.move::enforce_and_record_cast gates the AP/casts_per_turn pair above does NOT model:
  //  • COOLDOWN (cross-turn): the armed spell is undraftable while `my_turn_no − last_cast_turn ≤ cooldown`.
  //  • casts_per_turn under a cooldown: a C>0 spell aborts a SAME-turn recast on-chain (t − last_turn = 0 ≯ C),
  //    so its EFFECTIVE per-turn cap is 1 whatever the authored casts_per_turn (13 seeded spells are cd>0 ∧ cpt>1).
  //  • casts_per_target (per-cell): at the cap, that CELL drops from the castable footprint (other cells stay).
  // The weapon has none of these. `armed_key` is the primary's name_key even unarmed, so the unarmed quick-cast
  // is gated + recorded on the SAME key (no asymmetry).
  const armed_cooldown = armed_id === WEAPON_ATTACK_ID ? 0 : (active_spell?.levels?.[0]?.cooldown ?? 0)
  const armed_on_cd = on_cooldown(last_cast_turn[armed_key], my_turn_no, armed_cooldown)
  const armed_cd_left = cooldown_left(last_cast_turn[armed_key], my_turn_no, armed_cooldown)
  const cpt_cap_eff = armed_cooldown > 0 ? 1 : cpt_cap
  const cpt_target_cap = armed_id === WEAPON_ATTACK_ID ? Infinity : cap_of(active_spell?.levels?.[0]?.casts_per_target)

  // D108/D109 (Decision-A: the chain-SEEDED cell IS a valid pick) — the encoded escrow cell (`me.cell`)
  // snapped into the contract's legal start set (placement_cells[0]) so READY's place_at never EBadStartCell.
  const seeded_pick = useMemo(() => {
    if (!phase_is_placement(phase) || me?.cell == null) return null
    const legal = (fight?.placement_cells?.[0] ?? []).map((c) => encode(c.x, c.y))
    return legal.length === 0 || legal.includes(me.cell) ? me.cell : legal[0]
  }, [phase, me?.cell, fight?.placement_cells])
  // ONE source for model/highlight/READY: the explicit pick if clicked, else the seeded default (D109).
  const effective_pick = placement_pick ?? seeded_pick

  const occupied = useMemo(() => {
    /** @type {Map<number, { kind: 'player' | 'mob', alive: boolean, idx: number }>} */
    const map = new Map()
    if (!dungeon) return map
    dungeon.escrow.forEach((p, i) =>
      map.set(p.cell, { kind: 'player', alive: p.committed?.alive ?? p.alive, idx: i })
    )
    dungeon.mobs.forEach((m, i) =>
      map.set(m.cell, { kind: 'mob', alive: m.committed?.alive ?? m.alive, idx: i })
    )
    return map
  }, [dungeon])

  // PATHFINDING (retro-exact): the move-range set is the 4-connected BFS reach around the
  // SAME blocked set the contract charges — obstacles ∪ holes ∪ out-of-bounds (room shape) ∪ every OTHER living
  // fighter (body-blocking) — via the fight-los twin of combat_grid::bfs_path_cost. So the range wash, the
  // click-gate, and the committed MP agree cell-for-cell (dungeon_turn.move apply_move → bfs_path_cost over
  // dungeon::move_blocked_cells). The grid (obstacles/holes/dims) is recomputed from the dungeon id + room index
  // (dungeon_blocked_cells → generateGrid), the identical seed regenerate_room_grid uses on-chain.
  // OPTIMISTIC VACATED CELL (regression: couldn't walk on a cell where a mob had just died): a mob the drafted
  // casts kill vacates its cell for THIS turn's moves ONLY when the casts commit BEFORE the moves (cast_first —
  // flush_commit ships [...casts, ...moves], and the chain remasks over LIVING mobs per apply_move: cast.move
  // move_blocked_cells:632, mob::is_alive = hp>0). So when cast_first, drop every drafted-killed mob cell from the
  // movement blocked set NOW — the chain has already freed it by the time my move applies, but the `dungeon` view
  // still reads it alive until the poll, so the gate would otherwise refuse a step the commit accepts. A move-FIRST
  // draft (cast_first=false) keeps the mob blocking: its move applies while the mob still stands (else EIllegalMove).
  const optimistic_vacated = useMemo(() => {
    const vacated = new Set()
    if (!cast_first || !dungeon) return vacated
    for (const [idx, m] of dungeon.mobs.entries()) {
      const committed_hp = committed_mob_hp(fight_store.getState(), idx)
      if (!(committed_hp > 0)) continue
      const drop = cast_path.reduce((s, e) => (e.cell === m.cell ? s + dmg_of(e.spell_key) : s), 0)
      if (drop >= committed_hp) vacated.add(m.cell) // this turn's casts already kill it → its cell opens for the move
    }
    return vacated
  }, [cast_first, cast_path, dungeon])

  const reachable = useMemo(() => {
    // MP-ZONE MISCLICK GUARD: when the vfx/sequence of a spell is played, the MP zone stays hidden
    // so a misclick can't move the character — MY OWN cast/weapon VFX still presenting empties the move-click
    // affordance, the SAME fact (engine_view's cast_presenting, project.js) the paint's move_wash wash suppresses
    // on; never a second UI-side flag. Narrower than `fight.presenting` (nonlocal-only — a mob/peer replay; my
    // own WALK beats never trip this, so the D254 cumulative-move chaining stays fluid while a walk animates).
    if (!me || !my_turn || !dungeon || fight?.cast_presenting) return new Set()
    const blocked = presentation_blocked_cells(dungeon, fight?.fighters, entity_id, optimistic_vacated)
    // D254: re-anchor at the LAST drafted step (or the chain cell) with the REMAINING mp (my_mp − Σ segment
    // costs). The reach shrinks as the path grows and empties at 0 MP — so a turn can no longer "walk forever".
    const anchor = move_path.length ? move_path[move_path.length - 1] : me.cell
    // the whole-path recharge measures from the CHAIN cell (the pool's committed anchor) — me.cell is the
    // PRESENTED cell (the drafted Moved intent already folded there), which would zero the early segments.
    const start = me.committed?.cell ?? me.cell
    const remaining = Math.max(0, my_mp_eff - draft_move_cost(move_path, start, blocked, my_mp_eff))
    return new Set(bfsReachable(anchor, remaining, blocked))
  }, [me, my_turn, my_mp_eff, dungeon, entity_id, move_path, optimistic_vacated, fight?.fighters, fight?.cast_presenting])

  // OPTIMISTIC CASTER CELL (FIGHT-WAVE-2 root cause): a cast AFTER a move did NOTHING. `castable` computed
  // range/LOS from `me.cell` — the CHAIN baseline (pre-move) — so a mob only reachable from the drafted post-move
  // cell fell OUT of the set → on_cell_click missed the cast branch → the mob cell (a living actor) also failed
  // `reachable` → a SILENT no-op (no error, no float). Anchor the cast at the drafted post-move cell instead: it
  // is the EXACT cell the contract validates the cast from, since commit_turn applies MOVE→CAST in array order
  // (dungeon_turn.move commit_turn_core). No move drafted → the chain cell.
  const caster_cell = move_path.length ? move_path[move_path.length - 1] : me?.cell
  const castable = useMemo(() => {
    // AP-BUDGET GATE (§17.27): empty the set once the REMAINING AP (after queued strikes) can't afford another, or
    // the armed spell's casts_per_turn cap is reached — greyed sockets + no beat for an unaffordable action.
    // FIX 4: + the cross-turn COOLDOWN (armed_on_cd) and the cooldown-folded per-turn cap (cpt_cap_eff) join the
    // AP / casts_per_turn empties — an on-cooldown or already-once-cast (cd>0) spell lights NO castable cell.
    if (
      !me ||
      !my_turn ||
      remaining_ap < cast_params.ap_cost ||
      armed_queued >= cpt_cap_eff ||
      armed_on_cd ||
      caster_cell == null
    )
      return new Set()
    // D284 twin of dungeon.move los_obstacles(): the sight-line clears through `obstacles ∪ living bodies`, not
    // bare obstacles — a mob standing BEHIND another fighter is not castable. The caster (me) is excluded: its
    // firing cell is caster_cell (self-excluded by losBlocks) and skipping its stale pre-move chain cell keeps the
    // vacated cell see-through after a drafted move. line_of_sight self-excludes both endpoints, so a body ON the
    // target stays hittable — players never click into an on-chain LOS abort.
    const los_blockers = [...obstacles]
    for (const [c, o] of occupied) if (o.alive && c !== me.cell) los_blockers.push(c)
    // P1 SELF-CAST (#55): an ARMED spell aims by the spell_target::can_cast_at twin —
    // GEOMETRY + OCCUPANCY ONLY (self at rmin 0, allies and EMPTY cells are all legal aims; team is a
    // per-effect concern and flush_commit already ships void casts). ONE legality home: the SAME
    // cast_range_set_dungeon the adapter's dark-blue wash paints, fed the same seed flags — the gate and
    // the wash can never drift (the old mob-only loop lit his own cell but ate the click). free_cell
    // (traps) drops occupied cells (the chain rejects them). UNARMED keeps the mob-only primary
    // quick-cast below so a plain board click still MOVES (widening it would turn every in-range ground
    // click into a cast). The WEAPON (S-12) is EXCLUDED from this spell-geometry branch — cast::weapon_strike
    // demands a LIVING enemy ON the target cell (never an empty aim), so it falls through to the mob-only loop
    // below, gated by the SAME weapon [1, reach] cast_params + LOS the chain checks.
    if (fight?.armed_spell_id && fight.armed_spell_id !== WEAPON_ATTACK_ID) {
      const lvl = active_spell?.levels?.[0]
      // 1.29 TRAP-STACKING BAN: a trap-PLACING spell may not target a cell already anchoring
      // MY live trap — the chain aborts it (cast::ECellAlreadyTrapped), so the gate greys it here from the fold's
      // engine_view.my_traps (the ONE client trap home — the sim door reads the SAME projection, so legality and
      // prediction never diverge; an ENEMY's invisible trap stays unknowable and surfaces as the honest abort toast).
      const my_trap_cells =
        (lvl?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP') && fight?.fight_id
          ? fight.my_traps
          : undefined
      const footprint = cast_range_set_dungeon(
        [cast_params.range_min, cast_params.range_max],
        { cell: decode(caster_cell) },
        dungeon_grid_of(dungeon),
        los_blockers,
        { los: lvl?.line_of_sight !== false, linear: lvl?.linear === true, trap_cells: my_trap_cells }
      )
      if (lvl?.free_cell === true) for (const c of [...footprint]) if (occupied.get(c)?.alive) footprint.delete(c)
      // FIX 4 casts_per_target: a cell already at its per-target cap this turn drops out (chain aborts ECastsPerTarget).
      if (cpt_target_cap !== Infinity)
        for (const c of [...footprint])
          if (casts_at_cell(cast_path, armed_key, c) >= cpt_target_cap) footprint.delete(c)
      return footprint
    }
    const out = new Set()
    for (const [cell, o] of occupied) {
      if (o.kind !== 'mob' || !o.alive) continue
      const d = manhattan(caster_cell, cell)
      if (d < cast_params.range_min || d > cast_params.range_max) continue
      if (!lineOfSight(caster_cell, cell, los_blockers)) continue
      if (casts_at_cell(cast_path, armed_key, cell) >= cpt_target_cap) continue // FIX 4 casts_per_target (per cell/turn)
      out.add(cell)
    }
    return out
  }, [
    me,
    my_turn,
    remaining_ap,
    armed_queued,
    cpt_cap_eff,
    armed_on_cd,
    cpt_target_cap,
    armed_key,
    cast_path,
    occupied,
    obstacles,
    caster_cell,
    cast_params,
    fight?.armed_spell_id,
    active_spell,
    dungeon,
  ])

  // OPTIMISTIC WALK (#39, D254 cumulative): the click IS the move — walk the active player NOW, from wherever
  // they're currently rendered (the chain start, or a previous draft cell) to the new LAST cell of the draft
  // path (or BACK toward the chain start when a step is undone). THE ONE DOOR (fight/store.js): the core paints
  // this as a LOCAL wave turn (prediction-first, natural durations) the instant it folds — replacing the old
  // fight-intents.js mask + packet/fightMoved dispatch. The on-chain 1.29 rule (each move charges its own
  // segment) is mirrored — every drafted step is one commit action.
  const optimistic_walk = (draft) => {
    if (!fight.fighters.has(entity_id)) return
    // same optimistic-vacated blocked set as `reachable` — a cast-first drafted kill frees its cell for this walk too,
    // so the committed BFS cost (draft_move_cost) matches the chain's apply_move (which sees the mob already dead).
    const blocked = presentation_blocked_cells(dungeon, fight?.fighters, entity_id, optimistic_vacated)
    // the committed CHAIN cell anchors both the full-undo walk-back destination and the whole-draft recharge —
    // me.cell is the PRESENTED (already-drafted) cell, which made an emptied draft walk back to itself and
    // never restore the spent MP.
    const chain_cell = me.committed?.cell ?? me.cell
    const dest = draft.length ? draft[draft.length - 1] : chain_cell // encoded; empty draft → back to the chain start
    // ANCHOR THE FROM ON THE DRAFTED PATH, never the PRESENTED fighter cell: since the snap-then-run display hold
    // (d4f9e748) the presented cell (fight.fighters — engine_view) lags at the pre-move origin until each walk beat
    // acks, so a fast multi-step draft (step N+1 clicked before step N presents) read the stale origin → a beat
    // replaying from origin (a re-walk). move_path here is the PRE-action draft (both call sites derive `draft` from
    // it), so its last cell is exactly where this segment begins; chain_cell (the committed anchor, read for `dest`
    // too) covers the first step.
    const from_enc = move_path.length ? move_path[move_path.length - 1] : chain_cell
    const path = from_enc === dest ? [] : bfsPath(from_enc, dest, blocked, GRID_CELLS).map(decode)
    // MP-PAINT TRUTH (the AP flagship's movement twin): the intent carries the ABSOLUTE remaining MP after the
    // WHOLE draft (this board's own draft math — the gate/commit home), so the projected budget and the wash
    // shrink/restore with every append AND undo. Absolute (not a delta): an undone step re-raises it honestly.
    const mp_left = Math.max(0, my_mp_eff - draft_move_cost(draft, chain_cell, blocked, my_mp_eff))
    fight_store.getState().input({
      type: 'intent',
      intent: { kind: 'move', character: entity_id, to_cell: dest, mp_left },
      // The drafted path renders THIS frame; local_move_beats bridges it to the producer's move_path RESOLVER
      // contract (a raw array here is invoked as a function → the S2 "instance of Array" crash — regression-locked).
      beats: local_move_beats({ fight_id: fight.fight_id, character: entity_id, to_cell: dest, path }),
    })
  }

  // ONE home for entity_id → { is_mob, idx } (dungeon escrow is the source): the optimistic cast AND the flush's
  // ⑭ evolved-sequence validation both resolve fighter refs the same way — a player rides its character id, a mob
  // rides 'mob-N'. Guards a null dungeon (pre-fight) so callers never throw.
  const resolve_ref = (fighter_id) => {
    const mob_match = /^mob-(\d+)$/.exec(String(fighter_id))
    if (mob_match) return { is_mob: true, idx: Number(mob_match[1]) }
    const idx = dungeon?.escrow?.findIndex((row) => String(row.character ?? row.character_id) === String(fighter_id)) ?? -1
    return idx < 0 ? null : { is_mob: false, idx }
  }

  // OPTIMISTIC CAST (P1): the chain-corpus template runs through @aresrpg/sim once. Its deterministic state delta
  // becomes one composite reducer input (Cast + all projection-supported outcomes + the shared sim render beats),
  // so subscribers can never observe a half-folded cast. Public turn-seed crits select the exact authored branch;
  // chance rows and B7's not-yet-deployed chain kinds remain cast-only until authoritative settlement.
  const optimistic_cast = (mob_cell) => {
    const queue = use_dungeon_turn.getState().cast_path
    const spell_key = queue.at(-1)?.spell_key ?? armed_key ?? null
    const caster_idx = dungeon.escrow.findIndex((p) => (p.character ?? p.character_id) === entity_id)
    const template =
      spell_key === WEAPON_ATTACK_ID
        ? weapon_spell_template(me?.weapon)
        : fight_spell_template(spell_key)
    const stats_of = (fighter_id) => {
      const ref = resolve_ref(fighter_id)
      const row = ref?.is_mob ? dungeon.mobs[ref.idx] : dungeon.escrow[ref?.idx]
      return { agility: Number(row?.agility ?? 0) }
    }
    const prediction = predict_cast({
      view: fight_view(),
      caster_id: entity_id,
      spell: template,
      target_cell: mob_cell,
      critical_clock: {
        world_seed: dungeon.world_seed,
        spawn_id: dungeon.spawn_id,
        turn_deadline_ms: dungeon.turn_deadline_ms,
        seat: caster_idx,
        slot: Number(me?.casts_this_turn ?? 0) + Math.max(0, queue.length - 1),
      },
      resolve_ref,
      stats_of,
    })
    if (!prediction?.actions.length) return
    const core = fight_store.getState()
    core.input({
      type: 'predicted',
      intent_id: `cast:${fight.fight_id}:${core.intent_seq}`,
      basis_version: core.applied_version + 1,
      actions: prediction.actions,
      beats: prediction.beats,
      // ④+⑦b: fold any trap THIS cast places into the store's durable my_traps (the ONE client trap home) so a
      // same-turn push force-stops on it AND render + cast-legality read the same projection.
      place_traps: prediction.placed_traps ?? [],
      // fold any glyph THIS cast places into the store's durable my_glyphs (single home — the render reads the
      // engine_view projection directly, no overlay module) so the orange zone shows this frame and expires with it.
      place_glyphs: prediction.placed_glyphs ?? [],
    })
  }

  // NO-WALK LAW (v31 — tackles are deterministic, so the walk must not be allowed at all): when
  // next_move_tackle says my next move fails its escape, the walk NEVER starts. Predict the sim's EXACT outcome
  // (fight_actions.apply_move failed-escape = cells_moved 0, both pools bitten): the 'Tackled' action folds the
  // forfeit THIS frame + the hit-anim/pool-forfeit beat plays — the SAME action + producer the receipt uses, so
  // the receipt's own Tackled event CONFIRMS (version-purge → re-fold), never corrects. Zero displacement — the
  // move draft is untouched, my_key stays on its committed cell.
  const predict_tackle = ({ ap_lost, mp_lost }) => {
    const runner_idx = dungeon.escrow.findIndex((p) => (p.character ?? p.character_id) === entity_id)
    if (runner_idx < 0) return
    fight_store.getState().input({
      type: 'intent',
      intent: { kind: 'Tackled', runner_is_mob: false, runner_idx, ap_lost, mp_lost },
      beats: local_intent_beats(
        synthetic_tackled_events({ fight_id: fight.fight_id, runner_is_mob: false, runner_idx, ap_lost, mp_lost }),
        {
          fight_id: fight.fight_id,
          resolve_fighter_id: ({ is_mob, idx, character }) =>
            character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : entity_id,
        }
      ),
    })
  }

  // ── AUTO-COMMIT (D36 deadline + D37a kill) — the reducer derives one due edge; this function remains the
  //    shared manual/background batch builder and revalidates the live fire conditions before submit. ──
  const flush_commit = async (mp, cast_queue, background = false) => {
    // LOUD-PIPELINE (qa D89 flag: a sequential commit dropped SILENTLY): the last mute guard on the END TURN
    // path now NAMES itself instead of vanishing.
    // Read `busy` LIVE at the derived edge; a render closure is never transaction authority.
    const busy_now = use_dungeon.getState().busy
    // TERMINAL-RACE guard (regression: the deadline auto-commit fired begin_action into a fight the
    // killing blow already ENDED → SimulationError abort 101, then a scary "failed on-chain" toast). Only an
    // ACTIVE fight on MY still-live turn takes a commit. Re-read the fire conditions LIVE at FIRE time — status
    // from the store AND my-turn/winner from the live fight slice (the `my_turn` closure can be stale by the time
    // an async edge runs) — so a moot commit is SKIPPED silently (nothing to commit, no toast). The
    // benign-101 swallow in commit_turn is the backstop for the case only the CHAIN yet knows is terminal.
    const status_now = use_dungeon.getState().dungeon?.status
    const live_fight = fight_view() // synchronous core view (S2 mirror kill) — fire-time truth, never a stale copy
    const my_turn_now = !!live_fight && live_fight.active_entity_id === entity_id && live_fight.winner === -1
    if (!my_turn_now || busy_now || status_now !== STATUS_ACTIVE) {
      fight_state_trace('flush_skipped', {
        background,
        my_turn: my_turn_now,
        busy: busy_now,
        status: status_now,
      })
      game_log('board', 'flush_commit skipped — not an active commit at fire time', {
        my_turn_now,
        busy: busy_now,
        status: status_now,
        background,
      })
      return
    }
    const actions = []
    // D254 (1.29 cumulative move): EACH drafted step ships as its OWN {kind:0} move — commit_turn_core's loop
    // charges bfs_path_cost PER segment from the running cell (a single direct move under-charges a bent path).
    const move_actions = (mp ?? []).map((step) => ({ kind: 0, target: step }))
    // D99 (regression: moving after a spell failed to commit): the contract applies the batch IN ARRAY ORDER —
    // casts drafted BEFORE any move ship as [casts, …moves] (validated from the PRE-move cell), else [moves, casts].
    const { cast_first } = staged_turn_paths(fight_store)
    // S-12 §17.27 STACKED CASTS: ship EVERY queued cast/weapon (the chain accepts N/turn, AP-limited on-chain). Each
    // entry PINNED its own spell_key at draft time, so a disarm/re-arm between pick and flush can't swap what
    // commits. Revalidate each against CURRENT state with the SAME twin the click gate paints (a co-op mob shift /
    // the drafted moves can invalidate a target between pick and flush) — anchored at the cell the contract
    // validates from: the PRE-move chain cell when casts ship first, else the POST-move final cell. A dropped entry
    // rolls its optimistic AP/HP back; the survivors still commit.
    // cast_first anchors at the PRE-move CHAIN cell — me.cell is the PRESENTED cell, already sitting at the
    // drafted post-move destination once the Moved intent folds (the same committed-anchor family as the pool).
    const anchor = cast_first ? (me?.committed?.cell ?? me?.cell) : mp?.length ? mp[mp.length - 1] : me?.cell
    const caster_seat = resolve_ref(entity_id)?.idx ?? -1
    // ⑭ EVOLVED-SEQUENCE VALIDATION (regression: placing a trap behind a mob then pushing it on — the turn
    // committed without the spell, though everything was valid): the chain commits ONE PTB in D99 order, each action reading LIVE evolved
    // state, so a drafted cast is judged against the board the CHAIN sees WHEN IT FIRES — the committed base
    // folded through the PRIOR casts' displacements/kills via the sim door — NEVER the optimistic end-state,
    // where THIS cast's own push already moved its target and made its own valid cast look stale. Moves never
    // displace a mob, so the fold is move-independent (the caster's cell stays `anchor`); `occupied` is the
    // pre-fight fallback.
    const evolved = evolve_flush_casts({
      view: fight_view(),
      committed: committed_state(fight_store.getState()),
      caster_id: entity_id,
      casts: (cast_queue ?? []).map((entry) => {
        const weapon = entry.spell_key === WEAPON_ATTACK_ID
        const drafted = weapon ? null : (my_spells.find((sp) => sp.name_key === entry.spell_key) ?? null)
        return {
          spell: weapon
            ? weapon_spell_template(me?.weapon)
            : drafted?.object_id
              ? fight_spell_template(entry.spell_key)
              : null,
          target: entry.cell,
        }
      }),
      resolve_ref,
    })
    const cast_actions = []
    // Trap cells committed THIS flush (survivors → chain truth) vs DROPPED trap drafts (their optimistic
    // click-time marker — trap paint at cast, design ruling 2026-07-17 — must roll back). The keyless read layer drops
    // Fight.fx, so the client mirrors its own placed traps; markers live until sprung / fight end.
    const trap_placed = []
    const trap_dropped = []
    let dropped = 0
    // LEG 0a — CAST AUTO-RETARGET (a mob shifting one cell silently invalidated a drafted
    // cast). Counts the SUBSET of `dropped` specifically caused by retarget_cast's own reach failure, so the
    // post-loop toast picks the honest reason (§ below) instead of always saying "stale".
    let retarget_unreachable = 0
    if (me && dungeon && anchor != null)
      for (const [cast_i, entry] of (cast_queue ?? []).entries()) {
        const is_weapon = entry.spell_key === WEAPON_ATTACK_ID
        const drafted_spell = is_weapon ? null : (my_spells.find((sp) => sp.name_key === entry.spell_key) ?? null)
        // ⑭ the board the chain evolves to JUST BEFORE this cast fires; the eye-state occupancy is the fallback.
        const occ = evolved[cast_i]?.occupied ?? occupied
        const los = [...obstacles]
        for (const [c, o] of occ) if (o.alive && !(o.kind === 'player' && o.idx === caster_seat)) los.push(c)
        // Resolve the drafted cast's target FIGHTER through the EYE-STATE occupancy (`occupied` — the last-rendered
        // board; it still shows the click-time cell even once a fresher committed/evolved read has moved the
        // fighter on, which is exactly what makes it useful here). No fighter found (a void cast, or the ground
        // itself) resolves a null committed_cell — txs.retarget_cast's own null branch composes the drafted cell
        // unchanged, so a void cast is untouched by this lookup. Same p{seat}/m{idx} key format base_from_view
        // writes (fold.js) — mob_key/seat_key aren't exported; `occupied`'s idx already matches that indexing.
        const eye_target = occupied.get(entry.cell)
        const target_committed_cell = eye_target
          ? (committed_state(fight_store.getState()).fighters?.[`${eye_target.kind === 'mob' ? 'm' : 'p'}${eye_target.idx}`]
              ?.cell ?? null)
          : null
        const drop_entry = (reason) => {
          game_log('board', `flush_commit: staged strike dropped — ${reason}`, {
            cell: entry.cell,
            anchor,
            weapon: is_weapon,
            background,
          })
          dropped += 1
          // a dropped trap draft never reaches the chain — its click-time optimistic marker rolls back below.
          if ((drafted_spell?.levels?.[0]?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP'))
            trap_dropped.push(entry.cell)
        }
        let illegal
        let target_cell = entry.cell
        if (is_weapon) {
          // WEAPON: [1, reach] + LOS + a LIVING enemy on the cell — the exact cast::weapon_strike gate. reach off the
          // seat's on-chain Weapon (independent of the current armed state — the draft is what commits).
          const reach = me.weapon?.reach ?? WEAPON_ATTACK_RANGE[1]
          const footprint = cast_range_set_dungeon(
            [1, reach],
            { cell: decode(anchor) },
            dungeon_grid_of(dungeon),
            los,
            { los: true, linear: false }
          )
          const retargeted = retarget_cast({
            target_cell: entry.cell,
            committed_cell: target_committed_cell,
            reaches: (cell) => footprint.has(cell),
          })
          if (retargeted.dropped) {
            drop_entry('target moved out of reach at flush')
            retarget_unreachable += 1
            continue
          }
          target_cell = retargeted.target
          const tgt = occ.get(target_cell)
          // Liveness is CHAIN-COMMITTED (committed_mob_hp — my drafts EXCLUDED), never the optimistic `tgt.alive`:
          // this swing's OWN kill already folded the mob dead, so gating on the optimistic corpse dropped a
          // mob-killing strike "as if I did nothing" and the receipt then revived it (regression ①/⑧b). The
          // chain's act_weapon validates against live on-chain hp BEFORE applying, so the finishing swing is legal.
          illegal = strike_flush_illegal({
            in_footprint: footprint.has(target_cell),
            is_weapon: true,
            target_is_mob: tgt?.kind === 'mob',
            committed_target_alive: tgt?.kind === 'mob' && (committed_mob_hp(fight_store.getState(), tgt.idx) ?? 0) > 0,
          })
        } else {
          // The DRAFTED spell (pinned at pick) judges the cast — a disarm/re-arm can't use the wrong spell's flags.
          const lvl = drafted_spell?.levels?.[0]
          const footprint = cast_range_set_dungeon(
            lvl?.range ?? [cast_params.range_min, cast_params.range_max],
            { cell: decode(anchor) },
            dungeon_grid_of(dungeon),
            los,
            { los: lvl?.line_of_sight !== false, linear: lvl?.linear === true }
          )
          const retargeted = retarget_cast({
            target_cell: entry.cell,
            committed_cell: target_committed_cell,
            reaches: (cell) => footprint.has(cell),
          })
          if (retargeted.dropped) {
            drop_entry('target moved out of reach at flush')
            retarget_unreachable += 1
            continue
          }
          target_cell = retargeted.target
          illegal = strike_flush_illegal({
            in_footprint: footprint.has(target_cell),
            is_weapon: false,
            free_cell: lvl?.free_cell === true,
            occupied_alive: !!occ.get(target_cell)?.alive,
          })
        }
        if (illegal) {
          drop_entry('target no longer valid at flush')
          continue
        }
        // VOID CASTS ARE LEGAL (a cast at any legal-geometry cell is the player's right). Weapon → {kind:2}
        // act_weapon; spell → {kind:1} act_cast staging the on-chain SpellTemplate id (a spell with no resolved id
        // is skipped LOUDLY, never downgraded to a swing).
        if (is_weapon) cast_actions.push({ kind: 2, target: target_cell, spell_key: WEAPON_ATTACK_ID })
        else if (drafted_spell?.object_id) {
          cast_actions.push({
            kind: 1,
            target: target_cell,
            spell_template_id: drafted_spell.object_id,
            spell_key: drafted_spell.name_key, // VFX handoff — the bridge's confirm replay routes element VFX by it
          })
          // A PLACE_TRAP effect ⇒ this cast lays a trap on `target_cell` — remember it to mark once committed.
          if ((drafted_spell.levels?.[0]?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP'))
            trap_placed.push(target_cell)
        } else
          game_log('board', 'flush_commit: cast drafted but no on-chain spell id resolved — skipped', {
            spell_key: entry.spell_key,
          })
      }
    // ROLLBACK LAW (regression: "mobs regain health"): a dropped strike's optimistic AP/HP must not sit dropped while
    // the poll catches up — THE ONE DOOR's own receipt purge handles this now (an authoritative receipt at
    // version V discards every optimistic intent at/below V, dropped or not; fight-intents.js's manual clear is
    // gone with it).
    // ARRAY ORDER (D99): casts-first vs moves-first, the whole batch in one commit_turn.
    actions.push(...(cast_first ? [...cast_actions, ...move_actions] : [...move_actions, ...cast_actions]))
    fight_state_trace('flush_started', {
      background,
      move_count: move_actions.length,
      cast_count: cast_actions.length,
      dropped,
    })
    // TX TRANSPARENCY: every transaction surfaces its toast, INCLUDING the deadline
    // auto-pass/auto-commit (M3 wiring row: the auto-pass toast was missing on "ending turn"): the
    // BACKGROUND auto-commit announces itself through the one toast home the instant it submits — EMPTY batch
    // included (the auto-PASS is still one real signed tx: a bare act_pass). A manual END TURN is the player's
    // own gesture and stays quiet on success. SILENT ON VICTORY (regression ⑧a): killing the last mob
    // fires this auto-commit while `winner` is still -1 (the fold never sets it optimistically), so the
    // deadline-flavoured "ending turn — committing your drafted actions" toast announced a WIN — "it should not
    // show that toast ever". The commit still ships the killing draft to chain; only the toast stays quiet.
    const enemy_mobs = [...(live_fight?.fighters?.values() ?? [])].filter((f) => !f.is_player)
    const enemies_all_down = enemy_mobs.length > 0 && enemy_mobs.every((f) => (f.health ?? 0) <= 0)
    if (announce_auto_commit({ background, enemies_all_down }))
      push_event_toast({
        state: 'info',
        title: t(actions.length ? 'dungeons.auto_commit_fired' : 'dungeons.auto_pass_fired'),
      })
    const ok = await commit_turn(actions, { background }) // reconciles to committed chain (crit lands here)
    // ④+⑦b: the store's durable my_traps is the ONE trap home — a trap whose cast never reached the chain (dropped,
    // or a failed commit) is taken back by cell through drop_traps; render + cast-legality read the same fold.
    const store_dropped = ok ? trap_dropped : [...trap_placed, ...trap_dropped]
    if (fight?.fight_id && store_dropped.length) fight_store.getState().input({ type: 'drop_traps', cells: store_dropped })
    if (fight?.fight_id) for (const cell of [...trap_placed, ...trap_dropped]) pending_trap_cells.current.delete(cell)
    fight_state_trace('flush_finished', { background, ok })
    // FIX 4: stamp each committed SPELL cast (kind:1) onto the cooldown clock at the turn it cast (my_turn_no) —
    // mirrors enforce_and_record_cast recording only casts that LANDED (a dropped/weapon action records nothing).
    if (ok) {
      const cast_turns = /** @type {Record<string, number>} */ ({})
      for (const a of cast_actions) if (a.kind === 1 && a.spell_key) cast_turns[a.spell_key] = my_turn_no
      if (entity_id && Object.keys(cast_turns).length) record_cast_turns(entity_id, cast_turns)
    }
    clear_picks()
    // FIX 2 (overrules D97 silence): a flush-time cast DROP surfaces ONE honest event toast — the moves
    // committed, the spell did not (its target went stale). Only on a SUCCESSFUL commit; a FAILED commit already
    // surfaces its own single toast (manual via tx_commit_turn, background via commit_turn's catch below).
    // LEG 0a: a target that moved OUT OF REACH gets its OWN toast (dungeons.cast_target_unreachable) — distinct
    // from the generic "stale" drop so the player learns WHY (a chase that failed vs. some other invalidation).
    if (ok && retarget_unreachable > 0) push_event_toast({ state: 'info', title: t('dungeons.cast_target_unreachable') })
    if (ok && dropped > retarget_unreachable) push_event_toast({ state: 'info', title: t('dungeons.cast_dropped_stale') })
    fight_store.getState().input({ type: 'clear_staged' })
    return ok
  }
  // The reducer owns deadline/kill/busy/latch decisions. This is the ONE remaining effect: claim the derived
  // false→true edge once for the playable turn, read the draft live, and submit the existing background commit.
  auto_submit_ref.current = () => {
    const { move_path: mp, cast_path: cq } = staged_turn_paths(fight_store)
    fight_state_trace('auto_flush_fired', { move_count: mp.length, cast_count: cq.length })
    if (mp.length === 0 && cq.length === 0) {
      game_log('board', 'auto-flush no-op — reducer draft queue is empty')
      clear_picks()
      fight_state_trace('flush_finished', { background: true, ok: true, noop: true })
      return true
    }
    return flush_commit(mp, cq, true)
  }
  useEffect(
    () =>
      subscribe_commit_due(fight_store, {
        submit: () => auto_submit_ref.current?.(),
        on_error: (error) => {
          fight_state_trace('auto_flush_edge_error', { message: String(error?.message ?? error) })
          game_log('board', 'auto-commit edge failed', error)
        },
      }),
    []
  )
  useEffect(
    () =>
      subscribe_divergence(fight_store, {
        on_divergence: (divergence) => {
          game_log('board', 'fight prediction diverged; authoritative action adopted', divergence)
          push_event_toast({
            state: 'info',
            title: humanize_abort(t('dungeons.prediction_reconciled')),
          })
        },
      }),
    [t]
  )
  // The LOST-TURN toast (no-silent-failure law — "the auto pass just rolled back my movement" was a
  // named regression): the reducer surfaces a drafted turn that expired uncommitted as `turn_lost`; this edge consumes
  // it exactly once per turn (reducer-owned `shown` consumption — remount-safe) regardless of reason — the
  // `shown` idempotency and the state-truth output are unconditional. PRESENTATION is gated: 'missed'/'burned'
  // are deadline-passed — the turn timeline already shows a turn advancing, so the toast stays silent
  // (announce_turn_lost); 'latched' (an executed on-chain FAILURE, gas spent) is genuinely
  // new information and still announces.
  useEffect(
    () =>
      subscribe_turn_lost(fight_store, {
        on_lost: ({ reason }) => {
          fight_state_trace('turn_lost_toast', { reason })
          if (!announce_turn_lost(reason)) return
          push_event_toast({
            state: 'error',
            title: t('dungeons.turn_lost_title'),
            message: t('dungeons.turn_lost_latched'),
          })
        },
      }),
    []
  )

  // The pick decision (unchanged rules): a CAST wins over a move on a castable cell. `cast_only` (a spell
  // card dropped on the board) restricts the decision to the cast branch — a drop on a non-castable cell is
  // a no-op (the card returns to the hand), never a stray move pick. Every pick now ALSO fires its optimistic
  // execution (walk / cast) so the action resolves in a frame — never a yellow-draft-then-nothing (#39).
  const on_cell_click = (cell, cast_only) => {
    // A local optimistic draft (set_*_target + optimistic_*, zero tx) doesn't gate on the tx-`busy` flag — consistent
    // with the store's user-actions-proceed-during-busy design; commit_turn snapshots the draft at End-Turn so a
    // re-draft can't race it. my_turn alone gates (placement/entering have my_turn=false). [D242: busy was NOT the
    // "click doesn't move" root — that was placement-phase/coords confusion; the move-fires path is qa-verified.]
    if (!my_turn) return
    // ── S-12 §17.27: the equipped-WEAPON strike and every spell share ONE targeting model. A click on a CASTABLE
    //    cell drafts the strike/cast (optimistic beat now, act_weapon/act_cast at End Turn); a click OFF the
    //    targetable set DESELECTS the armed card (clicking outside a targetable cell unselects
    //    the spell, superseding the old D301 silent no-op). The WEAPON pins WEAPON_ATTACK_ID so flush_commit
    //    routes it to act_weapon; a spell pins its name_key. ──
    const armed = fight?.armed_spell_id ?? null
    // D1 CELL-EXACT TARGETING (only the cell hitbox counts): the old ±1 "snap to the unique castable
    // neighbour" tolerance is DEAD — its root cause (a pointer-DOWN-time projection against a still-orbiting
    // camera) was fixed at the engine (board_picking projects FRESH at UP-time), and the snap itself grew every
    // castable mob a 5-cell click region that swallowed the cells beside/behind it (the v30 "hitbox too big"
    // report) and hijacked the off-target deselect. A click is exactly its cell now.
    // D2: while ARMED, every board click is forwarded to the CORE with its castable verdict — the deselect rule
    // (armed ∧ ¬targetable ⇒ disarm) lives in the fight core (store 'board_click'), not here. The disarm never
    // touches the draft queue (queued strikes survive — flush still ships them).
    if (armed) fight_store.getState().input({ type: 'board_click', cell, targetable: castable.has(cell) })
    if (castable.has(cell)) {
      // §17.27 STACK: each affordable click on a castable cell drafts ONE MORE strike/cast. `castable` already
      // went EMPTY once the remaining AP can't afford another (or the casts_per_turn cap is hit), so a click only
      // reaches here while affordable — the optimistic beat is 1:1 with a committable action (no phantom beats, no
      // "mobs regain health"). Each entry pins its own spell_key. NO toggle-off on a re-click — that would forbid
      // the 2nd stacked strike; cancel is the off-target disarm below.
      const spell_key = armed === WEAPON_ATTACK_ID ? WEAPON_ATTACK_ID : (active_spell?.name_key ?? null)
      append_cast_step({ cell, spell_key })
      const drafted_spell = my_spells.find((spell) => spell.name_key === spell_key)
      fight_store.getState().input({
        type: 'stage',
        intent: {
          kind: spell_key === WEAPON_ATTACK_ID ? 2 : 1,
          target: cell,
          spell_key,
          ...(drafted_spell?.object_id ? { spell_template_id: drafted_spell.object_id } : {}),
        },
      })
      optimistic_cast(cell)
      // TRAP PAINT AT CAST: casting a trap paints its marker optimistically at cast —
      // optimistic_cast above already folded the trap into the durable my_traps (place_traps) — the gold marker
      // paints NOW from engine_view.my_traps (the ONE home). The local pending set only tracks it for the
      // flush (drop/fail) and turn-boundary rollback below; commit turns the same fold record into chain truth.
      if (
        fight?.fight_id &&
        armed !== WEAPON_ATTACK_ID &&
        (active_spell?.levels?.[0]?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP')
      )
        pending_trap_cells.current.add(cell)
      return
    }
    if (cast_only) return
    // ARMED + a click OFF the targetable set: the CORE already disarmed (the board_click forward above —
    // 2026-07-17: clicking any non-targetable cell with a spell armed deselects it, now the store's one rule).
    // Queued strikes on real enemies SURVIVE the disarm (this block's own charter): the old
    // set_cast_target(null) here wiped the whole cast_path queue — flush ships it, so wiping it silently
    // cancelled every drafted strike. Only the cooldown case keeps a surface here: surface WHY (no silent no-op).
    if (armed) {
      if (armed !== WEAPON_ATTACK_ID && armed_on_cd)
        push_event_toast({ state: 'info', title: t('dungeons.spell_on_cooldown', { n: armed_cd_left }) })
      return
    }
    // D254 cumulative move: each reachable click APPENDS a new SEGMENT from the last step (its own segment + BFS
    // cost); `reachable` re-anchors at the new last step with the remaining MP (0 MP → empty reach → movement ends).
    // ② RULING 2026-07-19 (a player must not be able to cancel their action to replay it — walk, place a trap,
    // then click on yourself, which rolled the action back): the old "click the last drafted step ⇒ pop" undo is GONE — after a
    // walk the last step IS the player's own rendered cell, so that branch turned a SELF-CLICK into a draft cancel (a
    // free cancel-and-replay that also ate the turn clock, feeding ③). Rollback of a draft is not a user gesture; a
    // click on your own cell is now an inert no-op (the anchor is excluded from `reachable`) and a drafted turn stands.
    if (reachable.has(cell)) {
      // NO-WALK LAW (v31 — tackles are deterministic, so the walk must not be allowed at all): consult the
      // SAME deterministic contest the commit path enforces. A bitten move is STILL a committed attempt — the
      // chain rolls act_move(cell), fails the escape, and forfeits both pools with ZERO displacement (the sim's
      // apply_move → cells_moved 0) — so it STAGES like any move (the receipt then CONFIRMS the forfeit; an
      // unstaged forfeit would revert on the next commit). Only the OPTIMISTIC PRESENTATION differs: an escaping
      // roll walks as before; a bitten one predicts the forfeit + hit-anim THIS frame and the walk NEVER starts.
      const bite = next_move_tackle(fight_store.getState())
      append_move_step(cell)
      fight_store.getState().input({ type: 'stage', intent: { kind: 0, target: cell } })
      if (bite) predict_tackle(bite)
      else optimistic_walk([...move_path, cell])
    }
  }

  // Relay: a click / spell-drop on the rich 3D board bumps `clicked_seq` — react to every bump (not the
  // cell value, so re-clicking the SAME cell to toggle it off still fires).
  useEffect(() => {
    if (clicked_seq === 0) return
    on_cell_click(clicked_cell, clicked_cast)
  }, [clicked_seq])

  // A turn boundary invalidates any pending LOCAL draft (the use_dungeon_turn move/cast picks — the core's own
  // optimistic intents self-purge on the next authoritative receipt, fight-intents.js's manual clear is gone).
  // KEY ON THE REAL BOUNDARY (active_entity_id AND turn_deadline_ms — the SAME `active_id@deadline` key
  // sync_engine's fightTurnStart uses): in a SOLO fight (or any mob cascade resolved within a poll window)
  // control returns to the SAME player, so active_entity_id ALONE never changes — the old single-dep effect
  // then never fired, so the previous turn's move draft re-committed a move to my own (now-occupied) cell →
  // on-chain abort 104. The fresh deadline the chain stamps on every landing is the one signal that flips on a
  // same-player new turn.
  useEffect(() => {
    // a turn boundary rolls back any trap marker whose draft never committed (trap paint at cast).
    if (pending_trap_cells.current.size && fight?.fight_id) {
      // A (register hygiene): only reclaim cells NO LONGER live in the fold. A cell still present in
      // engine_view.my_traps at the boundary is a COMMITTED trap the flush already kept — the boundary net must not
      // target it. This closes the race window (the flush's own pending-clear runs AFTER the awaited commit, while
      // the commit receipt fires this effect); B (version-gated drop_traps) is the structural backstop regardless.
      const live = new Set(fight?.my_traps ?? [])
      const drop = [...pending_trap_cells.current].filter((cell) => !live.has(cell))
      if (drop.length) fight_store.getState().input({ type: 'drop_traps', cells: drop })
      pending_trap_cells.current.clear()
    }
    clear_picks()
  }, [fight?.active_entity_id, fight?.turn_deadline_ms])

  // FIX 4: a fresh Fight (a new room mints a new on-chain fight_id) means fresh on-chain cast history — clear the
  // lifted last_cast_turn record explicitly (the store outlives this component, so remount can no longer do it).
  // my_turn_no needs no reset here: it lives in the fight core and zeroes on the new Fight's session init.
  useEffect(() => {
    if (!fight?.fight_id) return
    reset_cast_clock()
  }, [fight?.fight_id])

  // D108/D109: entering placement with NO explicit pick, default the pick to the seeded cell so frame 1 READY is
  // enabled. A real pick supersedes it. [GAP] the pre-Ready visual pin (fight-intents.js's placement_intent mask,
  // showing my model standing on the picked cell before READY's place_at commits) has no core equivalent yet —
  // the board renders the chain cell until place_at lands; flagged, not fixed (fight/ core is read-only here).
  useEffect(() => {
    if (placement_pick != null || seeded_pick == null || !entity_id) return
    set_placement_pick(seeded_pick)
  }, [seeded_pick, placement_pick, entity_id])

  // FightControls only needs the presentation flag; reducer ticks receive the exact live queue length separately.
  const has_draft = move_path.length > 0 || cast_target != null

  // ── DeckCluster hand = the character's REAL on-chain spells (resolve_class_spells), name_keys only. The bar
  //    renders EXACTLY these (unlock_level ≤ char level) — no stub, no empty slot, no locked card; a class with
  //    no seeded spells shows weapon + move only. Each card's cast stages ITS SpellTemplate object id (above).
  //    Dispatched via the SAME action fight.js folds; sync/turn_start never touch `hand`, so it persists. ──
  const hand_spells = useMemo(() => my_spells.map((sp) => sp.name_key), [my_spells])
  const hand_synced = useRef('')
  useEffect(() => {
    if (!entity_id) return
    const sync_key = `${entity_id}:${hand_spells.join(',')}`
    if (hand_synced.current === sync_key) return
    fight_store.getState().input({ type: 'hand_update', hand: hand_spells })
    hand_synced.current = sync_key
  }, [entity_id, hand_spells])

  const draft_character = useRef(null)
  useEffect(() => {
    if (!entity_id || draft_character.current === entity_id) return
    draft_character.current = entity_id
    clear_picks()
  }, [entity_id])

  // NOTE: the SILENT per-room claim (D37c #33) + the ROOM_CLEARED→plane return now live in dungeon_store.js
  // (refresh → _claim_cleared_room + teardown), because on ROOM_CLEARED this board UNMOUNTS (fight_mode drops so
  // the player free-roams the plane). The reward recap slides in as a NON-GATING panel (RewardRecap.jsx).

  // TERMINAL auto-claim: fires on CLIENT-KNOWABLE, receipt-proven fight-over (`decided_winner`) so a lagged
  // settle can never dead-air a won fight (shape ②, seat ruling 2026-07-19). claim() opens the card PENDING and
  // its background chain settles + fills the rewards — receipt-gated, a17c9fc stands (the card never fabricates
  // reward content). The receipt-confirmed terminal (`settlement_request`) still fires it and is consumed for the
  // settle machine's dedupe; `decided_winner` covers the window where the kill folded but the settle read lags.
  useEffect(() => {
    const request = dungeon?.settlement_request
    const decided = dungeon?.decided_winner ?? null // 0 = client-knowable victory (committed: every mob dead)
    // D6: skip the terminal auto-claim if the local player is NO LONGER escrowed — they ABANDONED (abandon_
    // dungeon removed the participant + already fired its own defeat recap). Auto-claiming then aborts on-chain
    // (claim_room_rewards on an uncleared/unowned room) → the misleading "Claiming rewards failed" toast that
    // also blocked the hp=0 reconcile onto the defeat card. Only a genuine WON / wipe-FAILED (still escrowed)
    // has rewards to claim.
    const still_escrowed =
      !!entity_id && (dungeon?.escrow ?? []).some((p) => (p.character ?? p.character_id) === entity_id)
    if ((!request && decided == null) || !still_escrowed || busy) return
    // D132: claim() OWNS the terminal mint in its background chain (W1/D116). The old follow-up mint_loot()
    // here was the SECOND mint path — on a defeat it raced claim's own mint into "fail to mint reward"
    // toast duplication (no PendingLoot exists on a loss). One flow, one home: the call dies. claim()'s own
    // `_claiming` single-flight makes a repeat fire from this level-triggered gate a harmless no-op.
    void claim()
    if (request) fight_store.getState().input({ type: 'settlement_request_consumed', signal: request.signal })
  }, [dungeon?.settlement_request?.signal, dungeon?.decided_winner, busy])

  if (!dungeon || !fight) return null

  // END TURN = flush the current draft (move + cast); an EMPTY commit is a legal "end turn" on-chain (commit_turn
  // applies the batch AND advances the turn — dungeon_turn.move allows zero actions). Reads the LIVE draft.
  const on_end_turn = () => {
    const { move_path: mp, cast_path: cq } = staged_turn_paths(fight_store)
    flush_commit(mp, cq)
  }

  // LEAVE DUNGEON (the RUN door, dungeon::abandon): open the in-app confirm modal (never a native dialog). The
  // confirm handler runs the RUN abandon → the defeat end-card (dungeon_store.abandon → open_fight_recap) when
  // it catches a fight I was actually seated in, so a give-up is a SEEN defeat, not a silent dump. DISTINCT from
  // the FIGHT-forfeit door FightControls now owns itself (actions::abandon — dies in-fight, settles normally).
  const on_leave_dungeon = () => {
    if (busy) return
    set_leave_confirm(true)
  }
  const on_leave_dungeon_confirmed = async () => {
    set_leave_confirm(false)
    await abandon()
  }

  // D66 READY — commit the LOCAL placement pick with the ONE `place_at` tx (place + READY + auto-ACTIVE-when-all-
  // ready; solo flips instantly). The click was predict-only (no tx); this is the single confirmation. Guarded on
  // a live pick + not busy so a mis-fire before picking can't sign a bogus cell.
  const on_ready = () => {
    if (busy || effective_pick == null) return
    place_at_cell(effective_pick)
  }

  return (
    <>
      {/* ONE FightControls chrome for BOTH board phases (bottom-right, NOT nested in the transformed .dgb panel).
          FightControls itself switches by `fight.placement` (presence-truth): PLACEMENT → the big READY (fires the
          ONE place_at) + FORFEIT; ACTIVE → END TURN + FORFEIT. So the machine mounts it for is_placement OR
          is_active — the internal switch, not a second gate, decides which button shows (that was the D83-cascade
          fix: ONE canon card, never a double-button / a placement branch with no READY). The commit-urgency cue is
          ACTIVE-only. Machine-derived so it never renders over a half-init board (mount decision) and the READY
          shows the instant the slice is in placement even if `dungeon.status` still lags (D89 presence-truth).
          S-80: FORFEIT (FightControls' own default + confirm, actions::abandon) needs no props here anymore — it
          works identically for a dungeon room fight or a bare world fight (both drive `use_dungeon`). A LIVE
          RunPass gets a SECOND, separately-labeled "leave dungeon" control alongside it (the pre-S-80 RUN door,
          dungeon::abandon) so the two stay honest — see the leave-dungeon block right below. */}
      {(phase_is_placement(phase) || phase_is_active(phase)) && (
        <div className="hud-bottom">
          <FightControls
            placement={phase_is_placement(phase)} /* W4/D77 steer-2: the MACHINE's verdict drives READY↔END-TURN,
              not the raw fight.placement flag (which stayed stale-TRUE after the chain went ACTIVE) */
            on_end_turn={on_end_turn}
            on_ready={on_ready} /* THE ready — fires the ONE place_at(picked), never the dead WS sender */
            end_label={t('dungeons.end_turn')}
            ready_label={t('dungeons.ready')}
            waiting_label={t('dungeons.waiting')}
            placement_deadline_ms={dungeon.placement_deadline_ms} /* D110: REAL chain force-start deadline */
            placement_label={(n) => t('dungeons.placement_starts_in', { n })}
            turn_deadline_ms={dungeon.turn_deadline_ms}
            has_turn_draft={has_draft}
            auto_commit_label={(n) => t('dungeons.auto_pass_in', { n })}
            abandon_disabled={busy}
            ready_disabled={effective_pick == null || busy} /* D109: seeded cell is the default pick → enabled */
          />
          {/* S-80: the RUN door (dungeon::abandon) — a SEPARATE, distinctly-labeled exit alongside FightControls'
              own fight-forfeit. Only on a genuine dungeon run (run_pass_id set); a bare world fight has no run to
              leave. Same red/danger chrome as DungeonLeaveButton's plane-only twin (`.hud-fightctl__abandon`).
              Design ruling (2026-07-12): no separate "leave dungeon" button while in fight — the forfeit
              action ends the fight, which inherently leaves the dungeon. During the ACTIVE fight the FightControls
              FORFEIT (actions::abandon) IS the exit — it dies, settles, and lands the player in the lobby (verified:
              dungeon_store.abandon_fight → terminal claim → collapse-to-lobby), so this redundant no-death door is
              hidden there. It stays through PLACEMENT (pre-combat) as a graceful, non-death exit before the fight begins. */}
          {run_pass_id != null && !phase_is_active(phase) && (
            <div className="hud-fightctl">
              <button
                type="button"
                className="hud-fightctl__btn hud-fightctl__abandon"
                onClick={on_leave_dungeon}
                disabled={busy}
              >
                {t('dungeons.leave_cta')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ROOM_CLEARED renders NO panel here — this board unmounts on clear (fight_mode drops); the player free-
          roams the plane and clicks the next mob cluster to advance (dungeon_dimension engage → start_next_room),
          with the reward recap sliding in (RewardRecap.jsx). WON/FAILED keep the board mounted so the terminal
          auto-claim above fires the Victory/Defeat summary card (FightResult / FightSummary). */}

      {/* LEAVE DUNGEON confirm — the in-app modal (never a native window.confirm); confirming runs the RUN
          abandon (dungeon::abandon). Unchanged copy/keys from before S-80 — that door only ever consumed the
          RunPass, no HP/death write, so the confirm copy never claimed a death (fixed to say so honestly). */}
      <ConfirmDialog
        open={leave_confirm}
        title={t('dungeons.abandon_confirm_title')}
        message={t('dungeons.abandon_confirm')}
        confirm_label={t('dungeons.abandon')}
        cancel_label={t('dungeons.abandon_keep')}
        danger
        on_confirm={on_leave_dungeon_confirmed}
        on_cancel={() => set_leave_confirm(false)}
      />
    </>
  )
}
