// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// POOL — the constant-product AMM for one STACKABLE item template vs SUI. ONE pool per template, its object id
/// DERIVED from the template id under a shared `PoolRegistry` gate, so a second pool for the same template is
/// impossible (the claim aborts) and no `Coin<T>` per resource is ever needed — template-id keying gives
/// unlimited sub-typing for free (§11, D-batch #2 ruling).
///
/// THE CURVE (§17.24): constant product `x·y = k`, where `x` = the pool's ITEM COUNT (`item_reserve`, a pure
/// ledger — see the seams) and `y` = `virtual_sui + real_sui`. The admin-set `virtual_sui` defines the STARTING
/// price mathematically; it is NOT a floor and NEVER pays out (under constant product, heavy selling still sinks
/// the quote). Buys inject REAL SUI into `real_sui`; sells draw from `real_sui` ONLY and REVERT cleanly
/// (`ENoDemandYet`, "no demand yet") when real reserves can't cover the draw. Price quotes read `virtual + real`.
///   BUY  n out: `dx = y·n/(x−n)` rounded UP   (pool-favored — the buyer never underpays); real += dx.
///   SELL n in : `dy = y·n/(x+n)` rounded DOWN (pool-favored — the seller never overdraws); 10% of dy → @treasury,
///               90% → the seller; the whole dy leaves `real_sui`.
/// Round-trip is loss-only (dx up, dy down, minus royalty) — provably NO FREE SUI, and `virtual_sui` is a plain
/// `u64` constant that is never a `Balance`, so it can never be paid out by construction.
///
/// Kiosk-native lots supersede the executable pool. A fresh publish exposes no create, pause, buy, or sell door;
/// only the clean pool types, pure quotes, getters, and private money core remain. The private core is reachable
/// from test-only drivers, never from a production transaction surface.
///
/// PLACEMENT-BY-RESPONSIBILITY: the "one pool per template" uniqueness is the REGISTRY's; the curve params are
/// the POOL's and immutable after construction (a live virtual-reserve tweak would instantly reprice the pool =
/// a rug vector). The retained quote math continues to model the sealed fields exactly.
module aresrpg_gifting::pool;

use aresrpg::version::Version;
use sui::{balance::{Self, Balance}, coin::{Self, Coin}, derived_object, event, sui::SUI, tx_context::sender};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ROYALTY_BPS: u64 = 1_000; // 10% royalty on SELLS (mirrors the kiosk 1000-bp convention)
const BPS_DENOM: u64 = 10_000;

const EInvalidQuantity: u64 = 101; // buy/sell/quote: quantity is 0
const EInsufficientLiquidity: u64 = 102; // buy: quantity >= item_reserve (a pool can never be drained to empty)
const EInsufficientPayment: u64 = 103; // buy: payment is below the buy quote
const ENoDemandYet: u64 = 104; // sell: real SUI reserves can't cover the draw ("no demand yet" — §11)
const EPoolPaused: u64 = 105; // buy/sell: the pool is paused (emergency stop)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The shared derived-object GATE: every `Pool`'s UID is claimed from `PoolKey(template)` under this registry,
/// so pool ids are deterministic from the template id and duplicates are impossible. Seeded once at publish.
///
/// S-46: the two custodied caps (NS_MINT / NS_BURN) are GONE — `buy`/`sell` call the `public(package)`
/// `extension::mint_item_stack` / `extract::burn` doors directly. The registry stays as the derivation parent.
public struct PoolRegistry has key {
  id: UID,
}

/// Keys a pool's derived address by the stackable item TEMPLATE id. `copy + drop + store` (derived-object law).
public struct PoolKey(ID) has copy, drop, store;

