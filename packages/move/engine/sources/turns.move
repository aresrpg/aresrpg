// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// TURNS — the placement phase, the §17.28 global-interleave queue build, and THE CRANK. Harvests
/// `dungeon_turn`'s committed-turn engine but REPLACES its HP-ranked queue with `interleave::order`. Turn
/// order is STRICT (single-PTB turn law): a player action requires `turn_ptr` to BE the
/// caller's seat — player actions are `&Random`-free, so a whole turn batches as ONE PTB ending in the pass
/// (the mob wave's single entropy draw, the tx's terminal `&Random` command). The permissionless `crank` is
/// the SOLE overdue-handler: past the deadline ANYONE forfeits the stalled turn and resolves forward — acting
/// while another turn is overdue aborts the DISTINCT `ESomeoneOverdue` (clients crank first, never blind-retry).
/// `resolve_from` walks the queue resolving consecutive mob turns + skipping the dead, landing `turn_ptr` on
/// the next living player (fresh deadline) — the turn holder is living AT TURN START; a self-kill (trap /
/// life-cost) leaves it dead-but-current until its own terminal pass or the deadline crank hands the queue
/// forward. Terminal detection is folded in: all mobs dead → VICTORY, all players dead → DEFEAT (results-v2:
/// settlement mints per-seat soulbound results, no epochs).
module aresrpg_fight::turns;

use aresrpg_foundation::{combat_grid, prng};

use aresrpg_fight::{
  cast,
  fight_events,
  fight::{Self, Fight},
  mob,
  movement,
  participant,
  statuses,
  tackle,
  version::Version
};
use aresrpg_fight::interleave;
use sui::{clock::Clock, random::{Self, Random, RandomGenerator}};

const ENotPlacement: u64 = 101; // place/force_start: fight is not in placement
const ENotYourCharacter: u64 = 102; // place: sender does not own the seat's character
const ENotParticipant: u64 = 103; // place: character not in this fight
const EBadStartCell: u64 = 104; // place: cell is not a valid near-side start cell (or occupied)
const ENotActive: u64 = 105; // crank/action: fight not ACTIVE
const ENotYourTurn: u64 = 106; // action: it is another (non-overdue) player's turn — wait for it
const ENotYetExpired: u64 = 107; // crank: the current turn's deadline has not passed
const ESomeoneOverdue: u64 = 108; // action: another player's turn is OVERDUE — crank first (the client auto-fires it)

/// PER-MOB TURN EXTENSION: a player's turn window = base `turn_ms` + this for EACH mob
/// turn that resolved since the previous PLAYER turn ended (coop included — a teammate's own turn is a fresh player
/// landing that resets the count). A crank/pass fast-forwards those mob turns inside ONE tx, so the client needs
/// wall-clock room to animate each ~3s mob turn (SPEC §7 E10) before the landing player's clock meaningfully runs.
/// PROVENANCE (rider): the design rule "45s + 3s per mob who played before him" OUTRANKS the reference game,
/// where 45s was the PLACEMENT timer and turns were 30s — the base 45s here is the `turn_ms` dial default.
const MOB_TURN_EXTRA_MS: u64 = 3_000;

// ╔════════════════ [ Placement ] ═══════════════════════════════════════════ ]

/// PLACEMENT: a player picks their seat's start cell + READIES in one call. Guards: PLACEMENT status, sender
/// owns the character, the cell is a valid near-side start cell not already taken by another living player. The
/// LAST ready auto-starts the fight. Terminal `&Random` (the auto-start resolves any leading mob turns).
entry fun place(fight: &mut Fight, character_id: ID, cell: u64, version: &Version, clock: &Clock, r: &Random, ctx: &mut TxContext) {
  let mut rng = prng::rng_seed(random::new_generator(r, ctx).generate_u64());
  place_internal(fight, character_id, cell, version, clock, &mut rng, ctx.sender());
}

