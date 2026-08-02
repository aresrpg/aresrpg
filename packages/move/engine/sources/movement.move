// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Canonical ordinary movement path for participants and mobs.
///
/// The public fight MOVE door is destination-only, so the engine reconstructs the same deterministic shortest
/// route as `combat_grid::bfs_path_cost`: left, right, up, then down at every BFS layer. Each entered cell is
/// committed in order. A covered trap cell fires its trap the INSTANT it is entered (the shared
/// `cast::trigger_on_enter` sink, inline) and the route RESUMES — it stops early ONLY when the trigger removes the
/// mover from the route: it DIED, or a repulsive payload displaced it off the cell it just entered (#320/#325).
/// Trap ownership is deliberately invisible here: AresRPG's 1.29 brand law is entrant-based, so the placer
/// triggers their own trap too. The inline sink is acyclic — `cast` never depends on `movement`.
module aresrpg_fight::movement;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob, participant};
use aresrpg_foundation::{combat_grid, spell_board};

const EBrokenShortestPath: u64 = 101;

/// Walk a canonical shortest route to `destination` within `budget` over the caller's frozen wall mask, firing
/// every crossed trap inline (entrant-blind) and resuming after each survived one. Returns
/// `(legal_destination, traversed_steps)`; `traversed_steps` is the cells actually entered — the full route
/// unless `steps_cap` truncates it, or a trap killed or displaced the mover mid-walk. An illegal destination
/// performs no writes.
///
/// `budget` decides LEGALITY (can this destination be reached at all) and `steps_cap` decides HOW FAR the mover
/// actually gets — the two are the same number on every ordinary walk, and diverge only under the tackle TOLL
/// (#239): a failed escape taxes the pools and the route is then truncated to the prefix the surviving MP can
/// still afford. Capping to zero is a legal no-op walk, never an illegal destination.
public(package) fun walk(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  destination: u64,
  walls: &vector<u64>,
  budget: u64,
  steps_cap: u64,
): (bool, u64) {
  let start = target_cell(fight, target_is_mob, target_idx);
  let cost = combat_grid::bfs_path_cost(start, destination, walls, budget);
  if (cost == combat_grid::path_unreachable()) return (false, 0);
  let steps = if (cost < steps_cap) cost else steps_cap;
  if (steps == 0) return (true, 0);
  // ONE flood fill for the whole route. The walker used to run another per candidate direction per step — up to
  // `1 + steps × 4` fills for a single move, and this is the engine's hottest loop (every MOVE, and every mob
  // advance in every crank walk). The field answers the same question the per-direction call did, so the route
  // it produces is identical; see `combat_grid::bfs_distance_field`.
  let field = combat_grid::bfs_distance_field(destination, walls, cost);

  let mut current = start;
  let mut remaining = cost;
  let mut traversed = 0;
  while (traversed < steps) {
    current = next_shortest_step(current, &field, walls, remaining);
    set_target_cell(fight, target_is_mob, target_idx, current);
    traversed = traversed + 1;
    remaining = remaining - 1;
    if (spell_board::has_trap_covering(fight::fx(fight), current)) {
      // Detonate onto the mover, then RESUME — unless the trigger took the mover off the route (death, or a
      // repulsive payload that moved it off `current`). trigger_on_enter consumes the trap, so a later cell of an
      // overlapping zone cannot re-fire it.
      cast::trigger_on_enter(fight, target_is_mob, target_idx);
      if (!fighter_alive(fight, target_is_mob, target_idx)) return (true, traversed);
      if (target_cell(fight, target_is_mob, target_idx) != current) return (true, traversed);
    };
  };
  (true, traversed)
}

fun fighter_alive(fight: &Fight, target_is_mob: bool, target_idx: u64): bool {
  if (target_is_mob) mob::is_alive(fight::mobs(fight).borrow(target_idx))
  else participant::is_alive(fight::participants(fight).borrow(target_idx))
}

/// Pick the first neighbor that still admits the remaining shortest distance. Direction order is byte-for-byte
/// the BFS enqueue order in `combat_grid::bfs_path_cost`: left, right, up, down — the whole determinism of the
/// route lives in this order, so it is the one thing the flood-fill diet had to leave untouched.
fun next_shortest_step(current: u64, field: &vector<u64>, walls: &vector<u64>, remaining: u64): u64 {
  let dirs = vector[1u8, 0u8, 3u8, 2u8];
  let mut i = 0;
  while (i < dirs.length()) {
    let next = combat_grid::step_cell(current, *dirs.borrow(i));
    if (next.is_some()) {
      let cell = next.destroy_some();
      // Same predicate as before, read instead of recomputed: "does this neighbour still admit the remaining
      // distance?" is exactly `bfs_path_cost(cell, destination, walls, remaining - 1) == remaining - 1`.
      if (!combat_grid::mask_get(walls, cell) && *field.borrow(cell) == remaining - 1) {
        return cell
      };
    };
    i = i + 1;
  };
  abort EBrokenShortestPath
}

fun target_cell(fight: &Fight, target_is_mob: bool, target_idx: u64): u64 {
  if (target_is_mob) mob::cell(fight::mobs(fight).borrow(target_idx))
  else participant::cell(fight::participants(fight).borrow(target_idx))
}

fun set_target_cell(fight: &mut Fight, target_is_mob: bool, target_idx: u64, cell: u64) {
  if (target_is_mob) mob::set_cell(fight::mobs_mut(fight).borrow_mut(target_idx), cell)
  else participant::set_cell(fight::participants_mut(fight).borrow_mut(target_idx), cell);
}
