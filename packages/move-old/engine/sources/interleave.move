// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// INTERLEAVE — §17.28 GLOBAL turn order (no initiative stat). All fighters weave into ONE deterministic
/// sequence that alternates the two sides as evenly as unequal team sizes allow; join/spawn order fixes the
/// order WITHIN a side. Replaces the harvested dungeon HP-ranked queue (1.29 has no initiative; agility feeds
/// crit only). Defined BEFORE kolizeum money ships. Owns the `Actor` type (a leaf — nothing imports back, so
/// no cycle with `fight`, which holds the produced `vector<Actor>` as its turn queue).
///
/// ┌─ THE ALGORITHM (pure — no RNG, no clock; deterministic by construction) ───────────────────────────────┐
/// │ Inputs: `side_a` (the players' side, in join order) and `side_b` (the mobs' side, in spawn order), each  │
/// │ a `vector<Actor>`. Output: one `vector<Actor>` of length |a|+|b|. At each output slot we have emitted    │
/// │ `ia` from A and `ib` from B; emit from A iff A is no further along its share than B at the SLOT MIDPOINT:│
/// │                        (2·ia + 1)·|b|  ≤  (2·ib + 1)·|a|                                                 │
/// │ (integer cross-multiply of the midpoint fractions (2·ia+1)/(2|a|) vs (2·ib+1)/(2|b|) — the standard even │
/// │ / Euclidean interleave; centers the minority instead of front-loading it). Equality → A (the fight       │
/// │ initiator's side goes first, a fixed deterministic tie-break). Once one side is exhausted the other       │
/// │ drains in order. PROPERTIES (proven in tests): equal teams → strict A,B,A,B…; a minority side's turns are │
/// │ spread as evenly as possible and it NEVER takes two turns in a row (no solo-wrap turn-farming); the       │
/// │ majority never stalls the minority into a hopeless undermanned round. Same inputs → same queue, forever. │
/// └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
module aresrpg_fight::interleave;

// ╔════════════════ [ Actor ] ════════════════════════════════════════════════ ]

/// One turn-queue slot: a player SEAT (`is_mob=false`, `idx`=seat) or a MOB (`is_mob=true`, `idx`=mob index).
/// `copy+drop+store` so it rides the Fight's stored queue and passes around freely.
public struct Actor has copy, drop, store { is_mob: bool, idx: u64 }

public(package) fun new_player_actor(seat: u64): Actor { Actor { is_mob: false, idx: seat } }
public(package) fun new_mob_actor(idx: u64): Actor { Actor { is_mob: true, idx } }
public(package) fun actor_is_mob(a: &Actor): bool { a.is_mob }
public(package) fun actor_idx(a: &Actor): u64 { a.idx }

// ╔════════════════ [ The interleave ] ═══════════════════════════════════════ ]

/// Weave `side_a` (players, join order) and `side_b` (mobs, spawn order) into the global turn queue per the
/// documented even-distribution rule. Pure + total. `O((a+b))`, bounded by 2·MAX_SEATS + MAX_MOBS.
public(package) fun order(side_a: vector<Actor>, side_b: vector<Actor>): vector<Actor> {
  let a = side_a.length();
  let b = side_b.length();
  let mut out = vector[];
  let mut ia = 0;
  let mut ib = 0;
  while (ia < a || ib < b) {
    let take_a = if (ia >= a) false
      else if (ib >= b) true
      // both sides still have actors: emit A iff A is no further along its share at the slot midpoint.
      else (2 * ia + 1) * b <= (2 * ib + 1) * a;
    if (take_a) { out.push_back(*side_a.borrow(ia)); ia = ia + 1; }
    else { out.push_back(*side_b.borrow(ib)); ib = ib + 1; };
  };
  out
}