fun place_internal(fight: &mut Fight, character_id: ID, cell: u64, version: &Version, clock: &Clock, rng: &mut u64, sender: address) {
  version.assert_enabled();
  assert!(fight::status(fight) == fight::status_placement(), ENotPlacement);
  let seat_opt = fight::seat_of(fight, character_id);
  assert!(seat_opt.is_some(), ENotParticipant);
  let seat = seat_opt.destroy_some();
  assert!(participant::owner(fight::participants(fight).borrow(seat)) == sender, ENotYourCharacter);
  // Placement side follows the seat's TEAM (S-13b): team 0 on the a-cells, team 1 (PvP) on the b-cells.
  let team = participant::team(fight::participants(fight).borrow(seat));
  let on_side = if (team == 0) fight::is_start_cell_a(fight, cell) else fight::is_start_cell_b(fight, cell);
  assert!(on_side && !start_cell_taken(fight, cell, seat), EBadStartCell);

  let fid = fight::id(fight);
  {
    let p = fight::participants_mut(fight).borrow_mut(seat);
    participant::set_cell(p, cell);
    participant::set_ready(p, true);
  };
  fight_events::emit_placed(fid, character_id, cell);
  fight_events::emit_ready(fid, character_id);
  begin_active_if_all_ready(fight, rng, clock.timestamp_ms());
}

/// Is `cell` already occupied by ANOTHER living participant (not `self_seat`)? (placement collision guard).
fun start_cell_taken(fight: &Fight, cell: u64, self_seat: u64): bool {
  let n = fight::participants(fight).length();
  let mut i = 0;
  while (i < n) {
    if (i != self_seat) {
      let p = fight::participants(fight).borrow(i);
      if (participant::is_alive(p) && participant::cell(p) == cell) return true;
    };
    i = i + 1;
  };
  false
}

/// The all-ready → ACTIVE transition: build the interleave queue (players side A in seat order, mobs side B in
/// spawn order), flip ACTIVE, resolve the leading slot. No-op unless still in placement with everyone ready.
fun begin_active_if_all_ready(fight: &mut Fight, rng: &mut u64, now: u64) {
  if (fight::status(fight) != fight::status_placement()) return;
  if (!all_ready(fight)) return;
  start_active(fight, rng, now);
}

fun start_active(fight: &mut Fight, rng: &mut u64, now: u64) {
  let np = fight::participants(fight).length();
  let mut side_a = vector[];
  let mut side_b = vector[];
  if (fight::mode(fight) == fight::mode_pvp()) {
    // PvP (S-13b): the interleave runs TEAM 0 vs TEAM 1 — every actor is a PLAYER actor (seat index), so the
    // resolve walk never fires a mob turn; §17.28's players-first tie law gives team 0 the opener.
    let mut i = 0;
    while (i < np) {
      let team = participant::team(fight::participants(fight).borrow(i));
      if (team == 0) side_a.push_back(interleave::new_player_actor(i))
      else side_b.push_back(interleave::new_player_actor(i));
      i = i + 1;
    };
  } else {
    let nm = fight::mobs(fight).length();
    let mut i = 0;
    while (i < np) { side_a.push_back(interleave::new_player_actor(i)); i = i + 1; };
    let mut j = 0;
    while (j < nm) { side_b.push_back(interleave::new_mob_actor(j)); j = j + 1; };
  };
  fight::set_queue(fight, interleave::order(side_a, side_b));
  fight::set_status(fight, fight::status_active());
  resolve_from(fight, 0, rng, now);
}

/// PERMISSIONLESS placement force-start once the placement window has expired (mirrors the crank philosophy):
/// mark every still-alive seat ready IN PLACE (they stand on their seeded cell) and run the all-ready → ACTIVE
/// transition. Terminal `&Random`.
entry fun force_start(fight: &mut Fight, version: &Version, clock: &Clock, r: &Random, ctx: &mut TxContext) {
  version.assert_enabled();
  assert!(fight::status(fight) == fight::status_placement(), ENotPlacement);
  assert!(clock.timestamp_ms() >= fight::placement_deadline_ms(fight), ENotYetExpired);
  mark_all_ready(fight);
  let mut rng = prng::rng_seed(random::new_generator(r, ctx).generate_u64());
  start_active(fight, &mut rng, clock.timestamp_ms());
}

// ╔════════════════ [ The crank + resolve engine ] ══════════════════════════ ]

