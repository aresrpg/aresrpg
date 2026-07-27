// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FIGHT MARKER — the "unfinished business" DIRTY COUNTER.
///
/// A PvM fight increments the character's pending-obligations counter at SEAT time; it decrements ONLY when the
/// owner OPENS the fight's result — so a defeated player cannot dodge the 0-HP landing by never opening (§7
/// "defeat returns you out at 0 HP"), and cannot park the debt: a character with a NON-ZERO counter can neither
/// enter another fight nor complete a SALE (the listing rule reads it — the cross-party brick a held debt could
/// create is closed at the purchase gate). This is a general `u64` obligations counter (other
/// future actions may add to it); every gate asserts it is ZERO.
///
/// S-46: the cross-package `ExtensionCap` authority is gone — `mark`/`clear` are `public(package)` (only the
/// fight seat paths + `results::open`, same package, reach them). The counter lives under NS_CHARACTER_PROGRESSION
/// on the Character. Reads are FREE (any module, the RPC, the listing rule). CONCURRENCY (one live fight at a
/// time) stays the fight registry's latch — two mechanisms: the latch dies with the fight, the counter with the OPEN.
module aresrpg::fight_marker;

use aresrpg::{character::Character, extension, version::Version};

const ENotMarked: u64 = 103; // clear: nothing to clear (results gate on `rolled` — a double-open cannot happen — so this is defensive)

/// The namespaced DF key. Present ⇒ the character owes ≥1 pending resolution; the stored `u64` is the count.
public struct DirtyKey has copy, drop, store {}

/// INCREMENT the pending-obligations counter (a PvM seat). First mark creates the slot at 1. NS_CHARACTER_PROGRESSION
/// home; `public(package)` — the fight seat paths call it (they pre-check `is_unmarked`, so today the count is 0→1,
/// but the counter shape lets other obligations stack).
public(package) fun mark(character: &mut Character, version: &Version) {
  let ns = extension::z31();
  if (extension::z29(character, ns, DirtyKey {})) {
    let slot: &mut u64 = extension::z24(ns, character, DirtyKey {}, version);
    *slot = *slot + 1;
  } else {
    extension::z23(ns, character, DirtyKey {}, 1u64, version);
  };
}

/// DECREMENT the counter (a result OPEN — the only discharge: opening lands the XP/HP truth first). Aborts if
/// already zero (`ENotMarked`, defensive). Removes the slot at zero so a clean character carries no DF.
public(package) fun clear(character: &mut Character, version: &Version) {
  let ns = extension::z31();
  assert!(extension::z29(character, ns, DirtyKey {}), ENotMarked);
  let remaining = {
    let slot: &mut u64 = extension::z24(ns, character, DirtyKey {}, version);
    *slot = *slot - 1;
    *slot
  };
  if (remaining == 0) { let _: u64 = extension::z25(ns, character, DirtyKey {}, version); };
}

/// FREE read: the character's pending-obligations count (0 when clean). Seat pre-flight, the listing rule, RPC.
public fun pending_obligations(c: &Character): u64 {
  let ns = extension::z31();
  if (extension::z29(c, ns, DirtyKey {})) {
    *extension::z30<DirtyKey, u64>(c, ns, DirtyKey {})
  } else 0
}

/// Convenience for gates: is the character free of unfinished business? (Every gated action asserts this.)
public fun is_unmarked(c: &Character): bool { pending_obligations(c) == 0 }

#[test_only]
/// Sibling test suites (forge split) mark a character dirty to drive their EDirty walls — test builds only,
/// stripped from every publish.
public fun mark_for_testing(character: &mut Character, version: &Version) { mark(character, version) }
