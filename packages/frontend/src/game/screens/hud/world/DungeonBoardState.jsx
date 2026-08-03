// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DungeonBoard's live store reads and derived movement/cast targeting state. Split out of
// DungeonBoard.jsx (issue #2069); the hook body is unchanged.
import { useMemo, useRef, useState } from 'react'
import { xp_progress } from '@aresrpg/sdk/experience'

import { use_game_state, use_fight_view } from '../../../store.js'
import { use_spell_corpus } from '../../../data/use_spell_corpus.js'
import { use_expedition, STATUS_ACTIVE as EXPEDITION_ACTIVE } from '../../../../roster/store'
import { seat_character } from '../../../../world-shell/seat_character.js'
import {
  cast_requires_occupant,
  fight_spell_template,
  resolve_class_spells,
  seat_spell_row,
} from '../fight-spells.js'
import { WEAPON_ATTACK_ID, WEAPON_ATTACK_RANGE, WEAPON_ATTACK_AP } from '../../../core/modules/fight.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { staged_turn_paths } from '@aresrpg/fight/txs'
import { fight_store } from '@aresrpg/fight/store'
import {
  committed_mob_hp,
  committed_truth,
  fight_view,
  mob_entity_id,
  mob_entity_index,
  next_move_tackle,
} from '@aresrpg/fight/project'
import {
  weapon_spell_template,
  evolve_caster_cell,
  evolve_draft_health,
} from '@aresrpg/fight/predict_cast'
import { range_bonus_of } from '@aresrpg/fight/statuses'
import { cast_range_set_dungeon } from '../../../../fight-engine/overlay_intents.js' // D139: cast_range_set_dungeon = THE cast-legality home (P1 self-cast)
import { character_cast_clock, use_dungeon_turn } from '../../dungeon-turn.js'
import { encode, decode, manhattan, lineOfSight, bfsReachable } from '@aresrpg/fight/los'
import { occupancy_of, visible_occupant_cells } from '@aresrpg/fight/occupancy'
import { dungeon_grid_of } from '../../dungeon-grid.js'
import { presentation_blocked_cells } from '../../../../world-shell/fight_board_blockers.js'
import { on_cooldown, cooldown_left, target_cap_reached, cap_of } from '@aresrpg/fight/draft_budget'
import { use_fight_phase } from './use_fight_phase.js'
import { is_placement as phase_is_placement } from '../../../../fight-engine/phase.js'

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

export const evolution_actions_of = (draft_actions, spells, weapon) =>
  (draft_actions ?? []).map((entry) => {
    if (entry.kind === 0) return { kind: 0, target: entry.target, landed: entry.landed }
    const is_weapon = entry.kind === 2 || entry.spell_key === WEAPON_ATTACK_ID
    const drafted = is_weapon ? null : (spells.find((spell) => spell.name_key === entry.spell_key) ?? null)
    return {
      kind: entry.kind,
      spell: is_weapon
        ? weapon_spell_template(weapon)
        : drafted?.object_id
          ? fight_spell_template(entry.spell_key)
          : null,
      target: entry.target,
    }
  })

/**
 * All unconditional DungeonBoard store reads and derived targeting state.
 */