/// PERMISSIONLESS crank of a STALLED fight — the SOLE overdue-handler (player actions never fast-forward
/// anyone): the current player's deadline has passed → forfeit their turn and resolve forward (mobs act, next
/// player lands). Anyone may call (never blocked on whose turn it is); it also backstops a self-killed
/// incremental player who walked away dead-but-current. Terminal `&Random` (mob turns draw entropy).
/// Rate-limited implicitly: after cranking, the next player gets a fresh deadline, so it cannot be spammed.
entry fun crank(fight: &mut Fight, version: &Version, clock: &Clock, r: &Random, ctx: &mut TxContext) {
  version.assert_enabled();
  assert!(fight::status(fight) == fight::status_active(), ENotActive);
  let now = clock.timestamp_ms();
  assert!(now >= fight::turn_deadline_ms(fight), ENotYetExpired);
  let mut rng = prng::rng_seed(random::new_generator(r, ctx).generate_u64());
  forfeit_current(fight);
  let next = fight::turn_ptr(fight) + 1;
  resolve_from(fight, next, &mut rng, now);
}

/// End the CURRENT player's turn: end-phase board work (end-glyphs, timed expiry + revert, glyph durations —
/// F-12) then the TurnEnded event. Used by pass/crank/fast-forward (mob turn-ends run inside their own resolve).
fun forfeit_current(fight: &mut Fight) {
  let a = fight::queue_actor(fight, fight::turn_ptr(fight));
  let is_mob = interleave::actor_is_mob(&a);
  let idx = interleave::actor_idx(&a);
  if (!is_mob) cast::tick_turn_end(fight, false, idx);
  fight_events::emit_turn_ended(fight::id(fight), is_mob, idx);
}

/// THE TURN GATE for every player action (single-PTB turn law): it must BE the caller's turn — player actions
/// never fast-forward anyone (that would draw mob entropy; the crank is the sole overdue-handler). A stalled
/// OTHER turn (deadline passed) aborts the DISTINCT `ESomeoneOverdue` so the client auto-fires `crank` and
/// retries once off a clean simulation; a live other turn aborts `ENotYourTurn` (wait). The caller's OWN
/// overdue turn still acts (grace until someone actually cranks it away).
public(package) fun assert_my_turn(fight: &Fight, caller_seat: u64, now: u64) {
  if (is_current_seat(fight, caller_seat)) return;
  assert!(now < fight::turn_deadline_ms(fight), ESomeoneOverdue);
  abort ENotYourTurn
}

/// End the caller's turn: resolve forward (mobs act, next player lands, or terminal). Called by the pass action
/// (the batch's terminal &Random command) and the active-abandon handoff. Tolerates a DEAD current seat — a
/// self-killed actor's own pass is exactly how its turn hands forward (single-PTB turn law).
public(package) fun end_turn(fight: &mut Fight, rng: &mut u64, now: u64) {
  forfeit_current(fight);
  let next = fight::turn_ptr(fight) + 1;
  resolve_from(fight, next, rng, now);
}

/// Is `seat` the player whose turn it currently is? The turn gate + the abandon door ask it. `turn_ptr` points
/// at a player that was living at TURN START (a mid-turn self-kill can leave it dead-but-current until the
/// pass/crank hands forward); the mob guard is defensive belt-and-braces.
public(package) fun is_current_seat(fight: &Fight, seat: u64): bool {
  let a = fight::queue_actor(fight, fight::turn_ptr(fight));
  !interleave::actor_is_mob(&a) && interleave::actor_idx(&a) == seat
}

