/// COMBAT-INTEGRITY suite — the two exploit closures riding the engine upgrade:
///   1. MIN-TURN gate — `act_pass` refuses to end a turn faster than MIN_TURN_MS (instant-pass bot floor); the
///      mob wave + the permissionless `crank` stay unthrottled (they never route through a pass).
///   2. CAST LIMITS — `resolve_player_cast` enforces the spell level's authored cooldown / casts_per_turn /
///      casts_per_target (previously display-only), tracked as per-caster dynamic fields on the Fight UID, clocked
///      by the caster's OWN turn counter (`cast::note_seat_turn`, bumped at each player turn-start).
/// Cast tests drive `resolve_player_cast` directly on a placement-phase fight (the cast resolver checks no status —
/// the entry's `begin_action` owns that) and control the caster turn clock with `cast::note_seat_turn`, exactly
/// how `turns::resolve_from` does live. Trap (free-cell) spells keep targets occupancy/LOS/kill-free.
#[test_only]
module aresrpg_fight::combat_integrity_tests;

use aresrpg_fight::{actions, cast, fight::{Self, Fight}, interleave, mob, participant, turns, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, create_fight, create_fight_group, mk_clock, stand_up};
use aresrpg_foundation::spell_effect;
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const COOP: address = @0xC1; // the second (coop) player's character-id source for the turn-deadline rows

// Abort codes mirrored for expected_failure (module-private error consts aren't visible cross-module).
const CAST_ECastsPerTurn: u64 = 103;
const CAST_ESpellOnCooldown: u64 = 105;
const CAST_ECastsPerTarget: u64 = 106;
const CAST_ECellAlreadyTrapped: u64 = 107;
const A_ETurnTooFast: u64 = 108;

// ╔════════════════ [ Spell + fight fixtures ] ══════════════════════════════ ]

/// A free-cell trap level carrying the authored limits under test. ap_cost 1 (base_ap 6 ⇒ up to 6 casts/turn, so
/// AP never masks a limit abort), range [1,4], no LOS, free-cell target — band-legal at (B,P)=(40,5).
fun trap_level(min_cl: u16, cpt: u8, cpta: u8, cd: u8): spell_effect::SpellLevel {
  spell_effect::new_spell_level(
    min_cl, 1, 1, 4, false, false, false, true, cpt, cpta, cd, 0, false, vector[], vector[],
    vector[spell_effect::place_trap(spell_effect::shape_circle(), 1)],
    vector[],
  )
}

/// Mint + share ONE senshi trap SpellTemplate whose six levels all carry (cpt, cpta, cd) — casts resolve at
/// level 1 (the free unlock), so the level-1 limits are what the resolver reads.
fun mint_trap_spell(sc: &mut Scenario, cpt: u8, cpta: u8, cd: u8) {
  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let sver = sc.take_shared<aresrpg_spells::version::Version>();
  let mut sreg = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[
    trap_level(1, cpt, cpta, cd), trap_level(1, cpt, cpta, cd), trap_level(1, cpt, cpta, cd),
    trap_level(1, cpt, cpta, cd), trap_level(1, cpt, cpta, cd), trap_level(101, cpt, cpta, cd),
  ];
  aresrpg_spells::spell_template::mint_spell(&cap, &mut sreg, b"senshi".to_string(), 1, b"Limit Spell".to_string(), levels, 40, 5, &sver, sc.ctx());
  ts::return_shared(sreg);
  ts::return_shared(sver);
  sc.return_to_sender(cap);
}

/// Stand up a placement fight seating senshi CHAR + one far-parked mob, mint the limited trap spell, and hand back
/// the shared Fight + SpellTemplate. Caster at cell 100; trap targets 101..104 stay free (mob at 300).
fun setup_cast(sc: &mut Scenario, cpt: u8, cpta: u8, cd: u8): (Fight, aresrpg_spells::spell_template::SpellTemplate) {
  stand_up(sc);
  create_fight(sc, 500, 1, 0, 1000, true, option::none());
  mint_trap_spell(sc, cpt, cpta, cd);
  sc.next_tx(OWNER);
  let spell = sc.take_shared<aresrpg_spells::spell_template::SpellTemplate>();
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 300);
  (fight, spell)
}

/// Simulate a turn-start for seat 0: bump its OWN turn clock (as `turns::resolve_from` does) + refill AP/MP.
fun begin_cast_turn(fight: &mut Fight) {
  cast::note_seat_turn(fight, 0);
  participant::begin_turn(fight::participants_mut(fight).borrow_mut(0), 0, 0, 0, 0);
}

