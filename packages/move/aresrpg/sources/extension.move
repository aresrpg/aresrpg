// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// EXTENSION — namespaced first-party dynamic-field helpers + the item MINT door.
///
/// S-46: the cross-package `ExtensionCap` authority is DISSOLVED. When items/game/fight/pools were separate
/// packages, a cap gated every DF write and every mint so one package could not forge another's fields. In ONE
/// package, `public(package)` IS that authority — only sibling aresrpg modules can reach these helpers. What
/// SURVIVES is pure DATA plumbing: the `NsKey { namespace, key }` layout, so distinct subsystems
/// (progression / equipment / world / item) never collide on a single Character/Item UID. The namespace is now a
/// plain `u8` the trusted in-package caller passes (the `ns_*` constants below), not a value carried by a cap.
///
/// READS ARE FREE (no version gate — on-chain state is public); WRITES `assert_enabled`-gate like every value
/// path (an emergency stop freezes first-party writes too).
module aresrpg::extension;

use aresrpg::{character::{Self, Character}, config::GameConfig, item::{Self, Item, ItemTemplate, LockPledge}, item_stats::{Self, ItemStatistics}, version::Version};
use sui::dynamic_field as df;

// ╔════════════════ [ Reserved namespaces (append-only; the u8 stamped into every NsKey) ] ═ ]
// The former mint/burn authority namespaces (4..9) are GONE — minting/burning is a `public(package)` door now,
// not a namespaced cap. These four remain purely to keep first-party field families physically distinct.

const NS_CHARACTER_PROGRESSION: u8 = 0; // hp / stats / points / jobs / spells / xp on a Character
const NS_CHARACTER_EQUIPMENT: u8 = 1; // the equipment slot map on a Character
const NS_CHARACTER_WORLD: u8 = 2; // world field / checkpoints / job xp / spell levels on a Character
const NS_ITEM: u8 = 3; // item-side first-party fields (pet power, scribe metadata) on an Item

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The namespaced DF-key envelope. A subsystem's key `K` is wrapped with its `namespace`, so two subsystems
/// writing the SAME logical `K` land in physically distinct slots and neither can overwrite the other.
public struct NsKey<K: copy + drop + store> has copy, drop, store {
  namespace: u8,
  key: K,
}

// ╔════════════════ [ Item MINT door (assert_enabled-gated; returns the LockPledge hot potato) ] ═ ]

/// The single cross-cutting GEAR-mint path (shop purchase, loot claims, craft output, gacha, pool item-out).
/// Returns the `LockPledge` hot potato so the caller is TYPE-FORCED to lock the item into a personal kiosk in the
/// same PTB (kiosk-lock constitution). `assert_enabled` like every value path.
///
/// #758 — THE ROLL LIVES HERE, so no seam can forget it: a template carrying authored [min,max] ranges mints with
/// its FIXED rolled block already attached. `stat_seed` is the entropy every caller derives from its OWN terminal
/// `&Random` (shop: the buy generator; loot: the fight result's open-time seed; craft: the craft generator);
/// `none` means the caller HAS no entropy to offer and the item mints blank — the honest state, never a
/// predictable stand-in (a `ctx`-derived seed would be dry-runnable, i.e. free re-rolls).
public(package) fun mint_item(template: &ItemTemplate, stat_seed: Option<u64>, version: &Version, ctx: &mut TxContext): (Item, LockPledge) {
  version.assert_enabled();
  let (mut item, pledge) = item::mint(template, ctx);
  let rolled = if (stat_seed.is_some()) item_stats::roll_for_template(template, stat_seed.destroy_some()) else option::none();
  if (rolled.is_some()) item_stats::attach_rolled(&mut item, *rolled.borrow());
  (item, pledge)
}

/// The stackable mint twin (gather yields, pool item-out): mints ONE item carrying `quantity` units.
/// `item::mint_stack` asserts the template's category actually STACKS.
public(package) fun mint_item_stack(template: &ItemTemplate, quantity: u64, version: &Version, ctx: &mut TxContext): (Item, LockPledge) {
  version.assert_enabled();
  item::mint_stack(template, quantity, ctx)
}

/// BRAND TWIN (2026-07-12 forge split): crush-yield rune stacks mint through the PINNED forge sibling's witness
/// (`config.assert_forge_brand` — sibling-private constructor, doors closed until pinned). Zero behavior drift —
/// delegates to `mint_item_stack` verbatim; the `LockPledge` hot potato still type-forces the kiosk lock.
public fun mint_item_stack_brand<W: drop>(_: W, config: &GameConfig, template: &ItemTemplate, quantity: u64, version: &Version, ctx: &mut TxContext): (Item, LockPledge) {
  config.assert_forge_brand<W>();
  mint_item_stack(template, quantity, version, ctx)
}

/// BRAND TWIN (2026-07-12 forge split): the rolled-stat REWRITE for the PINNED forge sibling (scribe outcome
/// write). Lives HERE, not in `item_stats` — `config → admin → item_stats` already form a chain, so an
/// `item_stats → config` edge would cycle; this module is the established cross-package item seam and imports
/// both sides cycle-free. Zero behavior drift: delegates to `item_stats::set_rolled` verbatim.
public fun set_rolled_brand<W: drop>(_: W, config: &GameConfig, item: &mut Item, stats: ItemStatistics) {
  config.assert_forge_brand<W>();
  item_stats::set_rolled(item, stats)
}