/// Walk the queue from `start` (mod len), at most len steps: resolve each living mob's §17.21 turn, skip the
/// dead, and land `turn_ptr` on the first living player (fresh deadline + TurnStarted). Folds in terminal
/// detection: a mob turn that empties the players → DEFEAT; exhausting the queue with no living player but live
/// mobs → also DEFEAT; no living mobs → VICTORY. `public(package)` so actions can advance after an action ends
/// the turn.
public(package) fun resolve_from(fight: &mut Fight, start: u64, rng: &mut u64, now: u64) {
  let n = fight::queue_len(fight);
  if (n == 0) return;
  // (d) GAS DIET — the off-shape wall set is FIXED board geometry; build it ONCE (as a 6-word BITSET — gas-diet
  // #1) for the whole crank walk and thread it into every mob turn instead of re-scanning all ~380 cells per mob.
  // Dynamic bodies stay re-read per mob inside the builder, so mid-walk mob moves and participant/mob deaths remain correct.
  let off_shape = cast::off_shape_mask(fight);
  let mut pos = start % n;
  let mut steps = 0;
  // §7 turn-deadline throttle: count the mob turns that RESOLVE in this walk (a dead mob is skipped, never played) so
  // the landing player's deadline earns +MOB_TURN_EXTRA_MS each. Walk-local by construction → it resets at every
  // player landing (the walk returns on the first living player), so a coop teammate's turn starts the count fresh.
  let mut mobs_since_player = 0;
  while (steps < n) {
    let a = fight::queue_actor(fight, pos);
    if (interleave::actor_is_mob(&a)) {
      let midx = interleave::actor_idx(&a);
      if (mob::is_alive(fight::mobs(fight).borrow(midx))) {
        resolve_mob_turn(fight, midx, rng, &off_shape);
        mobs_since_player = mobs_since_player + 1;
        if (all_players_dead(fight)) { finish_defeat(fight); return };
        if (all_mobs_dead(fight)) { finish_victory(fight); return }; // a trap/DoT can fell the last mob mid-walk
      };
    } else {
      let seat = interleave::actor_idx(&a);
      if (participant::is_alive(fight::participants(fight).borrow(seat))) {
        // REFILL FIRST, board work second (MOB_DEBUFF_HAT P2 turns:213 — the mob-turn order, now side-symmetric):
        // begin_turn refills AP/MP to net(base − debt + credit) + resets the cast counter, THEN the start
        // glyph/DoT tick runs, so a start-glyph's give/remove-points lands on the REFILLED pools and survives
        // into the turn (the old tick-then-refill wiped them on players only). Refilling a seat the DoT then
        // kills is harmless — the walk moves on and the corpse's pools are never read.
        let (ap_debt, mp_debt, ap_credit, mp_credit) = cast::point_adjust(fight, false, seat);
        participant::begin_turn(fight::participants_mut(fight).borrow_mut(seat), ap_debt, mp_debt, ap_credit, mp_credit);
        if (cast::tick_turn_start(fight, false, seat)) {
          cast::note_seat_turn(fight, seat); // advance the caster's OWN turn clock (cast cooldown / per-turn reset anchor)
          // THE TURN'S ENTROPY, stamped at the one point a player turn begins: `rng` here is the state left
          // over once THIS transaction's `&Random` draw has been threaded through the wave, so every roll the
          // landing seat makes hangs off the beacon rather than off anything the previous turn's sender picked.
          fight::note_turn_entropy(fight, *rng);
          let deadline = now + fight::turn_ms(fight) + mobs_since_player * MOB_TURN_EXTRA_MS;
          fight::set_turn_ptr_and_deadline(fight, pos, deadline);
          let (entropy, ordinal) = fight::turn_entropy(fight);
          fight_events::emit_turn_started(fight::id(fight), false, seat, deadline, entropy, ordinal);
          return
        };
        // the start-tick killed the seat — a side may have wiped (PvP) or the party may be gone (PvM).
        if (pvp_terminal_check(fight)) return;
        if (fight::mode(fight) == fight::mode_pvm() && all_players_dead(fight)) { finish_defeat(fight); return };
      };
    };
    pos = (pos + 1) % n;
    steps = steps + 1;
  };
  // exhausted with no living player landed: decide the terminal state (PvP: one side or nobody stands).
  if (pvp_terminal_check(fight)) return;
  if (all_mobs_dead(fight)) finish_victory(fight) else finish_defeat(fight);
}

