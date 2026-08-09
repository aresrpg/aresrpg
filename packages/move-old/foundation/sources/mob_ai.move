// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// MOB AI + spawn derivation — the §17.21 deterministic mob policy and the spawn-roll math, as PURE transforms
/// over plain data (S-46 extraction: moved verbatim from `aresrpg::mob`, `self: &FightMob` unrolled into the
/// four fields the policy actually reads — cell / ap / mp / spells). Zero state, zero objects, zero events:
/// the main package's `mob` module is a thin shell that reads its FightMob and calls through.
///
/// DECIDE: SUPPORT priority — a healer with a wounded ally heals the MOST-WOUNDED one over
/// attacking), else ATTACK the nearest player with the first castable non-heal spell, else BFS-advance and
/// re-scan. DETERMINISTIC — no RNG (crit rolls happen later, at resolution).
module aresrpg_foundation::mob_ai;

use aresrpg_foundation::{combat_grid, prng, spell_effect::{Self, SpellLevel, Effect}};

const MOB_RANGE_FALLBACK_MIN: u64 = 1; // used only if a spell has a 0 range floor (defensive)

// GAS DIET (b) — the mob considers only the NEAREST few player targets. A mob's job is to rush the nearest
// cluster (the rush-and-attack law), so enumerating every distant player was pure compute with no behavior
// value; the per-decision cost scaled with party size (nt × BFS). 2 keeps a real choice (nearest + backup) while
// bounding the fan. Policy constant (not owner-tuned like AI_W_*). decide_turn's signature gained `range_bonus`
// 2026-07-12 INSIDE the SPEC-train fresh-publish window (legal: nothing published depends on it). Any future
// signature change rides a fresh foundation publish under the same clean name, with no compatibility stub.
const MAX_AI_TARGETS: u64 = 2;

const ENoLivingTargets: u64 = 103; // decide_turn: called with an empty target set (caller bug)

// ╔════════════════ [ §17.21 turn AI — STOCHASTIC weighted policy ] ═ ]
// Mob decisions must be genuinely UNPREDICTABLE *among sensible plays*: the policy enumerates every VIABLE
// action (attack each player with each castable spell — from here or after an advance —, heal each wounded
// ally), filters NONSENSE (out-of-range casts, full-HP-ally heals, walls), and draws WEIGHTED over the
// survivors off the threaded rng (seeded from the cranking entry\'s fresh &Random draw — replay of a turn is
// exact from its seed; futures are unpredictable).
//   ATTACK-DOMINANT DRAW (mobs mostly rush and attack, rather than wander): when ANY
//   attack is viable, reposition/idle are EXCLUDED from the pool — a mob that can hit NEVER chooses to walk
//   away (the "came → walked back → came, then didn\'t attack me" bug). Heal stays in the pool alongside attacks
//   (a support mob choosing to heal a wounded ally over striking is sanctioned). Reposition enters the pool
//   ONLY when nothing can attack: then a SINGLE deterministic advance toward the NEAREST reachable target — no
//   weighted flip-flop between targets (the cross-turn oscillation), and bfs_best_toward never ends farther
//   from its target than it started, so MP is spent ONLY to CLOSE distance for next turn (never spend MP
//   that doesn\'t serve the action). An attack\'s own move is exactly the path to its cast cell (the CLOSEST band
//   cell — cast_cell_for min-cost), zero extra steps; already-in-range ⇒ it strikes from standing (zero MP).
// SPREAD GUARANTEE: all weights live in a clamped band (max/min ratio ≤ 3 — see the main package\'s AI_W_*
// constants), so with 3+ viable attack/heal actions no single one exceeds 60% likelihood (worst case =
// W_MAX/(W_MAX + 2·W_MIN) = 120/200). Competence comes from the viable-set filter + MILD weighting.

/// The action-weight tuning block (an IO struct — the NAMED constants live main-side in `aresrpg::mob`).
public struct AiWeights has copy, drop {
  attack_now: u64, // cast an attack spell from the current cell
  attack_move: u64, // advance (BFS, MP budget) then cast
  heal: u64, // heal a WOUNDED ally (from here or after an advance)
  reposition: u64, // advance toward a target without casting
}

public fun new_weights(attack_now: u64, attack_move: u64, heal: u64, reposition: u64): AiWeights {
  AiWeights { attack_now, attack_move, heal, reposition }
}

