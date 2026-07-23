// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ACTIONS — the player's in-turn actions: MOVE (AP-free MP economy, BFS reachability around bodies/blockers),
/// CAST (the resolver), WEAPON attack (§17.27, AP-priced, repeatable while AP lasts), and PASS (end turn).
/// SINGLE-PTB TURN LAW — a turn is a single PTB: MOVE/CAST/WEAPON are fully
/// DETERMINISTIC (crits derive from the public turn seed, damage is the authored base) and take NO `&Random`,
/// so a whole turn batches as ONE PTB — [act_move, act_weapon, …, act_pass] — with PASS as the tx's single
/// terminal `&Random` command (the mob wave's entropy). Every action requires it to BE the caller's turn
/// (`turns::assert_my_turn`); the permissionless `turns::crank` is the sole overdue-handler. MOVE/CAST/WEAPON
/// keep the player on their turn (AP/MP persist — multi-action turns, repeatable weapon) and require a LIVING
/// actor (a self-kill mid-batch reverts the batch's tail harmlessly); PASS advances the queue (mobs act, next
/// player lands) and tolerates a dead-but-current caller — a self-killed actor's own pass IS the handoff.
module aresrpg_fight::actions;

use aresrpg_fight::{cast, fight_events, fight::{Self, Fight}, movement, participant, tackle, turns, version::Version};
use aresrpg_foundation::prng;
use aresrpg_foundation::{combat_grid, spell_formula};
use aresrpg_spells::spell_template::SpellTemplate;
use sui::{clock::Clock, random::{Self, Random}};

const ENotActive: u64 = 101; // action while the fight is not ACTIVE
const ENotParticipant: u64 = 102; // character not in this fight
const ENotYourCharacter: u64 = 103; // sender does not own the acting character
const EIllegalMove: u64 = 104; // move target occupied / off-board / unreachable within MP
const EFightOver: u64 = 105; // abandon: the fight is already terminal (nothing left to abandon)
const EAlreadyDead: u64 = 106; // abandon: the seat is already dead (idempotence — no duplicate death)
const EActorDead: u64 = 107; // move/weapon/cast: the actor died mid-turn (self-kill) — only PASS may follow
const ETurnTooFast: u64 = 108; // pass: the turn ended before MIN_TURN_MS elapsed (instant-pass bot guard)

// A player's turn must last at least this long before its PASS commits — the contract-side anti-instant-bot floor
// (a minimum 3-second turn, enforced contract-side). Far below the
// turn TIMEOUT (config clamps turn_ms >= 5s), so the [MIN_TURN_MS, turn_ms] play window is always non-empty.
const MIN_TURN_MS: u64 = 3_000;

// ╔════════════════ [ MOVE ] ════════════════════════════════════════════════ ]

entry fun act_move(fight: &mut Fight, character_id: ID, cell: u64, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  let seat = begin_living_action(fight, character_id, version, clock.timestamp_ms(), ctx.sender());
  apply_move(fight, seat, cell);
}