/// Resolve ONE mob's §17.21 turn: refill its AP/MP (F-13), tick its turn-start board work (F-12 — a DoT can
/// kill it before it acts), gather living player targets, decide (STOCHASTIC weighted policy — design ruling 2026-07-09;
/// the mob wave's ONLY entropy draw), MOVE (a trap on the path destination detonates), then cast the chosen
/// kit spell (deterministic), then its turn-end board work. No-op if no living target (the caller checks defeat).
fun resolve_mob_turn(fight: &mut Fight, midx: u64, rng: &mut u64, off_shape: &vector<u64>) {
  // Read the shared kit base (immutable) BEFORE the mut borrow of the mob — one home per group (mob-kit dedup).
  let base_ap = mob::kit_base_ap(fight::content_kit(fight::member_content(fight, midx)));
  let base_mp = mob::kit_base_mp(fight::content_kit(fight::member_content(fight, midx)));
  // refill to net(base − debt + credit) (MOB_DEBUFF_HAT P1 — a player's retrait actually
  // throttles the boss's next turn: AP debt → fewer casts, MP debt → less movement, exactly what the AI reads
  // below; an ALLY's give-points credit BOOSTS the same refill, so the boss-feed synergy is live).
  let (ap_debt, mp_debt, ap_credit, mp_credit) = cast::point_adjust(fight, true, midx);
  mob::begin_turn(fight::mobs_mut(fight).borrow_mut(midx), base_ap, base_mp, ap_debt, mp_debt, ap_credit, mp_credit);
  cast::note_mob_turn(fight, midx);
  if (!cast::tick_turn_start(fight, true, midx)) return; // died at turn start
  let (_seats, cells) = living_player_seats_and_cells(fight);
  // (d) memo: reuse the crank-wide off-shape scan; bodies (moved/dead this walk) are re-read inside the builder.
  let move_blocked = cast::move_blocked_cells_memo(fight, midx, off_shape);
  let move_budget = mob::mp(fight::mobs(fight).borrow(midx));
  // THE SEARCH WALK (#1061, seat ruling 2026-07-29) vs the §17.21 policy. Every opponent invisible ⇒ the visible
  // set is EMPTY and `decide_turn` may not be called at all (it asserts a non-empty target set — ENoLivingTargets),
  // so the caller supplies the goal: a blinded mob still MOVES, advancing toward `search_anchor` with the SAME
  // monotonic primitive the reposition fallback uses. No cast, no target — just repositioning pressure, which is
  // what invisibility is supposed to buy. Both arms produce the identical `(new_cell, spell_opt, target_cell)`
  // triple, so everything below (tackle, walk, MobMoved, turn-end) is ONE path for both.
  let (new_cell, spell_opt, target_cell) = if (cells.is_empty()) {
    let here = mob::cell(fight::mobs(fight).borrow(midx));
    let anchor = search_anchor(fight);
    if (anchor.is_some()) {
      let goal = anchor.destroy_some();
      (combat_grid::bfs_best_toward(here, goal, &move_blocked, move_budget), option::none(), goal)
    } else (here, option::none(), here) // degenerate board with no far pole: hold, exactly as before
  } else {
    // §17.21 support policy needs ally state: the OTHER living mobs' cells + how wounded each is (self-heal excluded).
    let (ally_cells, ally_missing) = living_ally_cells_and_missing(fight, midx);
    let los = cast::los_obstacles(fight);
    mob::decide_turn(fight::mobs(fight).borrow(midx), mob::kit_spells(fight::content_kit(fight::member_content(fight, midx))), &cells, &ally_cells, &ally_missing, &move_blocked, &los, rng)
  };
  // TACKLE (sim twin fight_actions.js:63-100, mob orientation): a mob leaving a living adjacent player's zone
  // contests the exit off the CRANK rng thread (the wave's entropy — like mob-cast drains; mob turns are never
  // previewable). Gated on an ACTUAL planned move so a standing mob draws nothing. A failed escape drains the
  // mob's pools + emits Tackled and TOLLS the walk (#239) — the mob advances only as far as its surviving MP
  // buys; its planned cast then re-validates from wherever it actually stopped (mob_can_cast), so an
  // out-of-band cast still dies with the escape.
  {
    let start_cell = mob::cell(fight::mobs(fight).borrow(midx));
    if (new_cell != start_cell) {
      let lockers = tackle::locker_agilities(fight, true, midx);
      if (!lockers.is_empty()) { tackle::resolve(fight, true, midx, &lockers, prng::draw(rng)); };
    };
  };
  {
    // TOLL, not wall (#239): the failed escape's drain already landed, and the mob advances as far as the MP it
    // has left allows — the same prefix rule the player's `actions::apply_move` walks.
    let surviving = mob::mp(fight::mobs(fight).borrow(midx));
    let (legal_move, moved_steps) = movement::walk(fight, true, midx, new_cell, &move_blocked, move_budget, surviving);
    assert!(legal_move);
    if (moved_steps > 0) {
      // Reposition observability (chain-forensics 2026-07-11): a mob whose turn draws reposition-only emitted NOTHING,
      // so no client/indexer could ever render the move. Fire MobMoved on any cell change (a move-SPELL turn ALSO
      // rides the Cast event's target_cell, so this is the sole home for the no-cast reposition case).
      // `movement::walk` already fired any crossed trap inline (entrant-blind) and resumed the mob's route.
      let landed = mob::cell(fight::mobs(fight).borrow(midx));
      fight_events::emit_mob_moved(fight::id(fight), midx, landed);
    };
  };
  if (mob::is_alive(fight::mobs(fight).borrow(midx))) {
    if (spell_opt.is_some()) {
      let spell_index = spell_opt.destroy_some();
      if (cast::mob_can_cast(fight, midx, spell_index, target_cell)) {
        cast::resolve_mob_cast(fight, midx, spell_index, target_cell, rng);
      };
    };
    cast::tick_turn_end(fight, true, midx);
  };
}