/// Decide a mob\'s turn from its (cell, ap, mp, spell kit) + the fight state vectors. Returns
/// `(new_cell, spell_index_opt, target_cell)` — the same shape the turn machine consumed before; only the
/// SELECTION is now a weighted draw over the viable-action set. `rng` is the resolve-chain entropy carrier.
/// Falls back to a plain nearest-target idle (no cast, no move) when NOTHING is viable.
public fun decide_turn(
  cell: u64,
  ap: u64,
  mp: u64,
  spells: &vector<SpellLevel>,
  target_cells: &vector<u64>,
  ally_cells: &vector<u64>,
  ally_missing: &vector<u64>,
  move_blocked: &vector<u64>, // a MASK_WORDS-word wall BITSET (mask_get membership), NOT a cell list — threaded into combat_grid::bfs_*
  los_obstacles: &vector<u64>, // LOS blocker CELL LIST (line_of_sight iterates it — kept a list, gas-diet #1 leaves LOS alone)
  range_bonus: u64, // the mob's LIVE +range stat (spell::stat_range of its per-fight block) — extends a modifiable spell's rmax exactly like a player's; a range-SHRED row lowers it and SHRINKS the reachable band (a boss-counterplay tool)
  w: &AiWeights,
  rng: &mut u64,
): (u64, Option<u64>, u64) {
  assert!(target_cells.length() > 0, ENoLivingTargets);

  // (b) TARGET CAP — enumerate viable actions against only the nearest MAX_AI_TARGETS players (grid distance,
  // deterministic tie-break by seat/index order). SANCTIONED behavior change: a mob rushes the nearest cluster.
  let targets = nearest_targets_capped(cell, target_cells, MAX_AI_TARGETS);

  // parallel action rows: weight | acting cell | spell+1 (0 = no cast) | target cell
  let mut a_w: vector<u64> = vector[];
  let mut a_cell: vector<u64> = vector[];
  let mut a_spell: vector<u64> = vector[];
  let mut a_tgt: vector<u64> = vector[];

  let nt = targets.length();
  let mut has_attack = false; // ATTACK-DOMINANT: once any attack is viable, reposition/idle leave the draw pool.

  let ns = spells.length();
  let mut s = 0;
  while (s < ns) {
    let is_support = effects_contain_heal(spells.borrow(s).sl_effects());
    if (!is_support) {
      // ATTACK: this spell against EVERY player target — cast in place if in band, else from the CLOSEST cell
      // inside its range band we can dash to (band+LOS-aware, never overshooting a min-range spell point-blank).
      let mut t = 0;
      while (t < nt) {
        let tcell = *targets.borrow(t);
        let cc = cast_cell_for(ap, mp, spells, s, cell, tcell, move_blocked, los_obstacles, range_bonus);
        if (cc.is_some()) {
          let nc = cc.destroy_some(); // == cell when castable in place (strike from standing, zero MP)
          let wt = if (nc == cell) w.attack_now else w.attack_move; // in place vs advance to the CLOSEST band cell
          a_w.push_back(wt); a_cell.push_back(nc); a_spell.push_back(s + 1); a_tgt.push_back(tcell);
          has_attack = true;
        };
        t = t + 1;
      };
    } else {
      // SUPPORT: this heal against EVERY WOUNDED ally (full-HP ally = nonsense, filtered) — same band-aware reach.
      let na = ally_cells.length();
      let mut a = 0;
      while (a < na) {
        if (*ally_missing.borrow(a) > 0) {
          let acell = *ally_cells.borrow(a);
          let cc = cast_cell_for(ap, mp, spells, s, cell, acell, move_blocked, los_obstacles, range_bonus);
          if (cc.is_some()) {
            a_w.push_back(w.heal); a_cell.push_back(cc.destroy_some()); a_spell.push_back(s + 1); a_tgt.push_back(acell);
          };
        };
        a = a + 1;
      };
    };
    s = s + 1;
  };

  // REPOSITION — the SANCTIONED FALLBACK, present ONLY when nothing can attack (attack-dominant draw, owner
  // 2026-07-11). A SINGLE advance toward the NEAREST target whose path makes progress: nearest-first so a mob
  // rushes the closest threat, one row (never a weighted flip-flop between targets = the cross-turn wander),
  // and bfs_best_toward\'s chosen cell is never farther from its target than the current one (MP spent only to
  // CLOSE distance). Falls through to a farther capped target only when the nearer one cannot move this turn.
  if (!has_attack) {
    let mut best_nc = option::none<u64>();
    let mut best_tgt = 0;
    let mut best_d = 0;
    let mut t2 = 0;
    while (t2 < nt) {
      let tcell = *targets.borrow(t2);
      let nc = combat_grid::bfs_best_toward(cell, tcell, move_blocked, mp);
      if (nc != cell) {
        let d = combat_grid::manhattan(cell, tcell);
        if (best_nc.is_none() || d < best_d) { best_nc = option::some(nc); best_tgt = tcell; best_d = d; };
      };
      t2 = t2 + 1;
    };
    if (best_nc.is_some()) {
      a_w.push_back(w.reposition); a_cell.push_back(best_nc.destroy_some()); a_spell.push_back(0); a_tgt.push_back(best_tgt);
    };
  };

  // nothing viable → idle in place (keeps the old degenerate behavior: no cast, nearest target for the shape).
  if (a_w.is_empty()) return (cell, option::none(), *targets.borrow(nearest_target(cell, &targets)));

  // WEIGHTED DRAW over the viable set (prng — one draw per decision).
  let n = a_w.length();
  let mut total = 0;
  let mut j = 0;
  while (j < n) { total = total + *a_w.borrow(j); j = j + 1; };
  let mut r = prng::draw(rng) % total;
  let mut k = 0;
  while (k < n) {
    let wk = *a_w.borrow(k);
    if (r < wk) break;
    r = r - wk;
    k = k + 1;
  };
  let sp = *a_spell.borrow(k);
  (*a_cell.borrow(k), if (sp == 0) option::none() else option::some(sp - 1), *a_tgt.borrow(k))
}

