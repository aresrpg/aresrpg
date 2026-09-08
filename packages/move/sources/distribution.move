// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Portable, seed-issued entitlements. Transfer freely; burn once into kiosk inventory.
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
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongTemplate: u64 = 2401; // claim/redeem: the passed template is not the one
const EZeroQuantity: u64 = 2404;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct GiftcardKey(String) has copy, drop, store;

/// The zksend-portable voucher: `store` lets any link or wallet carry it; redeeming burns
/// it and mints the item inside the redeemer's own kiosk.
public struct Giftcard has key, store {
  id: UID,
  template: ID,
  amount: u32,
}

public struct GiftcardMinted has copy, drop { giftcard: ID, template: ID, amount: u32 }

public struct GiftcardRedeemed has copy, drop { giftcard: ID, redeemer: address }

// ╔════════════════ [ Seeding (seed.move gates) + admin creation ] ═══════════ ]

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