// ╔════════════════ [ Terminal transitions ] ═══════════════════════════════ ]

/// VICTORY: players cleared the group. Settlement (results::settle_and_destroy — permissionless) mints every
/// seat's FightResult from this terminal state. Emit Victory (aged bonus rides the event — the win card).
/// Stamps `winner_team = some(0)` — the PvM players' side (PvP terminals go through `finish_pvp`).
public(package) fun finish_victory(fight: &mut Fight) {
  fight::set_status(fight, fight::status_victory());
  fight::set_winner(fight, option::some(0));
  fight_events::emit_victory(fight::id(fight), fight::aged_bp(fight));
}

/// DEFEAT: no winning side (PvM loss; also the PvP mutual-wipe draw). `winner_team` stays none.
public(package) fun finish_defeat(fight: &mut Fight) {
  fight::set_status(fight, fight::status_defeat());
  fight::set_winner(fight, option::none());
  fight_events::emit_defeat(fight::id(fight));
}

/// PvP terminal (S-13b): `team` wiped the other side — stamp the winner (kolizeum's `winning_side` read) and
/// go VICTORY (results settle from any terminal; PvP results carry xp 0 + no loot — the door's mode owns that).
public(package) fun finish_pvp(fight: &mut Fight, team: u8) {
  fight::set_status(fight, fight::status_victory());
  fight::set_winner(fight, option::some(team));
  fight_events::emit_victory(fight::id(fight), 0);
}

#[test_only]
public fun finish_defeat_for_testing(fight: &mut Fight) { finish_defeat(fight); }

#[test_only]
public fun finish_victory_for_testing(fight: &mut Fight) { finish_victory(fight); }

/// PvP terminal DETECTION (S-13b): under MODE_PVP a fight ends when ≤1 team still has a living player —
/// one team standing → `finish_pvp(team)`; a mutual wipe → `finish_defeat` (the winner-none draw kolizeum
/// refunds). Returns true when the fight is (or just went) terminal. No-op false in PvM mode — the PvM sites
/// keep their existing all_mobs/all_players order untouched (mutual-wipe edge orders are behavior, not style).
/// PvP teams are 0/1 by the door contract (two-sided fights); any other id would be a door bug, not content.
public(package) fun pvp_terminal_check(fight: &mut Fight): bool {
  if (fight::mode(fight) != fight::mode_pvp()) return false;
  let st = fight::status(fight);
  if (st != fight::status_active()) return st == fight::status_victory() || st == fight::status_defeat();
  let n = fight::participants(fight).length();
  let (mut team0_lives, mut team1_lives) = (false, false);
  let mut i = 0;
  while (i < n) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p)) {
      if (participant::team(p) == 0) team0_lives = true else team1_lives = true;
    };
    i = i + 1;
  };
  if (team0_lives && team1_lives) return false;
  if (team0_lives) finish_pvp(fight, 0)
  else if (team1_lives) finish_pvp(fight, 1)
  else finish_defeat(fight);
  true
}

// ╔════════════════ [ Living-set reads ] ════════════════════════════════════ ]

public(package) fun all_players_dead(fight: &Fight): bool {
  let n = fight::participants(fight).length();
  let mut i = 0;
  while (i < n) { if (participant::is_alive(fight::participants(fight).borrow(i))) return false; i = i + 1; };
  true
}

public(package) fun all_mobs_dead(fight: &Fight): bool {
  let n = fight::mobs(fight).length();
  let mut i = 0;
  while (i < n) { if (mob::is_alive(fight::mobs(fight).borrow(i))) return false; i = i + 1; };
  true
}