/// DETONATE the live trap at `cell` exactly the way the chain does: park the mob on it, run the on-enter
/// trigger (the fixture's trap payload is EMPTY — its only effect IS the placement — so nothing lands on the
/// mob), then park it back out of every cast range. Frees the anchor for the 1.29 no-stack re-cast tests and
/// lets the SAME-cell limit tests keep their same-cell semantics under the trap-stacking ban.
fun detonate_trap_at(fight: &mut Fight, cell: u64) {
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(0), cell);
  cast::trigger_on_enter(fight, true, 0);
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(0), 300);
}

// ╔════════════════ [ Cooldown ] ════════════════════════════════════════════ ]

#[test, expected_failure(abort_code = CAST_ESpellOnCooldown, location = aresrpg_fight::cast)]
fun cast_within_cooldown_aborts() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 255, 255, 2); // cooldown 2, casts unlimited
  begin_cast_turn(&mut fight); // caster turn 1
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // records last cast @ turn 1
  begin_cast_turn(&mut fight); // caster turn 2
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // 2 − 1 = 1 !> 2 → on cooldown
  abort 0
}

#[test]
fun cast_after_cooldown_succeeds() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 255, 255, 2); // cooldown 2
  begin_cast_turn(&mut fight); // turn 1
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // last cast @ turn 1 (DF written)
  begin_cast_turn(&mut fight); // turn 2
  begin_cast_turn(&mut fight); // turn 3
  begin_cast_turn(&mut fight); // turn 4 — DF record from turn 1 survived every bump
  cast::resolve_player_cast(&mut fight, 0, &spell, 102); // 4 − 1 = 3 > 2 → castable again (fresh cell: 101 still traps)
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 5); // refilled to 6, spent 1
  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

// ╔════════════════ [ casts_per_turn ] ══════════════════════════════════════ ]

#[test, expected_failure(abort_code = CAST_ECastsPerTurn, location = aresrpg_fight::cast)]
fun casts_per_turn_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 1, 255, 0); // casts_per_turn 1
  begin_cast_turn(&mut fight); // turn 1
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // 1st cast (0 < 1)
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // 2nd SAME turn: 1 !< 1 → over cap
  abort 0
}

#[test]
fun casts_per_turn_resets_next_turn() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 1, 255, 0); // casts_per_turn 1
  begin_cast_turn(&mut fight); // turn 1
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // turn-1 cast
  begin_cast_turn(&mut fight); // turn 2 — the per-turn counter lazily resets on the new turn
  cast::resolve_player_cast(&mut fight, 0, &spell, 102); // turn-2 cast (0 < 1 again; fresh cell — 101 still traps)
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 5);
  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

// ╔════════════════ [ casts_per_target ] ════════════════════════════════════ ]

#[test, expected_failure(abort_code = CAST_ECastsPerTarget, location = aresrpg_fight::cast)]
fun casts_per_target_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 255, 2, 0); // casts_per_target 2, per-turn unlimited
  begin_cast_turn(&mut fight);
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // cell 101: 1
  detonate_trap_at(&mut fight, 101); // free the anchor (trap-stacking ban) — the per-target COUNT persists
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // cell 101: 2
  detonate_trap_at(&mut fight, 101);
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // cell 101: 2 !< 2 → over per-target cap (gates BEFORE placement)
  abort 0
}

#[test]
fun casts_per_target_is_per_cell() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 255, 2, 0); // per-target 2
  begin_cast_turn(&mut fight);
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // cell 101: 1
  detonate_trap_at(&mut fight, 101); // free the anchor (trap-stacking ban) — the per-target COUNT persists
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // cell 101: 2 (at cap)
  cast::resolve_player_cast(&mut fight, 0, &spell, 103); // cell 103: 1 — a DIFFERENT target keeps its own count
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 3); // three casts, ap 6 − 3
  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

// ╔════════════════ [ Trap stacking (1.29 no-stack ban) ] ══════════════════ ]

#[test, expected_failure(abort_code = CAST_ECellAlreadyTrapped, location = aresrpg_fight::cast)]
fun trap_on_trapped_cell_aborts() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 255, 255, 0); // no authored limits — only the stack ban gates
  begin_cast_turn(&mut fight);
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // trap live at 101
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // second trap on the SAME anchor → ECellAlreadyTrapped
  abort 0
}

