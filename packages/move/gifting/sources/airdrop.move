// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// AIRDROP — whitelist claim-MINT for external-collection holders (design
/// doc `docs/ITEM_SEND_PLAN.md` Part B). An off-chain process snapshots an external NFT collection's holders,
/// whitelists them on a shared `Airdrop`, and each holder connects and claims — the reserved item MINTS directly
/// into their own personal kiosk, kiosk-locked.
///
/// THE REFRAME (why NO royalty bypass — B1): getting a *new* item to a holder is a MINT, not a transfer. A mint
/// is a FIRST ACQUISITION — it `lock`s into the claimer's kiosk (never `purchase`s), so it legitimately bypasses
/// `confirm_request` and charges NO royalty, dodging nothing (the item is the receiver's own to lock). This is
/// exactly how `shop::buy` and `loot_box::claim_pet` deliver items today (`character_link::mint_and_lock_output`).
/// The "one-time bypass because everything is kiosk-locked" instinct dissolves: there is nothing to
/// bypass, and the kiosk-lock constitution stays fully intact.
///
/// DELIVERY IS TO THE SIGNER'S OWN KIOSK (a mechanical invariant, not a choice): `personal_kiosk::new` hardcodes
/// the kiosk owner + the soulbound cap to `sender(ctx)`, and `item::lock_in_kiosk` REQUIRES a personal kiosk — so
/// a freshly-minted locked item can only ever land in the SIGNER's own personal kiosk. There is no
/// mint-to-a-different-address path that honours the constitution. The whitelisted address therefore claims FOR
/// ITSELF; `recipient` (the destination) is derived from the passed kiosk's owner and always equals the claimer.
/// (An external-wallet holder connects THAT wallet and receives the item in that wallet's kiosk — the
/// `/airdrop` page uses a wallet adapter for exactly this.)
///
/// ONE CLAIM PER ADDRESS, BY CONSTRUCTION: `claim` REMOVES the claimer from the `whitelist` table — a second
/// claim finds them absent and aborts `ENotEligible`. Eligibility and the double-claim guard are the SAME table
/// op. Unclaimed = un-minted (CLAIM-MINT pre-mints nothing — B6 pick: unclaimed supply simply never exists).
/// A burned item template makes claims un-formable (the deleted shared `ItemTemplate` can't be passed), so a
/// closed catalog naturally closes the drop — no explicit "template living" guard is needed.
module aresrpg_gifting::airdrop;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, item::{Self, Item, ItemTemplate}, version::Version};
use aresrpg_gifting::gifting;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::string::String;
use sui::{event, kiosk::Kiosk, table::{Self, Table}, transfer_policy::TransferPolicy, tx_context::sender};

// ╔════════════════ [ Errors (teach, don't reject) ] ═════════════════════════ ]

