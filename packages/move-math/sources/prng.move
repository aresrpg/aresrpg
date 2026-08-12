// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Deterministic seeded PRNG (mulberry32) — byte-identical to the client sim's prng.js.
/// NEVER an entropy source (ruling 2026-08-09): entropy always comes from Sui's Random. This
/// module only EXPANDS already-stored seeds where both chain and client must compute the same
/// result: zone derivation reads, and the fight's single-turn streams (damage, crit, tackle,
/// dodge). The JS twin wraps 32-bit math (`imul`, `>>> 0`); Move's u32 aborts on overflow, so
/// every value lives in a u64 masked to 32 bits — same seed, identical sequence, everywhere.
module aresrpg_math::prng;

/// Low 32 bits mask — the wrapping boundary that replaces JS `| 0` / `>>> 0`.
const MASK32: u64 = 0xFFFFFFFF;

/// Advance once. Returns `(new_state, value)`, value a uint32 in [0, 2^32).
public fun rng_next(state: u64): (u64, u64) {
  let a = (state + 0x6d2b79f5) & MASK32;
  let t0 = (a ^ (a >> 15)) & MASK32;
  let mut t = (t0 * (1 | a)) & MASK32;
  let m = (((t ^ (t >> 7)) & MASK32) * (61 | t)) & MASK32;
  t = ((t + m) & MASK32) ^ t;
  let value = (t ^ (t >> 14)) & MASK32;
  (a, value)
}

/// Seed from any 32-bit integer (JS `seed >>> 0`).
public fun rng_seed(seed: u64): u64 {
  seed & MASK32
}

/// Next draw, advancing the state in place — the resolve-chain entropy carrier. `rng_next`
/// returns `(new_state, value)` — bind them in THAT order (the 2026-08-10 audit caught them
/// swapped, which turned every draw into a linear increment and broke the JS twin parity).
public fun draw(state: &mut u64): u64 {
  let (s, v) = rng_next(*state);
  *state = s;
  v
}

/// Draw an integer in [0, n). `n` must be positive.
public fun rng_int(state: u64, n: u64): (u64, u64) {
  let (next_state, value) = rng_next(state);
  (next_state, value % n)
}

/// Draw an integer in [min, max] inclusive. Requires `min <= max`.
public fun rng_range(state: u64, min: u64, max: u64): (u64, u64) {
  let span = max - min + 1;
  let (next_state, value) = rng_int(state, span);
  (next_state, min + value)
}

/// One-shot 32-bit avalanche — mulberry32's scrambler as a HASH for decorrelated sub-seeds.
public fun scramble(seed: u64): u64 {
  let (_next, value) = rng_next(seed & MASK32);
  value
}

/// Order-sensitive input combiner: `mix(mix(a, b), c)`. Masks before the add so degenerate
/// u64 inputs wrap like the JS twin instead of aborting.
public fun mix(acc: u64, x: u64): u64 {
  scramble(((acc & MASK32) + (x & MASK32)) & MASK32)
}