#[test]
fun trap_after_trigger_succeeds_and_zone_overlap_is_legal() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_cast(&mut sc, 255, 255, 0);
  begin_cast_turn(&mut fight);
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // trap live at 101
  // a DIFFERENT anchor INSIDE 101's blast zone (circle 1) is legal — the ban is anchor-on-anchor, never zone
  // overlap (the 1.29 trap-chain), so two live traps now cover overlapping cells.
  cast::resolve_player_cast(&mut fight, 0, &spell, 102);
  // detonate the 101 trap (FIRST entry covering the mover's cell — placement order): a DEAD trap frees its anchor.
  detonate_trap_at(&mut fight, 101);
  cast::resolve_player_cast(&mut fight, 0, &spell, 101); // re-trap the freed cell → succeeds
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 3); // three casts landed, ap 6 − 3
  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

// ╔════════════════ [ Min-turn (instant-pass bot guard) ] ═══════════════════ ]

/// Stand up a SOLO placement fight, place CHAR (→ ACTIVE, turn starts at now=1000, deadline 61000), and return
/// the shared Fight + engine Version ready for a pass at a chosen `now`.
fun setup_active(sc: &mut Scenario): (Fight, Version) {
  stand_up(sc);
  create_fight(sc, 500, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  (fight, ver)
}

#[test, expected_failure(abort_code = A_ETurnTooFast, location = aresrpg_fight::actions)]
fun instant_pass_aborts() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = setup_active(&mut sc);
  // pass at now=1000 (0 ms elapsed since turn start) — below MIN_TURN_MS.
  actions::pass_throttled_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER);
  abort 0
}

#[test]
fun pass_after_window_succeeds_and_mob_resolves() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = setup_active(&mut sc);
  // pass at now=4000 (exactly MIN_TURN_MS elapsed) → allowed; end_turn resolves the mob wave AND lands the
  // player's 2nd turn in this SAME call at one timestamp — the min-turn gate never touches the mob path.
  actions::pass_throttled_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 4000, OWNER);
  assert!(fight::status(&fight) == fight::status_active()); // mob resolved, turn returned to the solo player
  assert!(fight::turn_deadline_ms(&fight) == 4000 + 60_000 + 3_000); // 2nd turn @now=4000 +3s: the 1 mob that played (§7 per-mob throttle)
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Per-mob turn-deadline throttle (§7) ] ══════════════ ]
// The rule: "the time of the player turn must be equal to 45s + 3s per mob who played before him (up to
// the latest player for coop)". The base 45s is the `turn_ms` dial (60s in the test fixtures); the +3s rides
// each mob turn that resolved in the walk that lands the player. `turns::resolve_from` is the SOLE deadline
// stamp site (every path — placement start, pass/end_turn, permissionless crank — funnels through it), so the
// rows drive it directly over a known PRODUCTION interleave queue: the deadline reads the formula with no
// placement-cell / min-turn-timing noise. Punching-bag mobs deal no damage → every actor lives across the
// walks and the resolved-mob count is deterministic.

/// Stand up an ACTIVE PvM fight: `n_players` team-0 seats (CHAR, then COOP) + `n_mobs` punching bags, queue set
/// to the production interleave order (players in join order vs mobs in spawn order). Supports the 1- and
/// 2-player cases the rows below need.
fun active_fight(sc: &mut Scenario, n_players: u64, n_mobs: u16): (Fight, Version) {
  stand_up(sc);
  create_fight_group(sc, 500, 1, 1000, n_mobs);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let mut players = vector[interleave::new_player_actor(0)];
  if (n_players == 2) {
    fight::join_for_testing(&mut fight, combatant(COOP, 100), option::none(), &ver, sc.ctx());
    players.push_back(interleave::new_player_actor(1));
  };
  let mut mobs = vector[];
  let mut m = 0;
  while (m < (n_mobs as u64)) { mobs.push_back(interleave::new_mob_actor(m)); m = m + 1; };
  fight::set_queue(&mut fight, interleave::order(players, mobs));
  fight::set_status_active_for_testing(&mut fight);
  (fight, ver)
}