/// A constant-product AMM pool for `template` vs SUI. `item_reserve` = `x` (the item COUNT ledger — buys mint it
/// down, sells burn it up via the seams); `virtual_sui` = the constant virtual reserve that defines the starting
/// price and NEVER pays out; `real_sui` = `y_real`, the ONLY payout source for sells. `paused` = emergency stop.
/// Curve params are set at bootstrap and immutable thereafter (see module doc).
public struct Pool has key {
  id: UID,
  template: ID,
  item_reserve: u64,
  virtual_sui: u64,
  real_sui: Balance<SUI>,
  paused: bool,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct PoolBuy has copy, drop {
  pool: ID,
  template: ID,
  buyer: address,
  quantity: u64,
  sui_in: u64,
  item_reserve: u64,
  real_sui: u64,
}

public struct PoolSell has copy, drop {
  pool: ID,
  template: ID,
  seller: address,
  quantity: u64,
  gross: u64,
  royalty: u64,
  net: u64,
  item_reserve: u64,
  real_sui: u64,
}

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(PoolRegistry { id: object::new(ctx) });
}

// ╔════════════════ [ Quotes — pure views (RPC/SDK read these; == execution) ] ═ ]

/// The pool's TOTAL SUI reserve on the curve: virtual (constant, price-setting) + real (accumulated from buys).
public fun sui_reserve(pool: &Pool): u64 { pool.virtual_sui + pool.real_sui.value() }

/// SUI the buyer PAYS for `n` items out — `dx = y·n/(x−n)`, rounded UP (pool-favored). Aborts
/// `EInsufficientLiquidity` if `n >= item_reserve` (the last unit is unbuyable — price → ∞ protects the pool).
/// `mul_div_ceil` upcasts to u128 internally, so `y·n` cannot overflow.
public fun buy_quote(pool: &Pool, n: u64): u64 {
  assert!(n >= 1, EInvalidQuantity);
  assert!(n < pool.item_reserve, EInsufficientLiquidity);
  pool.sui_reserve().mul_div_ceil(n, pool.item_reserve - n)
}

/// GROSS SUI for `n` items in — `dy = y·n/(x+n)`, rounded DOWN (pool-favored). The 10% royalty comes out of this;
/// `sell_quote` returns the seller's NET. Pure curve math — it does NOT check real reserves (execution reverts
/// `ENoDemandYet` if real can't cover); this is the price you'd get IF there is demand.
public fun sell_quote_gross(pool: &Pool, n: u64): u64 {
  assert!(n >= 1, EInvalidQuantity);
  pool.sui_reserve().mul_div(n, pool.item_reserve + n)
}

/// NET SUI the seller RECEIVES for `n` items in — gross minus the 10% royalty. Equals the seller's payout in
/// `sell` exactly (quote == execution).
public fun sell_quote(pool: &Pool, n: u64): u64 {
  let gross = pool.sell_quote_gross(n);
  gross - royalty_of(gross)
}

/// The 10% sell royalty on a gross amount (rounded down, mirrors kiosk 1000-bp math).
public fun royalty_of(gross: u64): u64 { gross.mul_div(ROYALTY_BPS, BPS_DENOM) }

/// Marginal spot price in MIST per 1 item (`y/x`, floored) — a convenience for UI; real trades use the quotes.
public fun spot_price_mist(pool: &Pool): u64 { pool.sui_reserve() / pool.item_reserve }

// ╔════════════════ [ BUY / SELL money core (SUI + ledger + royalty; item objects via the seams) ] ═ ]

/// The BUY body: SUI in, `quantity` items out. Enforces (all before money moves — refusal costs only gas):
/// enabled+latest → not paused → `1 <= quantity < item_reserve` → payment ≥ the buy quote. Then splits the exact
/// quote into `real_sui` (buys FUND the pool; NO royalty on buys), refunds change once, and moves the item ledger
/// down via `mint_items_out`. `self_transfer` is deliberate: only the SUI CHANGE is address-sent.
///
/// This private core owns the SUI + ledger + royalty math and is reached only by the money-only test driver
/// (`buy_for_testing`). `self_transfer` is deliberate: only the SUI CHANGE is address-sent. The item ledger moves
/// here so quote == execution holds for the retained model.
#[allow(lint(self_transfer))]
fun buy_internal(pool: &mut Pool, quantity: u64, mut payment: Coin<SUI>, version: &Version, ctx: &mut TxContext) {
  version.assert_enabled();
  assert!(!pool.paused, EPoolPaused);
  let pid = object::id(pool);
  let dx = pool.buy_quote(quantity); // asserts quantity in [1, item_reserve)
  assert!(payment.value() >= dx, EInsufficientPayment);

  let paid = payment.split(dx, ctx);
  pool.real_sui.join(paid.into_balance());

  let buyer = sender(ctx);
  // ONLY the SUI change (a fungible coin) is ever address-sent — never an item.
  if (payment.value() == 0) payment.destroy_zero() else transfer::public_transfer(payment, buyer);

  pool.item_reserve = pool.item_reserve - quantity; // ledger DOWN (buy_quote proved quantity < item_reserve)
  event::emit(PoolBuy {
    pool: pid,
    template: pool.template,
    buyer,
    quantity,
    sui_in: dx,
    item_reserve: pool.item_reserve,
    real_sui: pool.real_sui.value(),
  });
}

