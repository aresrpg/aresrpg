// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE OFFICIAL SHOP + ADMIN DISTRIBUTION (owner 2026-08-10). Three value routes, ZERO
/// randomness — shop items never carry stats, so everything mints through `mint_plain`
/// (which refuses ranged templates mechanically):
///
///   SALE — a seed-minted shared vending machine whose price and enabled state are living;
///   only finite `supply` counts down and is never replenished. Exact payment × quantity →
///   `@treasury`.
///
///   AIRDROP — a shared whitelist snapshotted at the seeding: each listed address claims
///   ONCE (claiming REMOVES the address — once-only by deletion, and the last claim
///   leaves an empty list).
///
///   GIFTCARD — a `key + store` VOUCHER (not a game item: no stats, freely portable)
///   minted at the seeding and distributed off-chain — zksend links carry it natively.
///   Whoever holds it redeems: the voucher burns, the item is born INSIDE the redeemer's
///   kiosk. The link moves the voucher; a game item never sits at a raw address.
///
/// ALL THREE are SEALED SUPPLY DOORS (owner 2026-08-10): sales, airdrops and giftcards
/// mint items into existence, so all of them author ONLY through the seeding — after
/// the seal, no door can ever introduce supply again.
///
/// Peer trading needs no code here: sales/gifts/exchange ride native kiosk listings
/// (exclusive listings for gifts) under the seed-installed royalty rule.
module aresrpg::shop;

use aresrpg_control::admin::AdminCap;
use aresrpg_seed::{item_rows::{Self, ItemTemplate}, registry::{Self, Registry}};
use aresrpg::item::{Self, Item};
use std::string::String;
use sui::{
  coin::Coin,
  derived_object,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  sui::SUI,
  transfer_policy::TransferPolicy,
  vec_set::{Self, VecSet},
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongTemplate: u64 = 2401; // buy/claim/redeem: the passed template is not the one
const EWrongPayment: u64 = 2402; // buy: payment must be exactly price × quantity
const ESoldOut: u64 = 2403; // buy: the batch exceeds the sale's remaining supply
const EZeroQuantity: u64 = 2404;
const ENotWhitelisted: u64 = 2405; // claim: the sender is not (or no longer) on the list
const ESaleDisabled: u64 = 2406;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// Keys a sale's derived address by the item type it sells — the client derives it offline.
public struct SaleKey(String) has copy, drop, store;
public struct AirdropKey(String) has copy, drop, store;
public struct GiftcardKey(String) has copy, drop, store;

/// The vending machine: supply policy is immutable; price and enabled state are living content.
public struct Sale has key {
  id: UID,
  item_type: String,
  template: ID,
  price: u64, // MIST per unit
  supply: u64, // remaining finite units; zero for infinite
  infinite: bool,
  enabled: bool,
}

/// A seeded airdrop: the whitelist is the full claim state — an address leaves on claim.
/// A `VecSet` by construction (audit 2026-08-10): a duplicate address in the authored list
/// would have been two claims; the set refuses it at the seeding, mechanically.
public struct Airdrop has key {
  id: UID,
  drop_id: String,
  template: ID,
  amount_each: u32,
  whitelist: VecSet<address>,
}

/// The zksend-portable voucher: `store` lets any link or wallet carry it; redeeming burns
/// it and mints the item inside the redeemer's own kiosk.
public struct Giftcard has key, store {
  id: UID,
  template: ID,
  amount: u32,
}

public struct SaleBought has copy, drop {
  sale: ID,
  item_type: String,
  buyer: address,
  quantity: u64,
  paid: u64,
  supply: u64,
}

public struct AirdropCreated has copy, drop { airdrop: ID, template: ID, addresses: u64 }

public struct AirdropClaimed has copy, drop { airdrop: ID, drop_id: String, claimer: address, remaining: u64 }

public struct GiftcardMinted has copy, drop { giftcard: ID, template: ID, amount: u32 }

public struct GiftcardRedeemed has copy, drop { giftcard: ID, redeemer: address }

// ╔════════════════ [ Seeding (seed.move gates) + admin creation ] ═══════════ ]

/// Mint + share a sale at its item-type-derived address — a LIVING supply door (owner ruling
/// 2026-08-23): AdminCap-gated forever, closed only by the one `freeze_forever` (the door
/// claims and bumps through the seed registry, so the endgame flag shuts it with everything
/// else). Shared, never frozen — a frozen object could not count supply down.
public fun new_sale(
  cap: &AdminCap,
  root: &mut Registry,
  template: &ItemTemplate,
  price: u64,
  supply: u64,
  infinite: bool,
  enabled: bool,
  ctx: &TxContext,
) {
  assert!(infinite || supply >= 1, EZeroQuantity);
  let item_type = item_rows::template_type(template);
  transfer::share_object(Sale {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), SaleKey(item_type)),
    item_type,
    template: item_rows::template_id(template),
    price,
    supply: if (infinite) 0 else supply,
    infinite,
    enabled,
  });
  registry::bump(cap, root, b"sales".to_string(), item_rows::template_type(template), ctx);
}

