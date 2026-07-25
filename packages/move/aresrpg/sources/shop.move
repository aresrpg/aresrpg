// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SHOP — the SALE GATE that owns supply, price, an optional time window, and pause. A `Sale` is a shared
/// vending machine for one item template; `buy` mints ONE item and `buy_many` mints N — each mints through the
/// ONE gear-mint door (`extension::mint_item`, which ROLLS the template's [min,max] ranges off the seed this call
/// draws) and LOCKS the item(s) straight into the buyer's PERSONAL kiosk — all in ONE terminal call. Items never
/// touch a raw address — only the SUI change does.
///
/// PLACEMENT-BY-RESPONSIBILITY: the supply cap lives HERE, on the gate that owns the "how many may be sold"
/// decision — NOT on the item template (a future mob-loot gate has no supply cap at all). Price, the time window
/// and pause are the sale's too. The item base stays pure data. Authority is the package's ONE `AdminCap`
/// (shared with the authoring surface) — no second cap type.
///
/// SINGLE-STEP RANDOMNESS (per docs.sui.io on-chain randomness — the documented DEFAULT, not commit-reveal):
/// `buy`/`buy_many` consume `&Random` to roll stats, so they are private `entry` (the framework REJECTS `public`
/// functions taking `Random`, and Sui rejects any PTB command other than `TransferObjects`/`MergeCoins` after a
/// `MoveCall` that used `Random`). Both obey it: they are `entry` (not `public`), return NOTHING, and the
/// roll → attach → kiosk-lock all happen INSIDE the one call — so each is the TERMINAL command with no result to
/// chain a test-and-abort on. THE MULTI-BUY LAW: `buy_many` makes ONE generator and draws N times in a single
/// terminal call — a SECOND `&Random` consumer in the same tx is illegal on Sui, so a pack is one call / N rolls
/// / N locks, never a loop of `buy`s. That shuts the abort-and-reroll door WITHOUT a sealed/reveal ceremony: the
/// buyer pays and rolls atomically; the outcome commits the instant the tx lands and cannot be inspected-then-
/// reverted.
///
/// PERSONAL KIOSK BY TYPE: buy takes `&PersonalKioskCap` (not a raw `&KioskOwnerCap`). The cap type PROVES the
/// destination kiosk is personal — the constitution is enforced by the TYPE, no post-lock `return_val` (which
/// would be an illegal MoveCall after the `Random` call). The admin cap is reached internally via
/// `personal_kiosk::borrow`.
///
/// UNDRY-RUNNABLE (constant-per-item gas): a tx consuming `&Random` CANNOT be simulated, so the client derives a
/// budget from a MEASURED constant × headroom (× quantity for `buy_many`), never a guessed literal.
///   << TESTNET-MEASURED per-item `buy` gas: TO BE STAMPED at the publish rehearsal; ship it × 1.5 × quantity. >>
module aresrpg::shop;

use aresrpg::{admin::AdminCap, config::GameConfig, extension, item::{Self, Item, ItemTemplate}, item_stats, version::Version};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  clock::Clock,
  coin::Coin,
  event,
  kiosk::Kiosk,
  random::{Self, Random, RandomGenerator},
  sui::SUI,
  transfer_policy::TransferPolicy,
  tx_context::sender
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ESalePaused: u64 = 101; // buy: the sale is paused
const EInsufficientPayment: u64 = 102; // buy: payment is below price × quantity
const EWrongTemplate: u64 = 103; // buy: the passed template is not the one this sale sells
const EInvalidQuantity: u64 = 104; // buy_many: quantity is 0 or exceeds MAX_BUY_QUANTITY
const ESoldOut: u64 = 105; // buy: the batch would exceed the sale's supply cap
const ESaleNotStarted: u64 = 106; // buy: the sale's start time (start_ms) has not been reached
const ESaleEnded: u64 = 107; // buy: the sale's end time (end_ms) has passed
const EStackableHasRanges: u64 = 108; // buy: a stackable template carries stat ranges (defense-in-depth — admin::create_template rejects this at authoring)
const EBadWindow: u64 = 109; // set_window: end_ms <= start_ms can never open — refuse the incoherent config
const ESaleNotPaused: u64 = 110; // burn_sale: refuse to delete an ACTIVE (unpaused) sale — pause it first