fun apply_move(fight: &mut Fight, seat: u64, cell: u64) {
  assert!(combat_grid::in_grid(cell), EIllegalMove);
  assert!(!cast::cell_occupied(fight, cell), EIllegalMove);
  let (mp, cid) = { let p = fight::participants(fight).borrow(seat); (participant::mp(p), participant::character(p)) };
  let wall_mask = cast::move_blocked_cells(fight, false, seat); // 6-word wall BITSET (gas-diet #1)
  // TACKLE (sim twin fight_actions.js apply_move): leaving a living adjacent enemy's zone contests FIRST. The
  // roll is `&Random`-free (single-PTB law) — it derives from the public turn-seed stream folded with the action
  // slot + live MP (spell_formula::tackle_seed; previewable like a crit, repriced by every taxed move since a
  // failure always costs ≥1 MP). Path legality is pre-checked so an ILLEGAL move aborts instead of rolling —
  // sim order: insufficient-MP/invalid-path rejection precedes the contest.
  // THE TOLL, not a wall (ruling #239, the 1.29 convention): a failed escape COMMITS the pool tax (return-free —
  // an abort would refund the penalty) and then STILL WALKS — the move proceeds toward `cell` along the
  // affordable prefix with whatever MP survived the tax (walk_prefix); a tax that zeroes MP walks 0 honestly.
  let lockers = tackle::locker_agilities(fight, false, seat);
  let (cost, entered_trap) = if (!lockers.is_empty()) {
    let start = participant::cell(fight::participants(fight).borrow(seat));
    assert!(combat_grid::bfs_path_cost(start, cell, &wall_mask, mp) != combat_grid::path_unreachable(), EIllegalMove);
    let slot = participant::casts_this_turn(fight::participants(fight).borrow(seat));
    let seed = spell_formula::tackle_seed(fight::turn_seed(fight, seat), slot, mp);
    let (_state, draw) = prng::rng_next(seed);
    if (tackle::resolve(fight, false, seat, &lockers, draw)) {
      // ESCAPED — the full walk within the untaxed MP (validated reachable above).
      let (legal, c, trap) = movement::walk(fight, false, seat, cell, &wall_mask, mp);
      assert!(legal, EIllegalMove);
      (c, trap)
    } else {
      // TACKLED — the tax is written; the move walks the affordable prefix with the SURVIVING (post-tax) MP.
      let survived = participant::mp(fight::participants(fight).borrow(seat));
      movement::walk_prefix(fight, false, seat, cell, &wall_mask, mp, survived)
    }
  } else {
    let (legal, c, trap) = movement::walk(fight, false, seat, cell, &wall_mask, mp);
    assert!(legal, EIllegalMove);
    (c, trap)
  };
  {
    let p = fight::participants_mut(fight).borrow_mut(seat);
    participant::spend_mp(p, cost);
  };
  // Emit Moved only for an ACTUAL walk (a tax that zeroed MP walks 0 → Tackled alone tells the story, no Moved).
  if (cost > 0) {
    let landed = participant::cell(fight::participants(fight).borrow(seat));
    fight_events::emit_moved(fight::id(fight), cid, landed);
  };
  if (entered_trap) cast::trigger_on_enter(fight, false, seat);
}

// ╔════════════════ [ WEAPON attack (§17.27) ] ══════════════════════════════ ]

entry fun act_weapon(fight: &mut Fight, character_id: ID, target_cell: u64, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  let seat = begin_living_action(fight, character_id, version, clock.timestamp_ms(), ctx.sender());
  // Mode dispatch (advisor #4): in PvP the target is an enemy PLAYER — the mob-only strike would abort every
  // weapon attack exactly where money fights happen (§7/§12 weapon-build parity).
  if (fight::mode(fight) == fight::mode_pvp()) cast::weapon_strike_player(fight, seat, target_cell)
  else cast::weapon_strike(fight, seat, target_cell);
  victory_check(fight);
}

// ╔════════════════ [ CAST ] ════════════════════════════════════════════════ ]

entry fun act_cast(fight: &mut Fight, character_id: ID, spell: &SpellTemplate, target_cell: u64, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  let seat = begin_living_action(fight, character_id, version, clock.timestamp_ms(), ctx.sender());
  cast::resolve_player_cast(fight, seat, spell, target_cell);
  victory_check(fight);
}

// ╔════════════════ [ PASS (end turn — the batch's terminal `&Random` command) ] ═ ]

/// End my turn: the ONE `&Random` command of the single-PTB turn (the mob wave it resolves draws). Gated on it
/// being MY turn but NOT on being alive — a self-killed actor's own pass is exactly how its turn hands the
/// queue forward (its dead seat never ticks again; `resolve_from` skips corpses). TERMINAL-TOLERANT: the
/// batch's own killing blow may have ended the fight EARLIER IN THIS TX — the trailing pass then NO-OPS
/// (return, never abort: aborting would revert the player's own winning turn). A terminal fight has no turn
/// to end, so the no-op is exact, and it grants nothing (nothing is written).
entry fun act_pass(fight: &mut Fight, character_id: ID, version: &Version, clock: &Clock, r: &Random, ctx: &mut TxContext) {
  version.assert_enabled();
  if (fight::status(fight) != fight::status_active()) return; // ended mid-batch — moot, commit the kill
  let _seat = begin_action(fight, character_id, version, clock.timestamp_ms(), ctx.sender());
  assert_min_turn(fight, clock.timestamp_ms()); // instant-pass bot guard — player seats only (mobs never pass)
  let mut rng = prng::rng_seed(random::new_generator(r, ctx).generate_u64());
  turns::end_turn(fight, &mut rng, clock.timestamp_ms());
}

