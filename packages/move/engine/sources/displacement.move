// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Canonical spell displacement for participant and mob targets.
/// Direction is the dominant cardinal axis from origin to target (x wins ties); PUSH and GEOMETRIC_PUSH go away,
/// PULL goes toward. Geometry-driven distance is the count of steps that remain inside the cast's frozen zone.
/// Movement advances one cell at a time and stops before grid edges, off-shape cells, holes, obstacles, or living
/// bodies. Entering any covered trap cell succeeds, triggers that trap upstream, and force-stops without collision.
/// A hard stop blocks every untravelled requested cell and damages the displaced target only.
/// PUSH and PULL share the canonical collision rule: max(12 * collision_level / 50, 1) * blocked_cells.
/// Newly placed traps side-table their owner seat; trap payload collision uses the level snapshotted for that owner.
/// A trap without that upgrade-side record is pre-upgrade and canonically falls back to collision level 1.
module aresrpg_fight::displacement;

use aresrpg_fight::{fight::{Self, Fight}, mob, participant};
use aresrpg_foundation::{combat_grid, spell_board, spell_effect, spell_formula};
use sui::dynamic_field as df;

const EInvalidKind: u64 = 101;

/// Upgrade-safe trap attribution keyed by anchor on the Fight UID; no frozen board/fighter layout changes.
public struct TrapOwnerKey has copy, drop, store { anchor: u64 }

/// Record the placing participant seat. A stale same-anchor row is overwritten defensively before trap reuse.
public(package) fun record_trap_owner(fight: &mut Fight, anchor: u64, owner_seat: u64) {
  let key = TrapOwnerKey { anchor };
  if (df::exists(fight::uid(fight), key)) {
    let stored = df::borrow_mut<TrapOwnerKey, u64>(fight::uid_mut(fight), key);
    *stored = owner_seat;
  } else {
    df::add(fight::uid_mut(fight), key, owner_seat);
  };
}

/// Consume attribution with the trap. Missing means the trap predates this module, so level 1 is canonical.
public(package) fun take_trap_owner_level(fight: &mut Fight, anchor: u64): u64 {
  let key = TrapOwnerKey { anchor };
  if (!df::exists(fight::uid(fight), key)) return 1;
  let owner_seat = df::remove<TrapOwnerKey, u64>(fight::uid_mut(fight), key);
  participant::level(fight::participants(fight).borrow(owner_seat))
}

/// Apply one side-aware displacement and return
/// `(from_cell, to_cell, blocked_cells, collision_damage, entered_trap)`.
/// `blocked_cells` is collision-only: a trap force-stop or zero direction reports zero.
public(package) fun apply(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  origin_cell: u64,
  kind: u8,
  collision_level: u64,
  requested: u64,
): (u64, u64, u64, u64, bool) {
  assert!(kind == spell_effect::k_push()
    || kind == spell_effect::k_pull()
    || kind == spell_effect::k_throw()
    || kind == spell_effect::k_geometric_push(), EInvalidKind);
  let from_cell = target_cell(fight, target_is_mob, target_idx);
  let dir = if (kind == spell_effect::k_push()
    || kind == spell_effect::k_throw()
    || kind == spell_effect::k_geometric_push()) {
    combat_grid::away_dir(origin_cell, from_cell)
  } else {
    combat_grid::toward_dir(origin_cell, from_cell)
  };
  let walls = move_blocked_cells(fight, target_is_mob, target_idx);
  let mut to_cell = from_cell;
  let mut moved = 0;
  let mut collided = false;
  let mut entered_trap = false;
  while (moved < requested && dir != combat_grid::dir_none()) {
    let next = combat_grid::step_cell(to_cell, dir);
    if (next.is_none()) {
      collided = true;
      break
    };
    let next_cell = next.destroy_some();
    if (combat_grid::mask_get(&walls, next_cell)) {
      collided = true;
      break
    };
    to_cell = next_cell;
    moved = moved + 1;
    if (spell_board::has_trap_covering(fight::fx(fight), to_cell)) {
      entered_trap = true;
      break
    };
  };
  set_target_cell(fight, target_is_mob, target_idx, to_cell);
  let blocked = if (collided) requested - moved else 0;
  let damage = spell_formula::push_collision_damage(collision_level, blocked);
  (from_cell, to_cell, blocked, damage, entered_trap)
}

