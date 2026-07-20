/// CHECKPOINT — the proof-of-time value type + travel-verification math (§5, §17.2/.3). A `Checkpoint` is the
/// "proven position + proven time" a character stamps on every position-proving action (world join, zone
/// discovery, gather, world-fight entry); it lives as a PER-WORLD dynamic field on the Character (attached through
/// `character_link` — this module is a pure LEAF and owns only the TYPE + the math, never a Character reference).
///
/// The verification is the heart of the anti-teleport model: the distance from your last checkpoint to where you
/// act must be coverable in the elapsed time at the world's `speed_budget`, with a ×1.5 MOUNT allowance applied
/// ONLY when a pet was equipped at BOTH ends of the interval (§17.2 — the stored flag AND the now flag). Distance
/// is 2D euclidean over (x,z); the check compares SQUARED distance against SQUARED budget (integer math, no sqrt,
/// exact). Overflow is impossible by construction: a budget that dwarfs any in-world distance short-circuits to
/// ACCEPT before squaring, and a pathological elapsed saturates the budget (§17.10 overflow-proof law).
///
/// TEACH, DON'T REJECT (§5): `verify_travel` aborts with DISTINCT codes the frontend maps to human copy, and the
/// PUBLIC PURE `wait_seconds` lets the UI say exactly "wait Ns" — never a bare error. Error codes for the frontend:
///   • `ECheckpointFuture` (101) — the clock is BEFORE your last checkpoint (never happens on a healthy chain;
///     surface as a transient "clock desync, retry").
///   • `ETravelTooFar` (102) — you asked to act farther than the budget allows for the elapsed time. This is the
///     "you rode far then unequipped your pet" case: show `wait_seconds(...)` — "re-equip your pet, or wait Ns".
module aresrpg::checkpoint;

use aresrpg::world::{Self, World};
use aresrpg_foundation::world_math;

// ╔════════════════ [ Errors (documented for the frontend in the module header) ] ═ ]

const ECheckpointFuture: u64 = 101;
const ETravelTooFar: u64 = 102;

// ╔════════════════ [ Type ] ═════════════════════════════════════════════════ ]

/// Proven position + proven time + the pet-equipped SNAPSHOT taken at the WRITE (the only verifiable form of the
/// "both ends" mount rule — §17.2). `copy + drop + store`: it rides as a DF value and passes by value freely.
public struct Checkpoint has store, copy, drop {
  x: u32,
  z: u32,
  time_ms: u64,
  pet_equipped: bool,
}

public(package) fun new_checkpoint(x: u32, z: u32, time_ms: u64, pet_equipped: bool): Checkpoint {
  Checkpoint { x, z, time_ms, pet_equipped }
}

public fun x(cp: &Checkpoint): u32 { cp.x }
public fun z(cp: &Checkpoint): u32 { cp.z }
public fun time_ms(cp: &Checkpoint): u64 { cp.time_ms }
public fun pet_equipped(cp: &Checkpoint): bool { cp.pet_equipped }

// ╔════════════════ [ Verification (abort form — the value-path gate) ] ═══════ ]

/// Abort unless traveling from `cp` to `(to_x, to_z)` by `now_ms` is physically plausible at the world's speed
/// budget. `pet_both` MUST already fold "pet equipped at both ends" (`cp.pet_equipped && pet_now`); the caller
/// owns reading the live pet flag. Non-punitive by design: elapsed only grows, so a refused caller waits and
/// retries (§17.3) — see `wait_seconds`.
public fun verify_travel(w: &World, cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool) {
  assert!(now_ms >= cp.time_ms, ECheckpointFuture);
  assert!(travel_ok(w, cp, to_x, to_z, now_ms, pet_both), ETravelTooFar);
}

/// The boolean core (also the test oracle). `true` iff the move is coverable. Same math as `verify_travel`,
/// exposed for callers that want to branch rather than abort.
public fun travel_ok(w: &World, cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool): bool {
  world_math::travel_ok(world::speed_budget(w), cp.x, cp.z, cp.time_ms, to_x, to_z, now_ms, pet_both)
}

// ╔════════════════ [ wait_seconds (public pure UI helper — teach, don't reject) ] ═ ]

/// How many MORE seconds until the move becomes legal (0 if already legal). The UI reads this to say "wait Ns".
/// Uses an integer sqrt for the linear distance (non-consensus — the abort path stays exact via squared compare),
/// so it may be off by <1 block; that is fine for a countdown. `pet_both` mirrors the check's mount rule.
public fun wait_seconds(w: &World, cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool): u64 {
  world_math::wait_seconds(world::speed_budget(w), cp.x, cp.z, cp.time_ms, to_x, to_z, now_ms, pet_both)
}