/// The SELL body: `quantity` items in, SUI out. Enforces: enabled+latest → not paused → `quantity >= 1` → real
/// reserves COVER the gross draw (`ENoDemandYet` otherwise — the virtual reserve never pays out). Then draws the
/// gross from `real_sui`, splits 10% to `@treasury` and the 90% net to the seller, and moves the item ledger up
/// via `absorb_items_in`. `self_transfer` is deliberate: the seller's net is address-sent (they are the sender).
#[allow(lint(self_transfer))]
fun sell_internal(pool: &mut Pool, quantity: u64, version: &Version, ctx: &mut TxContext) {
  version.assert_enabled();
  assert!(!pool.paused, EPoolPaused);
  let pid = object::id(pool);
  let gross = pool.sell_quote_gross(quantity); // asserts quantity >= 1
  // The WHOLE gross (seller net + royalty) leaves real_sui — so real must cover gross, or revert cleanly.
  assert!(pool.real_sui.value() >= gross, ENoDemandYet);
  let royalty = royalty_of(gross);
  let seller = sender(ctx);

  let mut out = pool.real_sui.split(gross); // Balance<SUI>; gross <= real (asserted above)
  let roy = out.split(royalty); // the 10% royalty portion
  transfer::public_transfer(coin::from_balance(roy, ctx), @treasury);
  transfer::public_transfer(coin::from_balance(out, ctx), seller); // net = gross - royalty

  pool.item_reserve = pool.item_reserve + quantity; // ledger UP (the seller's burned units re-enter the curve)
  event::emit(PoolSell {
    pool: pid,
    template: pool.template,
    seller,
    quantity,
    gross,
    royalty,
    net: gross - royalty,
    item_reserve: pool.item_reserve,
    real_sui: pool.real_sui.value(),
  });
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun template(pool: &Pool): ID { pool.template }

public fun item_reserve(pool: &Pool): u64 { pool.item_reserve }

public fun virtual_sui(pool: &Pool): u64 { pool.virtual_sui }

public fun real_sui(pool: &Pool): u64 { pool.real_sui.value() }

public fun is_paused(pool: &Pool): bool { pool.paused }

/// The deterministic pool address for a template under `registry` (RPC derives it without an event scan).
public fun pool_address(registry: &PoolRegistry, template: ID): address {
  derived_object::derive_address(object::id(registry), PoolKey(template))
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

#[test_only]
/// Fixture-only constructor for the retained quote and money-core tests. Stripped from published bytecode.
public fun create_pool_for_testing(
  registry: &mut PoolRegistry,
  template: ID,
  item_stock: u64,
  virtual_sui: u64,
  ctx: &TxContext,
) {
  let pool = Pool {
    id: derived_object::claim(&mut registry.id, PoolKey(template)),
    template,
    item_reserve: item_stock,
    virtual_sui,
    real_sui: balance::zero(),
    paused: false,
  };
  transfer::share_object(pool);
}

#[test_only]
/// Drive the BUY money core (real `&Random` is irrelevant — resources carry no rolled stats). The seller/buyer
/// SUI + ledger + royalty run through the retained private core.
public fun buy_for_testing(pool: &mut Pool, quantity: u64, payment: Coin<SUI>, version: &Version, ctx: &mut TxContext) {
  buy_internal(pool, quantity, payment, version, ctx);
}

#[test_only]
/// Drive the SELL money core.
public fun sell_for_testing(pool: &mut Pool, quantity: u64, version: &Version, ctx: &mut TxContext) {
  sell_internal(pool, quantity, version, ctx);
}