export function use_dungeon_board_state() {
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
  const spell_corpus = use_spell_corpus()
  const controlled_character_id = fight?.my_entity_id ?? character_id

  // LEAVE-DUNGEON confirm modal (replaces the native window.confirm — standing house law: no OS dialogs). The
  // FIGHT-forfeit door's OWN confirm now lives inside FightControls itself (S-80) — this one is only the RUN door.
  const [leave_confirm, set_leave_confirm] = useState(false)
  // The single tx edge keeps the latest flush closure without re-subscribing on every render.
  const auto_submit_ref = useRef(null)
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
  // #1001: the WALLET's roster is not the only source. A seat the wallet does not own — the simulator's, whose
  // seeding door is guarded so a real session's roster is never clobbered — lives only in the fight's own
  // fighter book, and `seat_character` gives either shape the `experience` the level gate below reads. Without
  // it, any connected wallet owning chain characters armed this board at LEVEL 1 beside level-200 pools.
  const my_character = useMemo(
    () => seat_character(characters, fight?.fighters, controlled_character_id),
    [characters, fight?.fighters, controlled_character_id]
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
  const my_spells = useMemo(() => resolve_class_spells(my_class, my_level), [my_class, my_level, spell_corpus])

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
  const active_fighter = fight?.fighters.get(entity_id) ?? null
  // PRESENTATION GATE (regression: a player could act while mobs were still animating their turns): the
  // mob-wave crank hands active_entity_id back to me the instant the paced replay STARTS, so a chain-only
  // my_turn read would re-arm End Turn + the hotbar mid-cascade. `fight.presenting` (set by voxel_fight_adapter
  // while the mob beats drain) holds the RE-ARM until the turn is PLAYABLE — chain truth ⋀ presentation done.
  const my_turn = !!fight && fight.active_entity_id === entity_id && fight.winner === -1 && !fight.presenting

  // THE SEAT'S RANK (#1077) — a spell's range, AP cost, cooldown, per-turn caps and effects are all PER-LEVEL
  // facts, and the level this seat casts at rides its escrow row's composed build (`spell_levels`). `level_row`
  // is the ONE reader every gate below goes through, so the click gate, the wash and the prediction can never
  // describe different ranks of the same spell; `active_level` is the armed (or primary) spell's own row.
  const level_row = (spell) => seat_spell_row(me, spell)
  const active_level = useMemo(() => seat_spell_row(me, active_spell), [me, active_spell])

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
    const range = active_level?.range
    return {
      range_min: range?.[0] ?? CAST_RANGE_MIN_DEFAULT,
      range_max: range?.[1] ?? CAST_RANGE_MAX_DEFAULT,
      ap_cost: active_level?.ap ?? CAST_AP_COST_DEFAULT,
    }
  }, [active_level, fight?.armed_spell_id, me?.weapon])
  // Every hook ABOVE this line runs unconditionally (Rules of Hooks) — the early return is below the last one.
  const obstacles = dungeon?.obstacles ?? []
  // The ENGINE refills AP/MP to base at begin_turn ON-CHAIN (turns.move) and persists it, so the escrow ap/mp
  // read every poll IS the live turn budget the instant it's my turn — no stale pre-refill leftover, no hardcoded
  // 6/3 mirror that mis-gated a char whose base_ap/base_mp differ (an over-budget draft the chain then rejected
  // with abort 104). `me.ap/mp` are the PRESENTED ordered-prefix values: every draft cost/grant/forfeit has already
  // folded exactly once. The committed values below are only the reconnect fallback when that projection is absent;
  // subtracting the legacy move/cast ledgers again would double-charge the same draft.
  const my_ap = me?.committed?.ap ?? 0
  const my_mp = me?.committed?.mp ?? 0
  const my_pending_mp = me?.committed?.pending_mp ?? 0

  // The presented MP is the exact ordered draft prefix: earlier moves/tackle forfeits are spent and any cast grant
  // already drafted before the NEXT move is live (the claimed mid-turn grants ride the presented pool via
  // budget_claims — the ordered fold and the claims machinery converge here). The committed pool remains the
  // reconnect fallback.
  const my_mp_eff = Math.max(0, me?.mp ?? my_mp)

  // ── CLIENT AP BUDGET (SPEC §17.27; regression: unlimited weapon-strike spam) — the chain lets a
  //    turn repeat weapon strikes / spells ONLY while AP lasts (each costs its own ap_cost; spells add a
  //    casts_per_turn cap, but every seeded spell today is 255 = UNLIMITED, so AP is the sole live limiter). The
  //    client mirrors it: each QUEUED cast/weapon decrements a client-side remaining-AP seeded from the escrow
  //    me.ap, and `castable` goes EMPTY (greyed sockets) once the budget can't afford another — so the optimistic
  //    beat can NEVER play for an unaffordable action, and the excess phantom beats that read as "mobs regaining
  //    health" (uncommitted casts folding back) are gone: every beat is now 1:1 with a committable action. ──
  const CASTS_UNLIMITED = 255 // spell_bands::CASTS_UNLIMITED — a 255/0 cap means no per-turn limit
  // Like MP, presented AP has already folded every earlier cast and deterministic tackle forfeit in draft order.
  const remaining_ap = Math.max(0, me?.ap ?? my_ap)
  // casts_per_turn gate for the ARMED spell (the weapon has none). Count how many of it are already queued; at the
  // cap no more are castable. cpt_cap === Infinity for a weapon or any unlimited (255/0) spell — AP alone limits.
  const armed_id = fight?.armed_spell_id ?? null
  const cpt = armed_id === WEAPON_ATTACK_ID ? Infinity : (active_level?.casts_per_turn ?? CASTS_UNLIMITED)
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
  const armed_cooldown = armed_id === WEAPON_ATTACK_ID ? 0 : (active_level?.cooldown ?? 0)
  const armed_on_cd = on_cooldown(last_cast_turn[armed_key], my_turn_no, armed_cooldown)
  const armed_cd_left = cooldown_left(last_cast_turn[armed_key], my_turn_no, armed_cooldown)
  const cpt_cap_eff = armed_cooldown > 0 ? 1 : cpt_cap
  // The AUTHORED per-target cap rides raw so every read goes through the ONE verdict (`target_cap_reached`);
  // `cpt_target_cap` stays the resolved number the footprint loop tests for the unlimited short-circuit.
  const cpt_target_authored = armed_id === WEAPON_ATTACK_ID ? Infinity : active_level?.casts_per_target
  const cpt_target_cap = cap_of(cpt_target_authored)

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
    // LIVING-WINS (#1214/#1232): a corpse keeps its on-chain cell but never body-blocks, so a live occupant may
    // legally share it. This candidate set must resolve the SAME living occupant `find_living_mob_at` /
    // `find_entity_at` do (cast.move / fight_state.js) — `occupancy_of` is the ONE index that enforces it,
    // shared with prediction's own pre-fire snapshot (predict_cast `evolve_flush_casts`), so the board and the
    // prediction can never disagree about who holds a stacked cell.
    return occupancy_of([
      ...(dungeon?.escrow ?? []).map((p, i) => ({
        cell: p.cell,
        kind: 'player',
        alive: p.committed?.alive ?? p.alive,
        idx: i,
      })),
      ...(dungeon?.mobs ?? []).map((m, i) => ({
        cell: m.cell,
        kind: 'mob',
        alive: m.committed?.alive ?? m.alive,
        idx: i,
      })),
    ])
  }, [dungeon])

  // ONE home for entity_id → { is_mob, idx } (dungeon escrow is the source): the move-cost anchor evolution, the
  // optimistic cast, AND the flush's ⑭ evolved-sequence validation all resolve fighter refs the same way — a
  // player rides its character id, a mob rides 'mob-N'. Guards a null dungeon (pre-fight) so callers never throw.
  // Declared ABOVE every reader: `optimistic_vacated`'s memo factory runs SYNCHRONOUSLY at mount, so a `const`
  // sitting below it is still in the temporal dead zone when that factory reads it — the whole HUD fell into the
  // error boundary for every seated fighter (#1563). Its only closure is `dungeon`, so this is its earliest home.
  const resolve_ref = (fighter_id) => {
    const mob_idx = mob_entity_index(fighter_id)
    if (mob_idx != null) return { is_mob: true, idx: mob_idx }
    const idx =
      dungeon?.escrow?.findIndex((row) => String(row.character ?? row.character_id) === String(fighter_id)) ?? -1
    return idx < 0 ? null : { is_mob: false, idx }
  }

  // PATHFINDING (retro-exact): the move-range set is the 4-connected BFS reach around the
  // SAME blocked set the contract charges — obstacles ∪ holes ∪ out-of-bounds (room shape) ∪ every OTHER living
  // fighter (body-blocking) — via the fight-los twin of combat_grid::bfs_path_cost. So the range wash, the
  // click-gate, and the committed MP agree cell-for-cell (dungeon_turn.move apply_move → bfs_path_cost over
  // dungeon::move_blocked_cells). The grid (obstacles/holes/dims) is recomputed from the dungeon id + room index
  // (dungeon_blocked_cells → generateGrid), the identical seed regenerate_room_grid uses on-chain.
  // OPTIMISTIC VACATED CELL: every cast already in the current draft prefix resolves before the NEXT move, so a mob
  // those casts kill is guaranteed absent when that move remasks living blockers. This is prefix-local: it never
  // reaches forward to a cast that has not been drafted yet.
  const optimistic_vacated = useMemo(() => {
    const vacated = new Set()
    if (!dungeon || !entity_id) return vacated
    // #1480 — the draft's kills come from the SAME prediction that draws the damage, never from a sum of
    // AUTHORED spell bases: that sum never saw the caster, so a +110% damage buff (or a resistance, or a
    // shield) left this forecasting the unbuffed number and a cell the turn really clears stayed blocked.
    const predicted = evolve_draft_health({
      view: fight_view(),
      committed: committed_truth(fight_store.getState()),
      caster_id: entity_id,
      actions: evolution_actions_of(staged_turn_paths(fight_store).draft_actions, my_spells, me?.weapon),
      resolve_ref,
    })
    for (const [idx, m] of dungeon.mobs.entries()) {
      const committed_hp = committed_mob_hp(fight_store.getState(), idx)
      if (!(committed_hp > 0)) continue
      // this turn's casts already kill it → its cell opens for the move
      if ((predicted.get(mob_entity_id(idx)) ?? committed_hp) <= 0) vacated.add(m.cell)
    }
    return vacated
  }, [cast_path, dungeon, entity_id, my_spells, me?.weapon])

  // #300/#398 NEXT-ACTION ANCHOR — evolve committed truth through the canonical staged prefix. Ordinary moves,
  // denied tackles (`landed:false`), and caster-relocating casts all participate, so both the next move and next
  // cast read the exact cell the ordered PTB will expose at that slot.
  const draft_caster_cell = useMemo(() => {
    const committed_cell = me?.committed?.cell ?? me?.cell ?? null
    if (committed_cell == null || !entity_id || !fight?.draft_count) return committed_cell
    const evolved = evolve_caster_cell({
      view: fight_view(),
      committed: committed_truth(fight_store.getState()),
      caster_id: entity_id,
      actions: evolution_actions_of(staged_turn_paths(fight_store).draft_actions, my_spells, me?.weapon),
      resolve_ref,
    })
    return evolved ?? committed_cell
  }, [me?.committed?.cell, me?.cell, fight?.draft_count, entity_id, my_spells, me?.weapon, dungeon])

  const reachable = useMemo(() => {
    // MP-ZONE MISCLICK GUARD: when the vfx/sequence of a spell is played, the MP zone stays hidden
    // so a misclick can't move the character — MY OWN cast/weapon VFX still presenting empties the move-click
    // affordance, the SAME fact (engine_view's cast_presenting, project.js) the paint's move_wash wash suppresses
    // on; never a second UI-side flag. Narrower than `fight.presenting` (nonlocal-only — a mob/peer replay; my
    // own WALK beats never trip this, so the D254 cumulative-move chaining stays fluid while a walk animates).
    if (!me || !my_turn || !dungeon || fight?.cast_presenting || draft_caster_cell == null) return new Set()
    const blocked = presentation_blocked_cells(dungeon, fight?.fighters, entity_id, optimistic_vacated)
    // #1743 ONE HOME: the click affordance prices the SAME tackle toll the paint does. `my_mp_eff` is the raw
    // pool; a bitten move pays `mp_lost` before a single cell is entered (#239), so budgeting the walk with the
    // raw pool offered cells the chain would never land on — the reported "moved while tackled, then it all
    // rolled back". `next_move_tackle` is the ONE contest home; nothing here re-derives the roll.
    const move_bite = next_move_tackle(fight_store.getState())
    const tolled_mp = Math.max(0, my_mp_eff - (move_bite?.mp_lost ?? 0))
    return new Set(bfsReachable(draft_caster_cell, tolled_mp, blocked))
  }, [
    me,
    my_turn,
    my_mp_eff,
    dungeon,
    entity_id,
    draft_caster_cell,
    optimistic_vacated,
    fight?.fighters,
    fight?.cast_presenting,
    // the tackle roll folds the action SLOT (casts_this_turn), so a drafted cast reprices the toll
    fight?.draft_count,
  ])

  // OPTIMISTIC CASTER CELL (FIGHT-WAVE-2 root cause): a cast AFTER a move did NOTHING. `castable` computed
  // range/LOS from `me.cell` — the CHAIN baseline (pre-move) — so a mob only reachable from the drafted post-move
  // cell fell OUT of the set → on_cell_click missed the cast branch → the mob cell (a living actor) also failed
  // `reachable` → a SILENT no-op (no error, no float). Anchor the cast at the drafted post-move cell instead: it
  // is the EXACT cell the contract validates the cast from, since commit_turn applies MOVE→CAST in array order
  // (dungeon_turn.move commit_turn_core). No move drafted → the chain cell.
  const caster_cell = draft_caster_cell
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
      const lvl = active_level
      // 1.29 TRAP-STACKING BAN: a trap-PLACING spell may not target a cell already anchoring
      // MY live trap — the chain aborts it (cast::ECellAlreadyTrapped), so the gate greys it here from the fold's
      // engine_view.my_traps (the ONE client trap home — the sim door reads the SAME projection, so legality and
      // prediction never diverge; an ENEMY's invisible trap stays unknowable and surfaces as the honest abort toast).
      const my_trap_cells =
        (lvl?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP') && fight?.fight_id ? fight.my_traps : undefined
      const footprint = cast_range_set_dungeon(
        [cast_params.range_min, cast_params.range_max],
        { ...active_fighter, cell: decode(caster_cell) },
        dungeon_grid_of(dungeon),
        los_blockers,
        {
          los: lvl?.line_of_sight !== false,
          linear: lvl?.linear === true,
          modifiable_range: lvl?.modifiable_range === true,
          trap_cells: my_trap_cells,
          // #1741 — a zero-area single-target DAMAGE spell may only aim where something VISIBLE stands (the 1.29
          // rule, free_cell's withhold inverted). The occupancy read is the PROJECTION's (visible_occupant_cells:
          // living, non-invisible), never chain truth — refusing a cast on a secretly-held cell would reveal the
          // invisible entity, so an invisibly-held cell is withheld exactly like an empty one.
          occupant_cells: cast_requires_occupant(lvl) ? visible_occupant_cells(fight?.fighters) : null,
        }
      )
      // #1210: a cell THIS turn's drafted casts already vacate (`optimistic_vacated`, fed to the move masks two
      // screens above) must free the SAME trap footprint — one occupancy home, no second candidate-set home (that
      // asymmetry was the bug: a fresh corpse blocked trap placement in the preview only, #1070's class).
      if (lvl?.free_cell === true)
        for (const c of [...footprint])
          if (occupied.get(c)?.alive && !optimistic_vacated.has(c)) footprint.delete(c)
      // FIX 4 casts_per_target: a cell already at its per-target cap this turn drops out (chain aborts ECastsPerTarget).
      if (cpt_target_cap !== Infinity)
        for (const c of [...footprint])
          if (target_cap_reached(cast_path, armed_key, c, cpt_target_authored)) footprint.delete(c)
      return footprint
    }
    const out = new Set()
    const effective_range_max =
      cast_params.range_max +
      (fight?.armed_spell_id !== WEAPON_ATTACK_ID && active_level?.modifiable_range
        ? range_bonus_of(active_fighter)
        : 0)
    for (const [cell, o] of occupied) {
      if (o.kind !== 'mob' || !o.alive) continue
      const d = manhattan(caster_cell, cell)
      if (d < cast_params.range_min || d > effective_range_max) continue
      if (!lineOfSight(caster_cell, cell, los_blockers)) continue
      if (target_cap_reached(cast_path, armed_key, cell, cpt_target_authored)) continue // FIX 4 casts_per_target (per cell/turn)
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
    cpt_target_authored,
    armed_key,
    cast_path,
    occupied,
    optimistic_vacated,
    obstacles,
    caster_cell,
    cast_params,
    fight?.armed_spell_id,
    active_spell,
    active_level,
    active_fighter,
    dungeon,
    fight?.fighters,
  ])
  return {
    phase,
    dungeon,
    busy,
    commit_turn,
    claim,
    abandon,
    run_pass_id,
    fight,
    leave_confirm,
    set_leave_confirm,
    auto_submit_ref,
    my_turn_no,
    record_cast_turns,
    reset_cast_clock,
    move_path,
    cast_path,
    cast_target,
    append_move_step,
    append_cast_step,
    clear_picks,
    clicked_cell,
    clicked_cast,
    clicked_seq,
    placement_pick,
    set_placement_pick,
    place_at_cell,
    my_spells,
    active_spell,
    entity_id,
    me,
    active_fighter,
    my_turn,
    level_row,
    cast_params,
    my_mp_eff,
    remaining_ap,
    armed_key,
    armed_on_cd,
    armed_cd_left,
    cpt_target_authored,
    seeded_pick,
    effective_pick,
    occupied,
    obstacles,
    resolve_ref,
    optimistic_vacated,
    draft_caster_cell,
    reachable,
    castable,
  }
}
