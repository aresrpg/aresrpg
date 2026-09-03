// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ADMIN DISTRIBUTION (owner 2026-08-10). Two free value routes, ZERO randomness;
/// statless items and fixed-endpoint pets mint through `mint_distribution`:
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
/// BOTH are SEALED SUPPLY DOORS: airdrops and giftcards mint items into existence, so
/// they author ONLY through the seeding — after
/// the seal, no door can ever introduce supply again.
module aresrpg::distribution;

use aresrpg_control::admin::AdminCap;
use aresrpg_seed::{item_rows::{Self, ItemTemplate}, registry::{Self, Registry}};
use aresrpg::item::{Self, Item};
use std::string::String;
use sui::{
  derived_object,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  transfer_policy::TransferPolicy,
  vec_set::{Self, VecSet},
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongTemplate: u64 = 2401; // claim/redeem: the passed template is not the one
const EZeroQuantity: u64 = 2404;
const ENotWhitelisted: u64 = 2405; // claim: the sender is not (or no longer) on the list

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct AirdropKey(String) has copy, drop, store;
public struct GiftcardKey(String) has copy, drop, store;

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

public struct AirdropCreated has copy, drop { airdrop: ID, template: ID, addresses: u64 }

public struct AirdropClaimed has copy, drop {
  airdrop: ID,
  drop_id: String,
  claimer: address,
  recipient: address,
  giftcard: ID,
  remaining: u64,
}

public struct GiftcardMinted has copy, drop { giftcard: ID, template: ID, amount: u32 }

public struct GiftcardRedeemed has copy, drop { giftcard: ID, redeemer: address }

// ╔════════════════ [ Seeding (seed.move gates) + admin creation ] ═══════════ ]

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
  item::assert_distribution(template, amount_each);
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
  item::assert_distribution(template, amount);
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

/// Claim the sender's airdrop share for `recipient` — once only: the sender LEAVES the
/// whitelist and a portable voucher lands at the recipient. The recipient redeems separately,
/// so holder and game-wallet identities never need to share custody.
public(package) fun claim_airdrop(
  drop: &mut Airdrop,
  template: &ItemTemplate,
  recipient: address,
  ctx: &mut TxContext,
) {
  assert!(object::id(template) == drop.template, EWrongTemplate);
  item::assert_distribution(template, drop.amount_each);
  assert!(drop.whitelist.contains(&ctx.sender()), ENotWhitelisted);
  drop.whitelist.remove(&ctx.sender());
  let card = Giftcard {
    id: object::new(ctx),
    template: drop.template,
    amount: drop.amount_each,
  };
  let giftcard = object::id(&card);
  event::emit(GiftcardMinted { giftcard, template: drop.template, amount: drop.amount_each });
  transfer::public_transfer(card, recipient);
  event::emit(AirdropClaimed {
    airdrop: drop.id.to_inner(),
    drop_id: drop.drop_id,
    claimer: ctx.sender(),
    recipient,
    giftcard,
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
  item::deposit(kiosk, cap, policy, existing, item::mint_distribution(template, amount, ctx));
}