/// Gas backstop: one `buy_many` mints at most this many items (each mint+roll+lock is bounded work, so a batch
/// is bounded — precedent MAX_BUY_QUANTITY). A larger pack is split across txs client-side.
const MAX_BUY_QUANTITY: u64 = 100;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A shared vending machine. The supply cap lives HERE (`supply`: `none` = unlimited); `minted` is the on-chain
/// progress counter; `price` = per-item MIST; `start_ms`/`end_ms` = the OPTIONAL sale window (`none` = open that
/// side; start INCLUSIVE, end EXCLUSIVE); `paused` = the admin's stop control. Proceeds route to the fixed
/// `@treasury` (a Move.toml named address, never a per-sale field — one home, no drift).
public struct Sale has key {
  id: UID,
  template: ID,
  price: u64,
  supply: Option<u64>,
  minted: u64,
  start_ms: Option<u64>,
  end_ms: Option<u64>,
  paused: bool,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct SaleCreated has copy, drop { sale: ID, template: ID, price: u64, supply: Option<u64> }

public struct SaleBought has copy, drop { sale: ID, template: ID, buyer: address, item: ID, price: u64, amount: u64 }

public struct SalePaused has copy, drop { sale: ID, paused: bool }

public struct PriceChanged has copy, drop { sale: ID, price: u64 }

public struct WindowChanged has copy, drop { sale: ID, start_ms: Option<u64>, end_ms: Option<u64> }

public struct SaleBurned has copy, drop { sale: ID, template: ID, minted: u64 }

// ╔════════════════ [ Sale lifecycle (AdminCap + version gated) ] ════════════ ]

/// Create + SHARE a `Sale` for `template` at `price` MIST. `supply = none` → unlimited; `some(n)` → at most `n`
/// units ever sold. Starts UNPAUSED with NO time window (set later via `set_window`). Version-gated only, so the
/// owner authors sales while dark. Returns nothing; discovered via `SaleCreated`.
public fun create_sale(
  cap: &AdminCap,
  template: ID,
  price: u64,
  supply: Option<u64>,
  version: &Version,
  ctx: &mut TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  let sale = Sale {
    id: object::new(ctx),
    template,
    price,
    supply,
    minted: 0,
    start_ms: option::none(),
    end_ms: option::none(),
    paused: false,
  };
  event::emit(SaleCreated { sale: object::id(&sale), template, price, supply });
  transfer::share_object(sale);
}

/// Update a live sale's per-item price (MIST).
public fun set_price(cap: &AdminCap, sale: &mut Sale, price: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  sale.price = price;
  event::emit(PriceChanged { sale: object::id(sale), price });
}

/// Set the OPTIONAL sale window (`none` on a side = open that side). `buy`/`buy_many` abort before it opens
/// (`ESaleNotStarted`) or once it closes (`ESaleEnded`). Start inclusive, end exclusive.
public fun set_window(
  cap: &AdminCap,
  sale: &mut Sale,
  start_ms: Option<u64>,
  end_ms: Option<u64>,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  // A window with end ≤ start is UNSATISFIABLE (start inclusive, end exclusive) — every buy would silently
  // abort forever. Refuse the incoherent config at authoring time instead (admin footgun, hat finding).
  if (start_ms.is_some() && end_ms.is_some()) assert!(*start_ms.borrow() < *end_ms.borrow(), EBadWindow);
  sale.start_ms = start_ms;
  sale.end_ms = end_ms;
  event::emit(WindowChanged { sale: object::id(sale), start_ms, end_ms });
}

/// Pause / unpause a sale (admin stop control). While paused, `buy`/`buy_many` abort with `ESalePaused`.
public fun set_paused(cap: &AdminCap, sale: &mut Sale, paused: bool, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  sale.paused = paused;
  event::emit(SalePaused { sale: object::id(sale), paused });
}

/// BURN a sale: delete its shared vending machine on-chain (any admin-authored object must always be deletable).
/// REQUIRES the sale to be PAUSED (`ESaleNotPaused`) — a live gate can never be pulled out from
/// under an in-flight buyer, so retiring a sale is the deliberate two-step pause → burn. Cap + version gated,
/// MIRRORING `create_sale`. NO supply/minted guard is needed: a bought item ROLLS its stats at purchase and is
/// already self-contained + kiosk-locked (it snapshots the template by plain `ID`, never an object ref), so a
/// deleted sale dangles nothing sold — `minted` is emitted for the audit trail only. Unpacks the struct (all
/// non-`id` fields have `drop`) and `object::delete`s the UID (Sui permits deleting a SHARED object BY VALUE).
/// Emits `SaleBurned`.
public fun burn_sale(cap: &AdminCap, sale: Sale, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(sale.paused, ESaleNotPaused);
  let Sale { id, template, price: _, supply: _, minted, start_ms: _, end_ms: _, paused: _ } = sale;
  event::emit(SaleBurned { sale: id.to_inner(), template, minted });
  object::delete(id);
}

// ╔════════════════ [ BUY (single-step: mint → roll → lock, one terminal `&Random` call) ] ══ ]

/// THE single buy — a private `entry` (consumes `&Random`; a PTB calls it as its TERMINAL command). Mints ONE
/// item. See `buy_internal` for the enforced order.
entry fun buy(
  sale: &mut Sale,
  template: &ItemTemplate,
  payment: Coin<SUI>,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  clock: &Clock,
  r: &Random,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  config.assert_domain(aresrpg::config::domain_market()); // S-46 kill-switch bit
  let mut generator = random::new_generator(r, ctx);
  buy_internal(sale, template, 1, payment, kiosk, pkcap, policy, &mut generator, clock, version, ctx);
}

/// THE pack buy — a private `entry` minting `quantity` items in ONE terminal `&Random` call (the multi-buy law:
/// one generator, N draws, N locks; a second `&Random` consumer per tx is illegal). Splits `price × quantity`
/// to `@treasury`, refunds change ONCE, reserves the whole batch against the supply cap atomically.
entry fun buy_many(
  sale: &mut Sale,
  template: &ItemTemplate,
  quantity: u64,
  payment: Coin<SUI>,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  clock: &Clock,
  r: &Random,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  config.assert_domain(aresrpg::config::domain_market()); // S-46 kill-switch bit
  let mut generator = random::new_generator(r, ctx);
  buy_internal(sale, template, quantity, payment, kiosk, pkcap, policy, &mut generator, clock, version, ctx);
}

/// The shared buy body, generator-injected so the `entry` paths (real `&Random`) and the test path
/// (deterministic generator) drive the SAME guarded code. Enforces, ALL before any money moves (refusal costs
/// only gas): package enabled+latest → quantity in [1, MAX] → not paused → template matches → window open →
/// payment ≥ price × quantity → the WHOLE batch fits under the supply cap (atomic reserve: `minted + quantity ≤
/// supply`, never loop-and-check). Then it reserves the batch, splits the EXACT `price × quantity` to
/// `@treasury` (change refunded once), and by CATEGORY either mints ONE stackable item of amount = quantity
/// (resources/consumables — no roll) OR mints N UNIQUE gear items each rolled from the template ranges — locking
/// each into the buyer's personal kiosk. `supply`/`minted` count UNITS, so `minted += quantity` holds for both
/// shapes. `self_transfer` is deliberate: the only address transfer is the SUI CHANGE; items are forced into the kiosk.
#[allow(lint(self_transfer))]
fun buy_internal(
  sale: &mut Sale,
  template: &ItemTemplate,
  quantity: u64,
  mut payment: Coin<SUI>,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  generator: &mut RandomGenerator,
  clock: &Clock,
  version: &Version,
  ctx: &mut TxContext,
): vector<ID> {
  version.assert_enabled();
  assert!(quantity >= 1 && quantity <= MAX_BUY_QUANTITY, EInvalidQuantity);
  assert!(!sale.paused, ESalePaused);
  assert!(item::template_id(template) == sale.template, EWrongTemplate);
  assert_window_open(sale, clock);

  let total = sale.price * quantity; // u64 overflow aborts safely — no money has moved yet
  assert!(payment.value() >= total, EInsufficientPayment);
  // ATOMIC supply reserve: the whole batch must fit under the cap in one check (never loop-and-check).
  assert!(sale.supply.is_none() || sale.minted + quantity <= *sale.supply.borrow(), ESoldOut);

  sale.minted = sale.minted + quantity;

  let paid = payment.split(total, ctx);
  transfer::public_transfer(paid, @treasury);

  let buyer = sender(ctx);
  // ONLY the SUI change (a fungible coin) is ever sent to an address — never an item.
  if (payment.value() == 0) payment.destroy_zero()
  else transfer::public_transfer(payment, buyer);

  let owner_cap = personal_kiosk::borrow(pkcap);
  let mut minted = vector<ID>[]; // the ids this call landed in the kiosk (the entries discard them; tests read them)

  if (item::is_stackable_category(item::template_category(template))) {
    // STACKABLE (resource/consumable): the whole batch is ONE item carrying amount = quantity — no per-unit NFTs,
    // no rolls. Stackables have NO stat ranges; `admin::create_template` rejects ranges on a stackable category at
    // authoring, so this assert is defense-in-depth on the money path (a bad template can never reach here).
    assert!(!item_stats::has_ranges(template), EStackableHasRanges);
    let (item, pledge) = item::mint_stack(template, quantity, ctx);
    event::emit(SaleBought {
      sale: object::id(sale),
      template: sale.template,
      buyer,
      item: object::id(&item),
      price: sale.price,
      amount: quantity,
    });
    minted.push_back(object::id(&item));
    item::lock_in_kiosk(pledge, item, kiosk, owner_cap, policy);
  } else {
    // NON-STACKABLE (gear): mint N UNIQUE items through the ONE gear-mint door, each carrying its OWN seed drawn
    // from this call's single generator — the door rolls the template ranges (if any) and attaches the block.
    let mut i = 0;
    while (i < quantity) {
      let (item, pledge) = extension::mint_item(template, option::some(generator.generate_u64()), version, ctx);
      event::emit(SaleBought {
        sale: object::id(sale),
        template: sale.template,
        buyer,
        item: object::id(&item),
        price: sale.price,
        amount: 1,
      });
      minted.push_back(object::id(&item));
      item::lock_in_kiosk(pledge, item, kiosk, owner_cap, policy);
      i = i + 1;
    };
  };
  minted
}

/// Abort unless `now` is inside the sale window: start INCLUSIVE, end EXCLUSIVE, each `none` side open.
fun assert_window_open(sale: &Sale, clock: &Clock) {
  let now = clock.timestamp_ms();
  if (sale.start_ms.is_some()) assert!(now >= *sale.start_ms.borrow(), ESaleNotStarted);
  if (sale.end_ms.is_some()) assert!(now < *sale.end_ms.borrow(), ESaleEnded);
}

// NO onboarding entry (PTB-first law): a kiosk-less buyer creates + shares a PERSONAL kiosk ONCE in a prior
// CLIENT PTB (`kiosk::new` → `personal_kiosk::new` → `transfer_to_sender` → share); every subsequent buy targets
// that already-shared kiosk as a single terminal `&Random` command. The `&PersonalKioskCap` type is the
// constitution; the onboarding sequence belongs to the SDK.

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// Drive `buy_internal` for ONE item through a deterministic generator (the `entry`'s real `&Random` path is
/// exercised on-chain in a PTB; unit tests hit the SAME body through this door).
public fun buy_for_testing(
  sale: &mut Sale,
  template: &ItemTemplate,
  payment: Coin<SUI>,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  clock: &Clock,
  version: &Version,
  ctx: &mut TxContext,
): vector<ID> {
  let mut generator = random::new_generator_for_testing();
  buy_internal(sale, template, 1, payment, kiosk, pkcap, policy, &mut generator, clock, version, ctx)
}

#[test_only]
/// Drive `buy_internal` for `quantity` items through a deterministic generator (the pack path).
public fun buy_many_for_testing(
  sale: &mut Sale,
  template: &ItemTemplate,
  quantity: u64,
  payment: Coin<SUI>,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  clock: &Clock,
  version: &Version,
  ctx: &mut TxContext,
): vector<ID> {
  let mut generator = random::new_generator_for_testing();
  buy_internal(sale, template, quantity, payment, kiosk, pkcap, policy, &mut generator, clock, version, ctx)
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun price(self: &Sale): u64 { self.price }

public fun is_paused(self: &Sale): bool { self.paused }

public fun sale_template(self: &Sale): ID { self.template }

public fun supply(self: &Sale): Option<u64> { self.supply }

public fun minted(self: &Sale): u64 { self.minted }

public fun start_ms(self: &Sale): Option<u64> { self.start_ms }

public fun end_ms(self: &Sale): Option<u64> { self.end_ms }

// ╔════════════════ [ Testing constant accessor ] ════════════════════════════ ]

#[test_only]
public fun max_buy_quantity(): u64 { MAX_BUY_QUANTITY }