const ENotEligible: u64 = 101; // claim: the caller is not on the whitelist (never was, or already claimed)
const EWrongTemplate: u64 = 102; // claim: the passed template is not the one this airdrop mints

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A shared claim-mint drop. `template` = the reserved `ItemTemplate` id this drop mints (snapshotted at create
/// from a live template ref). `name`/`description` = owner display for the sidebar page (the indexer projects
/// them). `whitelist` = eligible addresses (value `true` is a presence marker); a claim REMOVES its claimer, so
/// the table only ever shrinks and doubles as the one-claim guard. `minted` = the on-chain progress counter.
/// `key` only — shared; `admin_close` consumes it by value and drops the table.
public struct Airdrop has key {
  id: UID,
  template: ID,
  name: String,
  description: String,
  whitelist: Table<address, bool>,
  minted: u64,
}

// ╔════════════════ [ Events (the indexer projects the drop + its claims) ] ══ ]

public struct AirdropCreated has copy, drop { airdrop: ID, template: ID, name: String }

public struct AirdropAddressesAdded has copy, drop { airdrop: ID, count: u64 }

public struct AirdropAddressesRemoved has copy, drop { airdrop: ID, count: u64 }

/// A claim — the reserved item was minted + locked into `recipient`'s kiosk (== `claimer`). The concrete minted
/// `Item` id rides the co-emitted `item::ItemMinted` in the same tx (the `loot_box::PetClaimed` precedent — a
/// claim event carries the template, the mint event carries the instance).
public struct AirdropClaimed has copy, drop { airdrop: ID, claimer: address, recipient: address, template: ID }

public struct AirdropClosed has copy, drop { airdrop: ID, template: ID, minted: u64 }

// ╔════════════════ [ Admin (AdminCap + version gated — authored while dark) ] ═ ]

/// Create + SHARE an `Airdrop` for `template` (passed by ref → the template must EXIST at create), with an EMPTY
/// whitelist. Version-gated (assert_latest) only, so drops are authored before launch. Populate with
/// `admin_add_addresses`. Mirrors `loot_box`/`shop` create shape.
public fun admin_create(
  cap: &AdminCap,
  template: &ItemTemplate,
  name: String,
  description: String,
  version: &Version,
  ctx: &mut TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  let airdrop = Airdrop {
    id: object::new(ctx),
    template: item::template_id(template),
    name,
    description,
    whitelist: table::new(ctx),
    minted: 0,
  };
  event::emit(AirdropCreated { airdrop: object::id(&airdrop), template: item::template_id(template), name: airdrop.name });
  transfer::share_object(airdrop);
}

/// Add eligible `addresses` to the whitelist (idempotent — an already-present address is skipped, so a re-run of
/// an overlapping snapshot never aborts). Emits the ACTUALLY-APPLIED delta (dups excluded), so the indexer's
/// eligible-count projection stays exact. AdminCap + version gated.
public fun admin_add_addresses(cap: &AdminCap, airdrop: &mut Airdrop, addresses: vector<address>, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let mut applied = 0;
  let mut i = 0;
  while (i < addresses.length()) {
    let addr = *addresses.borrow(i);
    if (!airdrop.whitelist.contains(addr)) {
      airdrop.whitelist.add(addr, true);
      applied = applied + 1;
    };
    i = i + 1;
  };
  event::emit(AirdropAddressesAdded { airdrop: object::id(airdrop), count: applied });
}

/// Remove `addresses` from the whitelist (idempotent — an absent address is skipped). Emits the ACTUALLY-APPLIED
/// delta (absents excluded), mirroring `admin_add_addresses`. AdminCap + version gated.
public fun admin_remove_addresses(cap: &AdminCap, airdrop: &mut Airdrop, addresses: vector<address>, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let mut applied = 0;
  let mut i = 0;
  while (i < addresses.length()) {
    let addr = *addresses.borrow(i);
    if (airdrop.whitelist.contains(addr)) {
      airdrop.whitelist.remove(addr);
      applied = applied + 1;
    };
    i = i + 1;
  };
  event::emit(AirdropAddressesRemoved { airdrop: object::id(airdrop), count: applied });
}

/// CLOSE a drop: consume the `Airdrop` by value and delete it (CLAIM-MINT pre-minted nothing, so unclaimed
/// supply simply ceases to exist — B6 pick). Drops the whitelist table (`bool` has `drop`, so a partially-claimed
/// table needs no drain). AdminCap + version gated.
public fun admin_close(cap: &AdminCap, airdrop: Airdrop, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let Airdrop { id, template, name: _, description: _, whitelist, minted } = airdrop;
  whitelist.drop();
  event::emit(AirdropClosed { airdrop: id.to_inner(), template, minted });
  id.delete();
}

// ╔════════════════ [ Claim — a whitelisted holder mints the reserved item into their own kiosk ] ═ ]

/// CLAIM the reserved item: the whitelisted signer mints EXACTLY ONE into their OWN personal kiosk, kiosk-locked
/// (no royalty — a mint is a first acquisition, not a trade). Asserts the passed `template` is this drop's
/// (`EWrongTemplate`) and the signer is whitelisted (`ENotEligible`), then REMOVES them (one-claim by
/// construction). `recipient` is the kiosk owner (== the claimer, since the soulbound `pkcap` proves they own
/// `kiosk`). Global + version freeze gated like every mint door.
public fun claim(
  airdrop: &mut Airdrop,
  template: &ItemTemplate,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  config.assert_enabled();
  let claimer = sender(ctx);
  assert!(item::template_id(template) == airdrop.template, EWrongTemplate);
  assert!(airdrop.whitelist.contains(claimer), ENotEligible);
  airdrop.whitelist.remove(claimer); // one-claim by construction — a second claim finds nothing
  airdrop.minted = airdrop.minted + 1;

  let recipient = personal_kiosk::owner(kiosk); // the destination owner (the pkcap proves == claimer)
  character_link::mint_and_lock_output_brand(gifting::brand(), config, template, 1, version, kiosk, personal_kiosk::borrow(pkcap), policy, ctx);
  event::emit(AirdropClaimed { airdrop: object::id(airdrop), claimer, recipient, template: airdrop.template });
}

// ╔════════════════ [ Reads (RPC + pre-flight) ] ═════════════════════════════ ]

public fun template(self: &Airdrop): ID { self.template }

public fun name(self: &Airdrop): String { self.name }

public fun description(self: &Airdrop): String { self.description }

public fun minted(self: &Airdrop): u64 { self.minted }

public fun eligible_count(self: &Airdrop): u64 { self.whitelist.length() }

public fun is_eligible(self: &Airdrop, addr: address): bool { self.whitelist.contains(addr) }
