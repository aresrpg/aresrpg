// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Canonical ordinary movement path for participants and mobs.
///
/// The public fight MOVE door is destination-only, so the engine reconstructs the same deterministic shortest
/// route as `combat_grid::bfs_path_cost`: left, right, up, then down at every BFS layer. Each entered cell is
/// committed in order. The first covered trap cell is entered successfully and force-stops the route; callers
/// then run the shared `cast::trigger_on_enter` sink before any later action. Trap ownership is deliberately
/// invisible here: AresRPG's 1.29 brand law is entrant-based, so the placer triggers their own trap too.
module aresrpg_fight::movement;

use aresrpg_fight::{fight::{Self, Fight}, mob, participant};
use aresrpg_foundation::{combat_grid, spell_board};

const EBrokenShortestPath: u64 = 101;

/// Walk a canonical shortest route to `destination` within `budget` over the caller's frozen wall mask.
/// Returns `(legal_destination, traversed_steps, entered_trap)`. An illegal destination performs no writes.
public(package) fun walk(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  destination: u64,
  walls: &vector<u64>,
  budget: u64,
): (bool, u64, bool) {
  let start = target_cell(fight, target_is_mob, target_idx);
  let cost = combat_grid::bfs_path_cost(start, destination, walls, budget);
  if (cost == combat_grid::path_unreachable()) return (false, 0, false);

  let mut current = start;
  let mut remaining = cost;
  let mut traversed = 0;
  while (remaining > 0) {
    current = next_shortest_step(current, destination, walls, remaining);
    set_target_cell(fight, target_is_mob, target_idx, current);
    traversed = traversed + 1;
    remaining = remaining - 1;
    if (spell_board::has_trap_covering(fight::fx(fight), current)) {
      return (true, traversed, true)
    };
  };
  (true, traversed, false)
}

/// THE TACKLE TOLL walk (ruling #239, sim twin `fight_actions.js` apply_move failed branch): a FAILED escape
/// still walks — it follows the canonical shortest route toward `destination` but stops after `cap` steps (the
/// MP that survived the tax), so a request the survivor can't fully afford truncates to its prefix and a tax
/// that zeroed MP walks NOWHERE (the toll can consume everything). `destination` MUST be proven reachable within
/// `ceiling` (the runner's PRE-tax MP) by the caller, so the full route exists and drives `next_shortest_step`;
/// `cap <= ceiling`. Returns `(traversed_steps, entered_trap)`. Like `walk`, spends no MP itself — the caller
/// charges `traversed_steps`.
public(package) fun walk_prefix(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  destination: u64,
  walls: &vector<u64>,
  ceiling: u64,
  cap: u64,
): (u64, bool) {
  let start = target_cell(fight, target_is_mob, target_idx);
  let cost = combat_grid::bfs_path_cost(start, destination, walls, ceiling);
  let steps = if (cost < cap) cost else cap; // min(full route cost, surviving MP)

  let mut current = start;
  let mut remaining = cost;
  let mut traversed = 0;
  while (traversed < steps) {
    current = next_shortest_step(current, destination, walls, remaining);
    set_target_cell(fight, target_is_mob, target_idx, current);
    traversed = traversed + 1;
    remaining = remaining - 1;
    if (spell_board::has_trap_covering(fight::fx(fight), current)) {
      return (traversed, true)
    };
  };
  (traversed, false)
}

/// Pick the first neighbor that still admits the remaining shortest distance. Direction order is byte-for-byte
/// the BFS enqueue order in `combat_grid::bfs_path_cost`: left, right, up, down.
fun next_shortest_step(current: u64, destination: u64, walls: &vector<u64>, remaining: u64): u64 {
  let dirs = vector[1u8, 0u8, 3u8, 2u8];
  let mut i = 0;
  while (i < dirs.length()) {
    let next = combat_grid::step_cell(current, *dirs.borrow(i));
    if (next.is_some()) {
      let cell = next.destroy_some();
      if (!combat_grid::mask_get(walls, cell)
        && combat_grid::bfs_path_cost(cell, destination, walls, remaining - 1) == remaining - 1) {
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