#[test]
/// FLOOR: 0 mobs before the player → the base `turn_ms` alone, no per-mob extra. Queue [p0, m0] opens on p0.
fun deadline_zero_mobs_is_base_turn_ms() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_fight(&mut sc, 1, 1);
  let mut rng = 42u64;
  turns::resolve_from(&mut fight, 0, &mut rng, 1000);
  assert!(fight::turn_deadline_ms(&fight) == 1000 + 60_000); // base only: 0 * 3s
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// MULTIPLIER: N mobs in the landing wave → base + N * 3s, not a flat bump. Queue [m0, p0, m1]: the 2nd turn's
/// walk sweeps BOTH mobs (m1, then m0 on wrap) before re-landing p0 → +6s. RED on the flat baseline (reads +0s).
fun deadline_adds_three_seconds_per_mob_in_the_wave() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_fight(&mut sc, 1, 2);
  let mut rng = 42u64;
  turns::resolve_from(&mut fight, 0, &mut rng, 1000); // m0 plays, p0 lands → 1 mob
  assert!(fight::turn_deadline_ms(&fight) == 1000 + 60_000 + 3_000);
  turns::resolve_from(&mut fight, 2, &mut rng, 5000); // p0 ended: m1 then m0(wrap) play, p0 re-lands → 2 mobs
  assert!(fight::turn_deadline_ms(&fight) == 5000 + 60_000 + 6_000); // +6s: the per-mob multiplier
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// COOP: the count is mobs since the LATEST player turn, RESET at every player landing — never a fight-global
/// tally. Queue [p0, m0, p1, m1]: each teammate lands after exactly the ONE mob since the prior player, so a
/// global counter (which would read 2 by p0's second turn) is disproven. RED on the flat baseline (reads +0s).
fun coop_deadline_counts_mobs_since_latest_player_turn() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_fight(&mut sc, 2, 2);
  let mut rng = 42u64;
  turns::resolve_from(&mut fight, 0, &mut rng, 1000); // p0 opens → 0 mobs
  assert!(fight::turn_deadline_ms(&fight) == 1000 + 60_000);
  turns::resolve_from(&mut fight, 1, &mut rng, 2000); // m0 plays, p1 lands → 1 mob since p0
  assert!(fight::turn_deadline_ms(&fight) == 2000 + 60_000 + 3_000);
  turns::resolve_from(&mut fight, 3, &mut rng, 3000); // m1 plays, p0 re-lands → 1 mob since p1 (RESET, not 2)
  assert!(fight::turn_deadline_ms(&fight) == 3000 + 60_000 + 3_000);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Anti-bot floor widens with the mob replay (§7, seat rule A 2026-07-18) ] ═ ]
// The min-turn floor (actions::assert_min_turn) is the instant-fight-bot guard: a PASS can't commit
// before MIN_TURN_MS past when a HUMAN could first act. Because a post-mob turn's deadline carries +3s per
// replayed mob, the floor widens to `start + 3s*N + MIN_TURN_MS` — a flat 3s floor would hand a bot a 3s*N
// head start every post-mob turn. These rows bracket the widened floor: refused just under it, allowed just
// over it, and the N=0 base floor still binds.

/// `setup_active` lands the solo player on turn 1 (N=0); advance ONE unthrottled pass at `t2` so the queued mob
/// replays and the player re-lands on a POST-MOB turn (deadline = t2 + turn_ms + 1*MOB_TURN_EXTRA_MS), widening
/// the anti-bot floor to `t2 + 3s + MIN_TURN_MS`. Returns the fight sitting on that turn (start = t2).
fun setup_post_mob_turn(sc: &mut Scenario, t2: u64): (Fight, Version) {
  let (mut fight, ver) = setup_active(sc);
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR), &ver, t2, OWNER); // no floor: reach turn 2
  (fight, ver)
}

#[test, expected_failure(abort_code = A_ETurnTooFast, location = aresrpg_fight::actions)]
/// POST-MOB, RED against a flat floor: at start + 3s*N + 2s (N=1 → t=6000, floor 7000) the WIDENED floor still
/// refuses — a flat 3s floor (deadline without the per-mob extra) would have ALLOWED this bot commit.
fun post_mob_floor_refuses_commit_before_widened_min() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = setup_post_mob_turn(&mut sc, 1000); // turn 2: start 1000, N=1, deadline 64000, floor 7000
  actions::pass_throttled_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 6000, OWNER); // 1000+3000+2000 < 7000
  abort 0
}

#[test]
/// POST-MOB: the SAME turn ALLOWS a commit at start + 3s*N + 4s (t=8000 >= floor 7000) — the widened floor is a
/// boundary, not a wall; the [floor, deadline] play window stays open.
fun post_mob_floor_allows_commit_after_widened_min() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = setup_post_mob_turn(&mut sc, 1000); // floor 7000
  actions::pass_throttled_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 8000, OWNER); // 1000+3000+4000 >= 7000
  assert!(fight::status(&fight) == fight::status_active()); // pass committed, queue advanced
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test, expected_failure(abort_code = A_ETurnTooFast, location = aresrpg_fight::actions)]
/// N=0 REGRESSION, RED against a floor-less variant: with no mob before the turn the floor is the FLAT
/// MIN_TURN_MS (widened == flat at N=0), so a commit at start + 2s (t=3000, floor 4000) is still refused.
fun no_mob_floor_still_refuses_commit_before_min() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = setup_active(&mut sc); // turn 1: start 1000, N=0, deadline 61000, floor 4000
  actions::pass_throttled_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 3000, OWNER); // 1000+2000 < 4000
  abort 0
}
