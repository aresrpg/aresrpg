// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Shared #[test_only] scaffold for the engine fight suites: stand up + ENABLE the package (GameConfig switch +
/// the fight Version dark-ship + registry), plus the punching-bag factories (mob spec, combatant, clock, and the
/// create_fight doors). Split out of fight_tests.move (the ≤600-LoC file cap); the tests import these verbatim.
#[test_only]
module aresrpg_fight::fight_scaffold;

use aresrpg_fight::{
  admin::{Self, AdminCap},
  cast,
  fight,
  mob::{Self, MobSpec},
  participant::{Self, Combatant},
  fight_registry::{Self, FightRegistry},
  version::{Self, Version}
};
use aresrpg_foundation::{combat_grid, spell};
use sui::{clock::{Self, Clock}, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0; // the creator character's id source
const WORLD: address = @0x704D; // a world id source
const LOOT: address = @0x100; // a loot item-template id source

/// Stand up + ENABLE both packages (GameConfig global switch + the fight Version dark-ship), leaving the caps
/// with OWNER and the shared objects shared. Lands on a fresh OWNER tx.
public fun stand_up(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  fight_registry::test_init(sc.ctx());

  sc.next_tx(OWNER);
  {
    let fcap = sc.take_from_sender<AdminCap>();
    let mut ver = sc.take_shared<Version>();
    admin::admin_set_enabled(&fcap, &mut ver, true, sc.ctx());
    ts::return_shared(ver);
    sc.return_to_sender(fcap);
  };
  sc.next_tx(OWNER);
}

public fun plain_stats(): spell::Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }
/// Specs carry DECENTERED (true) resistances — a plain punching bag is all-zero.
public fun mob_stats(): spell::Stats { plain_stats() }
/// FIRE weapon: 50 dmg / 60 crit, never crits (crit_rate 0), 3 AP, board-covering reach.
public fun weapon(): participant::Weapon { participant::new_weapon(spell::el_fire(), 50, 60, 0, 3, 40) }

public fun combatant(char: address, hp: u64): Combatant {
  participant::new_combatant(object::id_from_address(char), b"senshi".to_string(), 1, plain_stats(), hp, hp, 6, 3, weapon(), sui::vec_map::empty())
}

/// A CRIT-capable FIRE weapon (crit_rate 2 → 50% via the bp threshold): 50 base / 90 crit — for the §7
/// turn-seed crit-slot wiring tests. All else matches `weapon()` (3 AP, board-covering reach).
public fun weapon_crit(): participant::Weapon { participant::new_weapon(spell::el_fire(), 50, 90, 2, 3, 40) }
public fun combatant_crit(char: address, hp: u64): Combatant {
  participant::new_combatant(object::id_from_address(char), b"senshi".to_string(), 1, plain_stats(), hp, hp, 6, 3, weapon_crit(), sui::vec_map::empty())
}

/// Seat a creator carrying an explicit weapon LINE `w` — the affinity suite injects `weapon_line_of(family, bool)`
/// so a REAL weapon strike resolves the +10%-scaled (or un-scaled) family line end-to-end.
public fun combatant_weapon(char: address, hp: u64, w: participant::Weapon): Combatant {
  participant::new_combatant(object::id_from_address(char), b"senshi".to_string(), 1, plain_stats(), hp, hp, 6, 3, w, sui::vec_map::empty())
}