/// ANTI-BOT FLOOR — a PASS cannot commit until
/// MIN_TURN_MS past the turn's earliest HUMAN-actionable moment, which is what blocks instant-fight bots (the
/// contract-enforced 3s/turn minimum). A turn ALSO costs the client 3s to replay
/// EACH mob that landed it, so `resolve_from` stamps `deadline = start + turn_ms + 3s*N`
/// (N = mobs replayed) → `turn_deadline_ms − turn_ms = start + 3s*N` is exactly when a human can first act, and
/// the floor is that + MIN_TURN_MS, checked underflow-safe as `now + turn_ms >= deadline + MIN_TURN_MS`. The
/// per-mob WIDENING is the POINT, not a side effect: a flat 3s floor would gift a bot a 3s*N head start on every
/// post-mob turn (it commits while the human still watches the replay) — widening pins bot-time ≈ human-time.
/// The [floor, deadline] play window stays `turn_ms − MIN_TURN_MS` wide for EVERY N (the 3s*N cancels — 42s at
/// the 45s dial), so it is never empty. Lives in act_pass ALONE: the mob wave resolves inside
/// resolve_from (never a pass) and the overdue `crank` gates the far end (now >= deadline) — neither is throttled.
fun assert_min_turn(fight: &Fight, now: u64) {
  assert!(now + fight::turn_ms(fight) >= fight::turn_deadline_ms(fight) + MIN_TURN_MS, ETurnTooFast);
}

// ╔════════════════ [ ABANDON (quit = death — §7) ] ═══════════════════════ ]

/// ABANDON the fight — any fight can be abandoned; abandoning is considered a death. A
/// SEATED player (auth by sender, NOT gated on whose turn it is — that's the point) drops to 0 HP through the
/// normal damage write, and the fight folds forward exactly as any death does: a mid-turn abandoner hands the
/// queue on, a side/party wipe goes terminal and settles normally (the abandoner still gets its FightOutcome —
/// no escape, no loot-path change). Legal in PLACEMENT and ACTIVE; a terminal fight aborts. Terminal `&Random`
/// (an on-turn handoff resolves the interleaved mob turns that follow).
entry fun abandon(fight: &mut Fight, character_id: ID, version: &Version, clock: &Clock, r: &Random, ctx: &mut TxContext) {
  let seat = begin_abandon(fight, character_id, version, ctx.sender());
  if (fight::status(fight) == fight::status_placement()) {
    abandon_in_placement(fight, seat);
  } else {
    let mut rng = prng::rng_seed(random::new_generator(r, ctx).generate_u64());
    abandon_in_active(fight, seat, &mut rng, clock.timestamp_ms());
  };
}

/// Gate + resolve the abandoning seat: package enabled, the fight is still LIVE (placement or active — a terminal
/// fight has nothing to abandon), the sender owns the seat for `character_id`, and that seat is still alive
/// (re-abandoning a corpse is rejected so the event stream never doubles a death).
fun begin_abandon(fight: &Fight, character_id: ID, version: &Version, sender: address): u64 {
  version.assert_enabled();
  let st = fight::status(fight);
  assert!(st == fight::status_placement() || st == fight::status_active(), EFightOver);
  let seat_opt = fight::seat_of(fight, character_id);
  assert!(seat_opt.is_some(), ENotParticipant);
  let seat = seat_opt.destroy_some();
  let p = fight::participants(fight).borrow(seat);
  assert!(participant::owner(p) == sender, ENotYourCharacter);
  assert!(participant::is_alive(p), EAlreadyDead);
  seat
}

