// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Deterministic seeded PRNG (mulberry32) — faithful Move port of packages/sim/src/prng.js.
///
/// DETERMINISM IS LAW. The JS keeps state as a 32-bit value and uses `Math.imul` (wrapping 32-bit
/// multiply) + `>>> 0` (uint32 reinterpret). Move's native u32 ABORTS on overflow, so we hold every
/// 32-bit value in a u64 and mask to 32 bits (& MASK32) after each add/mul — identical low-32-bit
/// arithmetic, no overflow abort. Same seed -> byte-identical sequence as the JS sim, on every machine.
module aresrpg_foundation::prng;

/// Low 32 bits mask — the wrapping boundary that replaces JS `| 0` / `>>> 0`.
const MASK32: u64 = 0xFFFFFFFF;

/// Advance the PRNG once. Returns `(new_state, value)` where `value` is a uint32 in [0, 2^32).
/// Mirrors prng.js `rng_next`: a = (state + 0x6d2b79f5); t = imul(a^(a>>15), 1|a);
/// t = (t + imul(t^(t>>7), 61|t)) ^ t; value = t ^ (t>>14). state advances to `a`.
public fun rng_next(state: u64): (u64, u64) {
    let a = (state + 0x6d2b79f5) & MASK32;
    let t0 = (a ^ (a >> 15)) & MASK32;
    let mut t = (t0 * (1 | a)) & MASK32;
    let m = (((t ^ (t >> 7)) & MASK32) * (61 | t)) & MASK32;
    t = ((t + m) & MASK32) ^ t;
    let value = (t ^ (t >> 14)) & MASK32;
    (a, value)
}

/// Seed the PRNG from any 32-bit integer (prng.js `rng_seed`: `seed >>> 0`).
public fun rng_seed(seed: u64): u64 {
    seed & MASK32
}

/// The fight resolve-chain entropy carrier: next draw, advancing the plain-u64 state IN PLACE (S-46: verbatim
/// move of `aresrpg::rng::draw` — every entry draws ONE seed from `&Random` and the whole resolve chain threads
/// this, so a fight turn is exactly replayable from its seed). NOTE the shipped binding order is preserved
/// verbatim (returns the first tuple element, stores the second) — the JS twin threads the same stream, and the
/// zero-behavior-delta law forbids "fixing" it here.
public fun draw(state: &mut u64): u64 {
    let (v, s) = rng_next(*state);
    *state = s;
    v
}

/// Draw an integer in [0, n). `n` must be positive (prng.js `rng_int`).
public fun rng_int(state: u64, n: u64): (u64, u64) {
    let (next_state, value) = rng_next(state);
    (next_state, value % n)
}

/// Draw an integer in [min, max] inclusive. Requires `min <= max` (prng.js `rng_range`).
public fun rng_range(state: u64, min: u64, max: u64): (u64, u64) {
    let span = max - min + 1;
    let (next_state, value) = rng_int(state, span);
    (next_state, min + value)
}

// ╔════════════════ [ Stateless derivation (turn-seed crit/damage slots) ] ═══ ]

/// One-shot 32-bit avalanche of `seed` — mulberry32's scrambler used as a HASH, not a stream. The building block
/// for deriving DECORRELATED sub-seeds (per-turn crit/damage stream picks) from combined inputs. Same
/// 32-bit-wrapping arithmetic as `rng_next`, so the JS mirror is byte-identical: `rng_next(seed >>> 0).value`.
public fun scramble(seed: u64): u64 {
    let (_next, value) = rng_next(seed & MASK32);
    value
}

/// Fold `x` into a 32-bit accumulator: wrapping-add then `scramble`. Order-sensitive input combiner — build a
/// seed from several values with `mix(mix(a, b), c)`. Each fold avalanches, so distinct input tuples collide
/// only at the scrambler's 1-in-2^32 rate (no additive `(seat, deadline)` cancellation). JS mirror:
/// `rng_next((((acc & MASK32) + (x & MASK32)) >>> 0)).value`.
public fun mix(acc: u64, x: u64): u64 {
    // #574: mask full-u64 provenance before Move's checked add so the 32-bit fold wraps like the JS twin
    // instead of aborting before a post-add mask can run.
    scramble(((acc & MASK32) + (x & MASK32)) & MASK32)
}

#[test]
fun prng_matches_js_reference() {
    // Reference vectors captured LIVE from packages/sim/src/prng.js (the determinism contract — the
    // Move port MUST be byte-identical or every on-chain roll desyncs from the client prediction):
    //   rng_seed(0); next ->(state,value) x4:
    //     1831565813,1144304738 | 3663131626,1416247 | 1199730143,958946056 | 3031295956,627933444
    let s = rng_seed(0);
    let (s, v0) = rng_next(s);
    assert!(s == 1831565813 && v0 == 1144304738, 0);
    let (s, v1) = rng_next(s);
    assert!(s == 3663131626 && v1 == 1416247, 1);
    let (s, v2) = rng_next(s);
    assert!(s == 1199730143 && v2 == 958946056, 2);
    let (_s, v3) = rng_next(s);
    assert!(v3 == 627933444, 3);

    // rng_range(seed 12345, 1, 100) == 70 ; rng_int(seed 999, 6) == 1
    let (_s, r) = rng_range(rng_seed(12345), 1, 100);
    assert!(r == 70, 4);
    let (_s, i) = rng_int(rng_seed(999), 6);
    assert!(i == 1, 5);
}

#[test]
fun scramble_and_mix_are_deterministic() {
    // scramble(0) == rng_next(0).value (the reference vector above) — the mirror pins this exact value.
    assert!(scramble(0) == 1144304738, 0);
    assert!(mix(0, 0) == 1144304738, 1); // mix(acc,0) == scramble(acc)
    // pure + deterministic: same inputs -> same output, adjacent inputs -> different output (avalanche).
    assert!(scramble(1) == scramble(1), 2);
    assert!(scramble(0) != scramble(1), 3);
    assert!(mix(mix(7, 3), 9) == mix(mix(7, 3), 9), 4);
    assert!(mix(mix(7, 3), 9) != mix(mix(7, 9), 3), 5); // chained folds are order-sensitive (avalanche per step)
}

#[test]
fun mix_masks_degenerate_u64_before_add() {
    // The old checked `1 + u64::MAX` aborted before its post-add mask; both twins wrap the low 32 bits to zero.
    assert!(mix(1, 18_446_744_073_709_551_615) == 1144304738, 0);
}
