// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// EVENTS — the single home for every Kolizeum lobby lifecycle event (§7 observability — the RPC indexer + the
/// client's optimistic reconciliation feed). One module so the indexer watches one file for the whole lobby
/// contract. Every money-moving transition has an event: created / joined / exited / cancelled / started /
/// settled / swept. All emit fns are `public(package)` — fired by `kolizeum`.
module aresrpg_kolizeum::kolizeum_events;

use sui::event;

public struct KolizeumCreated has copy, drop {
  kolizeum: ID,
  creator: address,
  format_slots: u64,
  pledge_amount: u64,
  is_public: bool,
}
public struct KolizeumJoined has copy, drop { kolizeum: ID, fighter: address, character: ID, side: u8, join_order: u64 }
public struct KolizeumExited has copy, drop { kolizeum: ID, fighter: address, refund: u64 }
public struct KolizeumCancelled has copy, drop { kolizeum: ID, refunded_total: u64 }
public struct KolizeumStarted has copy, drop { kolizeum: ID, side_a: u64, side_b: u64 }
/// A WON pot resolved: `pot` = the GROSS pot; `fee` = the 10% platform cut routed to `@treasury`; `winners` split
/// the `pot − fee` net. `fee` is a NEW field (the treasury split) — indexer re-point.
public struct KolizeumSettled has copy, drop { kolizeum: ID, winning_side: u8, pot: u64, fee: u64, winners: u64 }
/// A mutual-wipe DRAW (§17.9): the fight ended with no winning side, so every pledge is refunded (not paid to a
/// winner) — a distinct terminal from `KolizeumSettled` (a winner took the pot) and `KolizeumCancelled` (never
/// fought). The indexer shows "your pledge was refunded — the fight was a draw."
public struct KolizeumDrawn has copy, drop { kolizeum: ID, refunded_total: u64 }
public struct KolizeumSwept has copy, drop { kolizeum: ID }
/// A seat's arena `FightOutcome` was consumed at the `open` terminal (storage rebate; zero xp/loot by §17.9).
public struct KolizeumOutcomeOpened has copy, drop { fight: ID, character: ID }

public(package) fun emit_created(kolizeum: ID, creator: address, format_slots: u64, pledge_amount: u64, is_public: bool) {
  event::emit(KolizeumCreated { kolizeum, creator, format_slots, pledge_amount, is_public });
}
public(package) fun emit_joined(kolizeum: ID, fighter: address, character: ID, side: u8, join_order: u64) {
  event::emit(KolizeumJoined { kolizeum, fighter, character, side, join_order });
}
public(package) fun emit_exited(kolizeum: ID, fighter: address, refund: u64) {
  event::emit(KolizeumExited { kolizeum, fighter, refund });
}
public(package) fun emit_cancelled(kolizeum: ID, refunded_total: u64) {
  event::emit(KolizeumCancelled { kolizeum, refunded_total });
}
public(package) fun emit_started(kolizeum: ID, side_a: u64, side_b: u64) {
  event::emit(KolizeumStarted { kolizeum, side_a, side_b });
}
public(package) fun emit_settled(kolizeum: ID, winning_side: u8, pot: u64, fee: u64, winners: u64) {
  event::emit(KolizeumSettled { kolizeum, winning_side, pot, fee, winners });
}
public(package) fun emit_drawn(kolizeum: ID, refunded_total: u64) { event::emit(KolizeumDrawn { kolizeum, refunded_total }); }
public(package) fun emit_swept(kolizeum: ID) { event::emit(KolizeumSwept { kolizeum }); }
public(package) fun emit_outcome_opened(fight: ID, character: ID) { event::emit(KolizeumOutcomeOpened { fight, character }); }