/// The death itself: the seat takes lethal damage (hp → 0 through the SAME `apply_damage` write a killing hit
/// uses — no parallel death path) and the Abandoned event announces it (its own event, never a doubled Hit).
/// The corpse's board rows purge here like every other kill path (MOB_DEBUFF_HAT P3 — a dead seat's rows could
/// never expire otherwise; the turn machine skips the dead, so its turn-end decrement never runs).
fun mark_abandoned(fight: &mut Fight, seat: u64) {
  let (cid, hp) = { let p = fight::participants(fight).borrow(seat); (participant::character(p), participant::hp(p)) };
  participant::apply_damage(fight::participants_mut(fight).borrow_mut(seat), hp);
  cast::purge_fighter_rows(fight, false, seat);
  fight_events::emit_abandoned(fight::id(fight), cid, seat);
}

/// ACTIVE abandon: kill the seat, then fold terminal + hand off the turn exactly as a mid-action death does. The
/// on-turn read is taken BEFORE the kill (which never moves `turn_ptr`). A lethal self-hit can wipe a PvP side —
/// that ends the fight for everyone whether on- or off-turn. If it does not, only the abandoner's OWN turn
/// advances the queue (`end_turn`'s `resolve_from` folds the PvM party wipe → DEFEAT); off-turn the current
/// player keeps its turn and the queue stays intact (a living turn-holder proves the PvM party is not wiped).
fun abandon_in_active(fight: &mut Fight, seat: u64, rng: &mut u64, now: u64) {
  let on_turn = turns::is_current_seat(fight, seat);
  mark_abandoned(fight, seat);
  if (turns::pvp_terminal_check(fight)) return;
  if (on_turn) turns::end_turn(fight, rng, now);
}

/// PLACEMENT abandon (no turns yet): mark the seat dead. If the abandoner's SIDE still holds a living seat the
/// fight simply waits in placement (the dead seat is skipped when the queue is built at start). If the abandon
/// EMPTIES the side, collapse NOW instead of stranding the fight until `force_start` (which does not handle a
/// dead PvP side): PvP hands the walkover to the surviving side (both sides gone = a give-up DEFEAT), PvM (the
/// players' side gone) is a DEFEAT. Settlement still mints every seat's outcome from the terminal state.
fun abandon_in_placement(fight: &mut Fight, seat: u64) {
  let team = participant::team(fight::participants(fight).borrow(seat));
  mark_abandoned(fight, seat);
  if (living_on_team(fight, team)) return;
  if (fight::mode(fight) == fight::mode_pvp()) {
    let other = if (team == 0) 1 else 0;
    if (living_on_team(fight, other)) turns::finish_pvp(fight, other) else turns::finish_defeat(fight)
  } else {
    turns::finish_defeat(fight)
  };
}

/// Any living seat on `team`? (the placement-collapse guard — a side with one live seat keeps the fight open).
fun living_on_team(fight: &Fight, team: u8): bool {
  let n = fight::participants(fight).length();
  let mut i = 0;
  while (i < n) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p) && participant::team(p) == team) return true;
    i = i + 1;
  };
  false
}

// ╔════════════════ [ Shared preamble + victory check ] ═════════════════════ ]

/// Gate (enabled + version + ACTIVE), resolve the caller's seat, verify the sender owns it, and require it to
/// BE the caller's turn (`turns::assert_my_turn` — a stalled other turn aborts the distinct ESomeoneOverdue so
/// the client cranks first; player actions never fast-forward anyone). Returns the seat.
fun begin_action(fight: &Fight, character_id: ID, version: &Version, now: u64, sender: address): u64 {
  version.assert_enabled();
  assert!(fight::status(fight) == fight::status_active(), ENotActive);
  let seat_opt = fight::seat_of(fight, character_id);
  assert!(seat_opt.is_some(), ENotParticipant);
  let seat = seat_opt.destroy_some();
  assert!(participant::owner(fight::participants(fight).borrow(seat)) == sender, ENotYourCharacter);
  turns::assert_my_turn(fight, seat, now);
  seat
}