fun nearest_target(from: u64, cells: &vector<u64>): u64 {
  let mut best = 0;
  let mut best_d = combat_grid::manhattan(from, *cells.borrow(0));
  let mut i = 1;
  while (i < cells.length()) {
    let d = combat_grid::manhattan(from, *cells.borrow(i));
    if (d < best_d) { best_d = d; best = i; };
    i = i + 1;
  };
  best
}

/// (b) The `cap` nearest target cells to `from` (Manhattan), in nearest-first order, with a DETERMINISTIC
/// tie-break: equal distance keeps the earlier index (= lower seat, the caller's target order). `n <= cap`
/// returns every target verbatim. O(cap·n) — cap is a tiny policy constant, n = living players. Same state ⇒
/// identical selection (no dependence on any unordered structure), so a turn still replays exactly from its seed.
fun nearest_targets_capped(from: u64, cells: &vector<u64>, cap: u64): vector<u64> {
  let n = cells.length();
  if (n <= cap) return *cells;
  let mut chosen: vector<u64> = vector[]; // indices already taken (small — length cap)
  let mut out: vector<u64> = vector[];
  let mut picks = 0;
  while (picks < cap) {
    let mut best = option::none<u64>();
    let mut best_d = 0;
    let mut i = 0;
    while (i < n) {
      if (!chosen.contains(&i)) {
        let d = combat_grid::manhattan(from, *cells.borrow(i));
        if (best.is_none() || d < best_d) { best = option::some(i); best_d = d; }; // strict < ⇒ earliest index on ties
      };
      i = i + 1;
    };
    let bi = best.destroy_some();
    chosen.push_back(bi);
    out.push_back(*cells.borrow(bi));
    picks = picks + 1;
  };
  out
}

fun effects_contain_heal(effects: &vector<Effect>): bool {
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    if (effects.borrow(i).kind() == spell_effect::k_heal()) return true;
    i = i + 1;
  };
  false
}

/// Spell `i`'s EFFECTIVE cast band: `(range_min, range_max, needs_los)` with the 0-floor → 1 fallback applied.
/// The single home for the range-band rule, shared by `castable_at` (fixed-cell gate) and `cast_cell_for` (the
/// band-aware approach), so the two can never disagree about where a spell is castable from.
fun spell_cast_band(spells: &vector<SpellLevel>, i: u64, range_bonus: u64): (u64, u64, bool) {
  let sl = spells.borrow(i);
  let rmin = if (sl.sl_range_min() == 0) MOB_RANGE_FALLBACK_MIN else sl.sl_range_min();
  // +range extends rmax ONLY for a modifiable_range spell (exact `spell_target::can_cast_at` twin) — so a live
  // range stat (buff/gear-parity) reaches farther, and a range-SHRED row (sat-floored at 0) reaches less.
  let rmax = sl.sl_range_max() + if (sl.sl_modifiable_range()) range_bonus else 0;
  (rmin, rmax, sl.sl_line_of_sight())
}

/// Is spell `i` castable at `target_cell` from `from_cell`? Distance in the effective band (Manhattan), LOS
/// clear if the spell requires it, and AP ≥ ap_cost. The single home for the per-spell fixed-cell cast rule.
fun castable_at(ap: u64, spells: &vector<SpellLevel>, i: u64, from_cell: u64, target_cell: u64, los_obstacles: &vector<u64>, range_bonus: u64): bool {
  let (rmin, rmax, needs_los) = spell_cast_band(spells, i, range_bonus);
  let d = combat_grid::manhattan(from_cell, target_cell);
  let in_range = d >= rmin && d <= rmax;
  let los_ok = !needs_los || combat_grid::line_of_sight(from_cell, target_cell, los_obstacles);
  spells.borrow(i).sl_ap_cost() <= ap && in_range && los_ok
}