/// THE SEARCH LANDMARK (#1061) — the single home of the goal a BLINDED mob walks toward when every opponent is
/// invisible: the mob side's SPAWN ANCHOR, `start_cells_b[0]` (the pole opposite the players' near-side start
/// zone — the mob falls back toward home ground). It is FIXED BOARD GEOMETRY, decided at fight creation, so the
/// walk consumes ZERO information about where the hidden players actually are — the sealed contract at
/// `living_player_seats_and_cells` (hidden positions never enter the AI input) holds BY CONSTRUCTION, not by
/// review. Stateless on purpose: nothing is remembered between turns, so the Fight struct is unchanged and no
/// upgrade carries new state. A mob already standing next to the anchor holds — `bfs_best_toward` never ends
/// farther from its goal, and the anchor's own cell is not a candidate (the stop-adjacent rule).
/// SIM TWIN: `packages/sim/src/fight_ai.js::search_anchor` — the acting side's first spawn cell, same rule.
fun search_anchor(fight: &Fight): Option<u64> {
  let anchors = fight::start_cells_b(fight);
  if (anchors.is_empty()) option::none() else option::some(*anchors.borrow(0))
}

/// Parallel (seat, cell) vectors of the living VISIBLE players. Hidden positions never enter the AI input.
fun living_player_seats_and_cells(fight: &Fight): (vector<u64>, vector<u64>) {
  let mut seats = vector[];
  let mut cells = vector[];
  let n = fight::participants(fight).length();
  let mut i = 0;
  while (i < n) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p) && !statuses::is_invisible(fight, false, i)) {
      seats.push_back(i);
      cells.push_back(participant::cell(p));
    };
    i = i + 1;
  };
  (seats, cells)
}

#[test_only]
/// Expose only the already-filtered AI cells so status tests can prove hidden coordinates never reach policy.
public fun visible_player_cells_for_testing(fight: &Fight): vector<u64> {
  let (_seats, cells) = living_player_seats_and_cells(fight);
  cells
}

#[test_only]
/// Drive one mob turn without constructing a queue/clock transaction; uses the exact production resolver.
public fun resolve_mob_turn_for_testing(fight: &mut Fight, midx: u64, rng: &mut u64) {
  let off_shape = cast::off_shape_mask(fight);
  resolve_mob_turn(fight, midx, rng, &off_shape);
}

/// Parallel (cell, missing_hp) vectors of the mob `self_idx`'s living ALLIES — every OTHER living mob (self
/// EXCLUDED: the §17.21 support policy heals allies, not itself). `missing_hp = max_hp − hp` (0 = full health) is
/// what the policy ranks to pick the most-wounded ally. Dead mobs are skipped (no revive-by-heal).
fun living_ally_cells_and_missing(fight: &Fight, self_idx: u64): (vector<u64>, vector<u64>) {
  let mut cells = vector[];
  let mut missing = vector[];
  let n = fight::mobs(fight).length();
  let mut i = 0;
  while (i < n) {
    if (i != self_idx) {
      let m = fight::mobs(fight).borrow(i);
      if (mob::is_alive(m)) { cells.push_back(mob::cell(m)); missing.push_back(mob::max_hp(m) - mob::hp(m)); };
    };
    i = i + 1;
  };
  (cells, missing)
}

fun all_ready(fight: &Fight): bool {
  let n = fight::participants(fight).length();
  let mut i = 0;
  while (i < n) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p) && !participant::is_ready(p)) return false;
    i = i + 1;
  };
  true
}

fun mark_all_ready(fight: &mut Fight) {
  let n = fight::participants(fight).length();
  let mut i = 0;
  while (i < n) { participant::set_ready(fight::participants_mut(fight).borrow_mut(i), true); i = i + 1; };
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun place_for_testing(fight: &mut Fight, character_id: ID, cell: u64, version: &Version, clock: &Clock, sender: address) {
  let mut rng = prng::rng_seed(42);
  place_internal(fight, character_id, cell, version, clock, &mut rng, sender);
}

#[test_only]
public fun crank_for_testing(fight: &mut Fight, now: u64) {
  let mut rng = prng::rng_seed(42);
  forfeit_current(fight);
  let next = fight::turn_ptr(fight) + 1;
  resolve_from(fight, next, &mut rng, now);
}