/// `begin_action` + the actor must be ALIVE — the MOVE/WEAPON/CAST gate. A self-killed seat (trap, life-cost
/// cast) cannot keep acting: the batch's remaining actions abort here and the whole PTB reverts harmlessly
/// (nothing partially applied); only PASS (no alive gate) then hands the queue forward.
fun begin_living_action(fight: &Fight, character_id: ID, version: &Version, now: u64, sender: address): u64 {
  let seat = begin_action(fight, character_id, version, now, sender);
  assert!(participant::is_alive(fight::participants(fight).borrow(seat)), EActorDead);
  seat
}

/// After a damaging action: terminal detection by MODE. PvM — the group cleared → VICTORY. PvP — a side wipe
/// (all_mobs_dead is trivially TRUE in a mobless PvP fight, so it must never decide there — S-13b).
fun victory_check(fight: &mut Fight) {
  if (fight::status(fight) != fight::status_active()) return;
  if (turns::pvp_terminal_check(fight)) return;
  if (fight::mode(fight) == fight::mode_pvm() && turns::all_mobs_dead(fight)) turns::finish_victory(fight);
}

// (No post-action death handoff here — single-PTB turn law: a seat that DIED from its own action (trap,
// life-cost cast — F-12) stays dead-but-current; its own terminal PASS hands the queue forward (the batch
// always ends in one), and the deadline `turns::crank` backstops an incremental player who walked away.)

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun move_for_testing(fight: &mut Fight, character_id: ID, cell: u64, version: &Version, now: u64, sender: address) {
  let seat = begin_living_action(fight, character_id, version, now, sender);
  apply_move(fight, seat, cell);
}

#[test_only]
public fun weapon_for_testing(fight: &mut Fight, character_id: ID, target_cell: u64, version: &Version, now: u64, sender: address) {
  let seat = begin_living_action(fight, character_id, version, now, sender);
  cast::weapon_strike(fight, seat, target_cell);
  victory_check(fight);
}

#[test_only]
/// Drive `act_pass` deterministically (seeded rng, no `&Random`) — the same terminal-tolerance + gate +
/// end_turn the entry runs. DELIBERATELY OMITS the `assert_min_turn` gate so the 20+ timing-agnostic turn suites
/// keep passing at their fixed `now`; the min-turn gate itself is exercised through `pass_throttled_for_testing`.
public fun pass_for_testing(fight: &mut Fight, character_id: ID, version: &Version, now: u64, sender: address) {
  version.assert_enabled();
  if (fight::status(fight) != fight::status_active()) return; // ended mid-batch — moot (entry parity)
  let _seat = begin_action(fight, character_id, version, now, sender);
  let mut rng = prng::rng_seed(42);
  turns::end_turn(fight, &mut rng, now);
}

#[test_only]
/// `pass_for_testing` PLUS the real `act_pass` min-turn gate (`assert_min_turn`) — the min-turn suite drives both
/// the too-fast abort and the after-window success through this, deterministically (no `&Random`).
public fun pass_throttled_for_testing(fight: &mut Fight, character_id: ID, version: &Version, now: u64, sender: address) {
  version.assert_enabled();
  if (fight::status(fight) != fight::status_active()) return;
  let _seat = begin_action(fight, character_id, version, now, sender);
  assert_min_turn(fight, now);
  let mut rng = prng::rng_seed(42);
  turns::end_turn(fight, &mut rng, now);
}

#[test_only]
/// Drive `abandon` deterministically (seeded rng, no `&Random`) — the same phase branch the entry runs.
public fun abandon_for_testing(fight: &mut Fight, character_id: ID, version: &Version, now: u64, sender: address) {
  let seat = begin_abandon(fight, character_id, version, sender);
  if (fight::status(fight) == fight::status_placement()) {
    abandon_in_placement(fight, seat);
  } else {
    let mut rng = prng::rng_seed(42);
    abandon_in_active(fight, seat, &mut rng, now);
  };
}