/// BRAND TWIN (2026-07-12 forge split): `&mut UID` access on an Item for the PINNED forge sibling — the item's
/// ForgeState DF (puits + application counts) writes through this. D319-COMPLIANT despite crossing the package
/// boundary ONLY because: the witness `W` has a sibling-PRIVATE constructor (never returned, never stored),
/// `config` pins exactly one such type (doors closed until the ceremony pins it), and this module has been the
/// item-DF cross-package seam since the cap era (pre-S-46 `ExtensionCap`, same responsibility). item::uid_mut
/// itself stays package-private — this brand door is the ONE widened path.
public fun item_uid_mut_brand<W: drop>(_: W, config: &GameConfig, item: &mut Item): &mut UID {
  config.assert_forge_brand<W>();
  item::uid_mut(item)
}

// ╔════════════════ [ Namespaced DF writes on an ITEM ] ═══════════════════════ ]

public(package) fun add_item_field<K: copy + drop + store, V: store>(namespace: u8, item: &mut Item, key: K, value: V, version: &Version) {
  version.assert_enabled();
  df::add(item::uid_mut(item), NsKey { namespace, key }, value);
}

public(package) fun borrow_item_field_mut<K: copy + drop + store, V: store>(namespace: u8, item: &mut Item, key: K, version: &Version): &mut V {
  version.assert_enabled();
  df::borrow_mut(item::uid_mut(item), NsKey { namespace, key })
}

#[test_only]
public(package) fun remove_item_field<K: copy + drop + store, V: store>(namespace: u8, item: &mut Item, key: K, version: &Version): V {
  version.assert_enabled();
  df::remove(item::uid_mut(item), NsKey { namespace, key })
}

// ╔════════════════ [ Namespaced DF writes on a CHARACTER (twin of the item set) ] ═ ]

public(package) fun add_character_field<K: copy + drop + store, V: store>(namespace: u8, character: &mut Character, key: K, value: V, version: &Version) {
  version.assert_enabled();
  df::add(character::uid_mut(character), NsKey { namespace, key }, value);
}

public(package) fun borrow_character_field_mut<K: copy + drop + store, V: store>(namespace: u8, character: &mut Character, key: K, version: &Version): &mut V {
  version.assert_enabled();
  df::borrow_mut(character::uid_mut(character), NsKey { namespace, key })
}

public(package) fun remove_character_field<K: copy + drop + store, V: store>(namespace: u8, character: &mut Character, key: K, version: &Version): V {
  version.assert_enabled();
  df::remove(character::uid_mut(character), NsKey { namespace, key })
}

/// Exit-class upsert for the dungeon release path. Unlike ordinary value writes, a live dungeon lock must be
/// releasable while the package is frozen; upgrade freshness still gates the single executable layout.
public(package) fun set_character_field_latest<K: copy + drop + store, V: drop + store>(
  namespace: u8,
  character: &mut Character,
  key: K,
  value: V,
  version: &Version,
) {
  version.assert_latest();
  let wrapped = NsKey { namespace, key };
  if (df::exists(character::uid(character), wrapped)) {
    let slot: &mut V = df::borrow_mut(character::uid_mut(character), wrapped);
    *slot = value;
  } else {
    df::add(character::uid_mut(character), wrapped, value);
  };
}

// ╔════════════════ [ FREE namespaced reads (no version gate — on-chain data is public) ] ══ ]

public(package) fun item_field_exists<K: copy + drop + store>(item: &Item, namespace: u8, key: K): bool {
  df::exists(item::uid(item), NsKey { namespace, key })
}

public(package) fun borrow_item_field<K: copy + drop + store, V: store>(item: &Item, namespace: u8, key: K): &V {
  df::borrow(item::uid(item), NsKey { namespace, key })
}

public(package) fun character_field_exists<K: copy + drop + store>(character: &Character, namespace: u8, key: K): bool {
  df::exists(character::uid(character), NsKey { namespace, key })
}

public(package) fun borrow_character_field<K: copy + drop + store, V: store>(character: &Character, namespace: u8, key: K): &V {
  df::borrow(character::uid(character), NsKey { namespace, key })
}

// ╔════════════════ [ Namespace accessors (package callers name their reserved slots) ] ═ ]

public(package) fun ns_character_progression(): u8 { NS_CHARACTER_PROGRESSION }
public(package) fun ns_character_equipment(): u8 { NS_CHARACTER_EQUIPMENT }
public(package) fun ns_character_world(): u8 { NS_CHARACTER_WORLD }
public(package) fun ns_item(): u8 { NS_ITEM }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// Pledge-carrying mint for SIBLING test fixtures (forge split): the only public route to (Item, LockPledge)
/// outside the package — test builds only, stripped from every publish.
public fun mint_item_for_testing(template: &ItemTemplate, stat_seed: Option<u64>, version: &Version, ctx: &mut TxContext): (Item, LockPledge) {
  mint_item(template, stat_seed, version, ctx)
}

#[test_only]
/// Stackable twin of `mint_item_for_testing` for SIBLING test fixtures (gifting/dungeon splits): the only public
/// route to a (stack Item, LockPledge) outside the package — test builds only, stripped from every publish.
public fun mint_item_stack_for_testing(template: &ItemTemplate, quantity: u64, version: &Version, ctx: &mut TxContext): (Item, LockPledge) {
  mint_item_stack(template, quantity, version, ctx)
}