/// create_fight seating a CRIT-capable creator (crit_rate>0) — drives the crit-slot integration tests. PvM,
/// public, spawned-at 0. `now` seeds the clock (→ turn_deadline the crit seed folds in).
public fun create_fight_crit(sc: &mut Scenario, base_hp: u64, spawn_id: u64, now: u64) {
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let ver = sc.take_shared<Version>();
  let spec = bag_spec(base_hp);
  let clock = mk_clock(sc, now);
  fight::create_for_testing(&mut registry, object::id_from_address(WORLD), spawn_id, 12345, 100, 200, 0, true, option::none(), &spec, 1, combatant_crit(CHAR, 100), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

/// create_fight seating a creator with an explicit weapon LINE `w` (the affinity strike suite). PvM, public,
/// spawned-at 0; `now` seeds the clock. Creator = CHAR, hp 100.
public fun create_fight_weapon(sc: &mut Scenario, base_hp: u64, spawn_id: u64, now: u64, w: participant::Weapon) {
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let ver = sc.take_shared<Version>();
  let spec = bag_spec(base_hp);
  let clock = mk_clock(sc, now);
  fight::create_for_testing(&mut registry, object::id_from_address(WORLD), spawn_id, 12345, 100, 200, 0, true, option::none(), &spec, 1, combatant_weapon(CHAR, 100, w), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

/// A spell-less punching-bag spec with `base_hp` and one 100%-drop loot entry (plain data — no object).
public fun bag_spec(base_hp: u64): MobSpec {
  let loot = vector[mob::new_loot_entry(object::id_from_address(LOOT), 10000, 1, 1)];
  mob::new_mob_spec(1, 1, base_hp, 0, 0, mob_stats(), vector[], 100, loot)
}

public fun mk_clock(sc: &mut Scenario, now: u64): Clock {
  let mut c = clock::create_for_testing(sc.ctx());
  c.set_for_testing(now);
  c
}

/// Create a fight (creator = CHAR, hp 100) over `mob_id`, sharing it. Returns nothing (take_shared after).
public fun create_fight(sc: &mut Scenario, base_hp: u64, spawn_id: u64, spawned_at: u64, now: u64, is_public: bool, party: Option<ID>) {
  create_fight_as(sc, base_hp, spawn_id, spawned_at, now, is_public, party, CHAR)
}

/// create_fight with an explicit creator character (the S-12f latch allows ONE live fight per character —
/// multi-fight tests must seat distinct characters).
public fun create_fight_as(sc: &mut Scenario, base_hp: u64, spawn_id: u64, spawned_at: u64, now: u64, is_public: bool, party: Option<ID>, char_addr: address) {
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let ver = sc.take_shared<Version>();
  let spec = bag_spec(base_hp);
  let clock = mk_clock(sc, now);
  fight::create_for_testing(&mut registry, object::id_from_address(WORLD), spawn_id, 12345, 100, 200, spawned_at, is_public, party, &spec, 1, combatant(char_addr, 100), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

/// create_fight (creator = CHAR, hp 100, PvM, public) with an explicit mob `group_size` — the turn-deadline
/// rider proves the per-mob multiplier, which needs waves of 2+ mobs the single-mob `create_fight` cannot seat.
public fun create_fight_group(sc: &mut Scenario, base_hp: u64, spawn_id: u64, now: u64, group_size: u16) {
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let ver = sc.take_shared<Version>();
  let spec = bag_spec(base_hp);
  let clock = mk_clock(sc, now);
  fight::create_for_testing(&mut registry, object::id_from_address(WORLD), spawn_id, 12345, 100, 200, 0, true, option::none(), &spec, group_size, combatant(CHAR, 100), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

public fun tsreg(sc: &Scenario): FightRegistry { sc.take_shared<FightRegistry>() }

// ╔════════════════ [ Board-agnostic cell finders (the procedural board makes exact cells unpredictable) ] ═ ]

/// Walk `dist` cells from `from` in cardinal direction `dir` (0=+x,1=-x,2=+y,3=-y); `none` if the walk runs off
/// the board before completing `dist` steps.
public fun walk_straight(from: u64, dir: u8, dist: u64): Option<u64> {
  let mut cur = from;
  let mut steps = 0;
  while (steps < dist) {
    let nxt = combat_grid::step_cell(cur, dir);
    if (nxt.is_none()) return option::none();
    cur = nxt.destroy_some();
    steps = steps + 1;
  };
  option::some(cur)
}

/// The first cell at exactly Manhattan `dist` from `from` (tried S/E/N/W) that no living fighter occupies — a
/// board-shape-agnostic way to pick a legal spell-cast TARGET near an unknown seeded position (cast targeting
/// only cares about occupancy/range/LOS, never the shape mask, so this never needs the wall bitset).
public fun free_cell_near(fight_ref: &fight::Fight, from: u64, dist: u64): u64 {
  let dirs = vector[2u8, 0u8, 3u8, 1u8];
  let mut i = 0;
  while (i < dirs.length()) {
    let dest = walk_straight(from, *dirs.borrow(i), dist);
    if (dest.is_some()) {
      let c = *dest.borrow();
      if (!cast::cell_occupied(fight_ref, c)) return c;
    };
    i = i + 1;
  };
  abort 9999
}

/// The first OPEN adjacent cell for `seat` to MOVE into, using the REAL movement wall mask (shape ∪ obstacles ∪
/// holes ∪ other bodies) — correct against whatever board the procedural generator drew for this fight.
public fun first_open_move_neighbor(fight_ref: &fight::Fight, seat: u64): u64 {
  let cell = participant::cell(fight::participants(fight_ref).borrow(seat));
  let wall = cast::move_blocked_cells(fight_ref, false, seat);
  let dirs = vector[2u8, 0u8, 3u8, 1u8];
  let mut i = 0;
  while (i < dirs.length()) {
    let nxt = combat_grid::step_cell(cell, *dirs.borrow(i));
    if (nxt.is_some()) {
      let c = *nxt.borrow();
      if (!combat_grid::mask_get(&wall, c)) return c;
    };
    i = i + 1;
  };
  abort 9999
}