/// Number of outward steps from `subject` that stay inside the effect's immutable zone. A fighter on the edge
/// requests zero cells; a fighter on the origin has no direction and also requests zero. Blockers/traps are not
/// consulted here—the canonical `apply` walk owns those live-board semantics and collision damage.
public(package) fun zone_edge_distance(zone: &vector<u64>, origin: u64, subject: u64): u64 {
  let dir = combat_grid::away_dir(origin, subject);
  let mut cell = subject;
  let mut distance = 0;
  while (dir != combat_grid::dir_none()) {
    let next = combat_grid::step_cell(cell, dir);
    if (next.is_none()) break;
    let candidate = next.destroy_some();
    if (!zone.contains(&candidate)) break;
    cell = candidate;
    distance = distance + 1;
  };
  distance
}

fun target_cell(fight: &Fight, target_is_mob: bool, target_idx: u64): u64 {
  if (target_is_mob) mob::cell(fight::mobs(fight).borrow(target_idx))
  else participant::cell(fight::participants(fight).borrow(target_idx))
}

fun set_target_cell(fight: &mut Fight, target_is_mob: bool, target_idx: u64, cell: u64) {
  if (target_is_mob) mob::set_cell(fight::mobs_mut(fight).borrow_mut(target_idx), cell)
  else participant::set_cell(fight::participants_mut(fight).borrow_mut(target_idx), cell);
}

/// Immutable off-shape wall mask, shared with ordinary movement through the compatibility wrappers in `cast`.
public(package) fun off_shape_mask(fight: &Fight): vector<u64> {
  let shape = fight::shape_mask(fight);
  let cells = combat_grid::grid_cells();
  let mut mask = combat_grid::empty_mask();
  let mut cell = 0;
  while (cell < cells) {
    if (!combat_grid::mask_get(&shape, cell)) combat_grid::mask_set(&mut mask, cell);
    cell = cell + 1;
  };
  mask
}

/// Terrain plus every living body except the named mover, as a canonical mask.
public(package) fun move_blocked_cells(fight: &Fight, exclude_mob: bool, exclude_idx: u64): vector<u64> {
  let mut mask = off_shape_mask(fight);
  let obstacles = fight::obstacles(fight);
  let holes = fight::holes(fight);
  combat_grid::mask_add_cells(&mut mask, &obstacles);
  combat_grid::mask_add_cells(&mut mask, &holes);
  add_living_bodies(fight, &mut mask, exclude_mob, exclude_idx);
  mask
}

/// Mob-turn memo twin: immutable terrain memo plus freshly read living bodies.
public(package) fun move_blocked_cells_memo(
  fight: &Fight,
  exclude_idx: u64,
  off_shape: &vector<u64>,
): vector<u64> {
  let mut mask = *off_shape;
  let obstacles = fight::obstacles(fight);
  let holes = fight::holes(fight);
  combat_grid::mask_add_cells(&mut mask, &obstacles);
  combat_grid::mask_add_cells(&mut mask, &holes);
  add_living_bodies(fight, &mut mask, true, exclude_idx);
  mask
}

fun add_living_bodies(fight: &Fight, mask: &mut vector<u64>, exclude_mob: bool, exclude_idx: u64) {
  let participant_count = fight::participants(fight).length();
  let mut i = 0;
  while (i < participant_count) {
    let fighter = fight::participants(fight).borrow(i);
    if (participant::is_alive(fighter) && !(!exclude_mob && i == exclude_idx)) {
      combat_grid::mask_set(mask, participant::cell(fighter));
    };
    i = i + 1;
  };
  let mob_count = fight::mobs(fight).length();
  let mut j = 0;
  while (j < mob_count) {
    let fighter = fight::mobs(fight).borrow(j);
    if (mob::is_alive(fighter) && !(exclude_mob && j == exclude_idx)) {
      combat_grid::mask_set(mask, mob::cell(fighter));
    };
    j = j + 1;
  };
}