/// The cell spell `i` should cast at `target_cell` from, given the mob at `from_cell` with `ap`/`mp`: `from_cell`
/// itself when already castable in place (cost 0), else the CLOSEST reachable cell inside the spell's range band
/// with clear LOS (`combat_grid::bfs_cast_cell`) — but only if the spell is even AFFORDABLE. `none` when it can't
/// be cast this turn (unaffordable, or no reachable band cell). This is the fix for the "mobs walk up but
/// never attack": a min-range or LOS-blocked spell now yields a real cast cell instead of stranding the mob.
fun cast_cell_for(ap: u64, mp: u64, spells: &vector<SpellLevel>, i: u64, from_cell: u64, target_cell: u64, move_blocked: &vector<u64>, los_obstacles: &vector<u64>, range_bonus: u64): Option<u64> {
  if (castable_at(ap, spells, i, from_cell, target_cell, los_obstacles, range_bonus)) return option::some(from_cell);
  if (spells.borrow(i).sl_ap_cost() > ap) return option::none(); // can't afford it from anywhere
  let (rmin, rmax, needs_los) = spell_cast_band(spells, i, range_bonus);
  // (c) UNREACHABLE PRE-CHECK — a free-space lower bound that SKIPS the whole ~380-cell BFS when the target is
  // simply too far. Any castable cell `c` has manhattan(c,target) ≤ rmax, so by the triangle inequality
  // manhattan(from,target) ≤ path_cost(from,c) + rmax; if manhattan(from,target) > rmax + mp then every castable
  // cell costs > mp steps ⇒ bfs_cast_cell would return `none` anyway. BEHAVIOR-NEUTRAL (identical output, no BFS).
  if (combat_grid::manhattan(from_cell, target_cell) > rmax + mp) return option::none();
  combat_grid::bfs_cast_cell(from_cell, target_cell, move_blocked, mp, rmin, rmax, needs_los, los_obstacles)
}

// ╔════════════════ [ Spawn derivation math (pure over primitives + prng) ] ═══ ]

/// Integer hp scaling `base × (0.7 + 0.7×(lvl−min)/(max−min))` (reference corpus, harvested from dungeon_mob). Degenerate
/// range → base verbatim.
public fun scaled_hp(base_hp: u64, min_level: u64, max_level: u64, level: u64): u64 {
  if (max_level == min_level) return base_hp;
  base_hp * 7 * ((max_level - min_level) + (level - min_level)) / (10 * (max_level - min_level))
}

/// SEEDED spawn-cell pick: a prng-indexed on-mask cell, walked forward past obstacles/holes/start cells.
/// Returns `(cell, advanced_state)`.
public fun seeded_spawn_cell(mask: &vector<u64>, obstacles: &vector<u64>, holes: &vector<u64>, starts: &vector<u64>, state: u64): (u64, u64) {
  let mut pool = vector[];
  let mut c = 0;
  let n = combat_grid::grid_cells();
  while (c < n) { if (combat_grid::mask_get(mask, c)) pool.push_back(c); c = c + 1; };
  let len = pool.length();
  let (state, idx0) = prng::rng_int(state, len);
  let mut j = 0;
  loop {
    let cell = *pool.borrow((idx0 + j) % len);
    if (!obstacles.contains(&cell) && !holes.contains(&cell) && !starts.contains(&cell)) return (cell, state);
    j = j + 1;
  }
}

/// The `&mut u64` draw-chain twin of `seeded_spawn_cell` (verbatim `clamp_spawn_cell` from `aresrpg::mob`).
public fun draw_spawn_cell(mask: &vector<u64>, obstacles: &vector<u64>, holes: &vector<u64>, starts: &vector<u64>, rng: &mut u64): u64 {
  let mut pool = vector[];
  let mut c = 0;
  let n = combat_grid::grid_cells();
  while (c < n) { if (combat_grid::mask_get(mask, c)) pool.push_back(c); c = c + 1; };
  let len = pool.length();
  let idx0 = prng::draw(rng) % len;
  let mut j = 0;
  loop {
    let cell = *pool.borrow((idx0 + j) % len);
    if (!obstacles.contains(&cell) && !holes.contains(&cell) && !starts.contains(&cell)) return cell;
    j = j + 1;
  }
}