/// Reprice or retire a sale without changing its finite/infinite supply policy.
public fun set_sale(
  cap: &AdminCap,
  root: &mut Registry,
  sale: &mut Sale,
  price: u64,
  enabled: bool,
  ctx: &TxContext,
) {
  sale.price = price;
  sale.enabled = enabled;
  registry::bump(cap, root, b"sales".to_string(), sale.item_type, ctx);
}

/// Open an airdrop over a snapshotted whitelist — a seeding door, sealed with the rest.
/// The set-build aborts on any duplicate address: a list that could double-claim never
/// reaches the chain.
public fun new_airdrop(
  cap: &AdminCap,
  root: &mut Registry,
  drop_id: String,
  template: &ItemTemplate,
  amount_each: u32,
  whitelist: vector<address>,
  ctx: &TxContext,
) {
  assert!(amount_each >= 1 && !whitelist.is_empty(), EZeroQuantity);
  let mut set = vec_set::empty();
  let mut i = 0;
  while (i < whitelist.length()) {
    set.insert(whitelist[i]); // aborts on a duplicate — VecSet law
    i = i + 1;
  };
  let template_id = item_rows::template_id(template);
  let drop = Airdrop {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), AirdropKey(drop_id)),
    drop_id,
    template: template_id,
    amount_each,
    whitelist: set,
  };
  event::emit(AirdropCreated {
    airdrop: drop.id.to_inner(),
    template: template_id,
    addresses: drop.whitelist.length(),
  });
  registry::bump(cap, root, b"airdrops".to_string(), drop.drop_id, ctx);
  transfer::share_object(drop);
}

/// Mint a giftcard voucher and RETURN it — the seeding PTB routes it (held for later
/// zksend links, direct sends); the object's `store` makes it portable anywhere.
public fun new_giftcard(
  cap: &AdminCap,
  root: &mut Registry,
  card_id: String,
  template: &ItemTemplate,
  amount: u32,
  ctx: &TxContext,
): Giftcard {
  assert!(amount >= 1, EZeroQuantity);
  let template_id = item_rows::template_id(template);
  let card = Giftcard {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), GiftcardKey(card_id)),
    template: template_id,
    amount,
  };
  event::emit(GiftcardMinted { giftcard: card.id.to_inner(), template: template_id, amount });
  registry::bump(cap, root, b"giftcards".to_string(), card_id, ctx);
  card
}

// ╔════════════════ [ Player doors (api gates the version, then calls) ] ═════ ]

/// Buy `quantity` units: exact payment to the treasury, supply down, the stack lands in
/// the buyer's kiosk (merged into `existing` under the no-dust law). Stat-less by
/// construction — `mint_plain` refuses a ranged template.
public(package) fun buy(
  sale: &mut Sale,
  template: &ItemTemplate,
  quantity: u32,
  payment: Coin<SUI>,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  assert!(object::id(template) == sale.template, EWrongTemplate);
  assert!(sale.enabled, ESaleDisabled);
  assert!(quantity >= 1, EZeroQuantity);
  if (!sale.infinite) assert!((quantity as u64) <= sale.supply, ESoldOut);
  let total = sale.price * (quantity as u64);
  assert!(payment.value() == total, EWrongPayment);
  transfer::public_transfer(payment, @treasury);
  if (!sale.infinite) sale.supply = sale.supply - (quantity as u64);
  item::deposit(kiosk, cap, policy, existing, item::mp(template, quantity, ctx));
  event::emit(SaleBought {
    sale: sale.id.to_inner(),
    item_type: sale.item_type,
    buyer: ctx.sender(),
    quantity: quantity as u64,
    paid: total,
    supply: sale.supply,
  });
}

/// Claim the sender's airdrop share — once only: the address LEAVES the whitelist.
public(package) fun claim_airdrop(
  drop: &mut Airdrop,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  assert!(object::id(template) == drop.template, EWrongTemplate);
  assert!(drop.whitelist.contains(&ctx.sender()), ENotWhitelisted);
  drop.whitelist.remove(&ctx.sender());
  item::deposit(kiosk, cap, policy, existing, item::mp(template, drop.amount_each, ctx));
  event::emit(AirdropClaimed {
    airdrop: drop.id.to_inner(),
    drop_id: drop.drop_id,
    claimer: ctx.sender(),
    remaining: drop.whitelist.length(),
  });
}

/// Redeem a giftcard: the voucher burns, the item is born locked in the redeemer's kiosk.
public(package) fun redeem_giftcard(
  card: Giftcard,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  let Giftcard { id, template: wanted, amount } = card;
  assert!(object::id(template) == wanted, EWrongTemplate);
  event::emit(GiftcardRedeemed { giftcard: id.to_inner(), redeemer: ctx.sender() });
  id.delete();
  item::deposit(kiosk, cap, policy, existing, item::mp(template, amount, ctx));
}
