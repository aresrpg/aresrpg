// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CONSUMABLE EFFECT — the typed effect block attached as a DYNAMIC FIELD to a consumable `ItemTemplate`. This
/// is the on-chain HOME for a consumable's gameplay effect: `{ kind, amount }`. Same placement as `item_stats`/
/// `item_damages` — the item base owns the storage (it exposes the template UID package-privately), THIS module
/// owns the effect data shape + attach/read. Set at TEMPLATE CREATION (`admin::create_template`), ONLY when the
/// template's category is `consumable` (the gate asserts it there).
///
/// CLOSED VOCABULARY (§10 / §17.15, sealed in `docs/ANNEX_SHAPE_FREEZE.md §2): `kind` is a `u8` discriminant
/// from a FROZEN set — the old free-form string is dead (it let an author invent effects a future dispatcher
/// wouldn't recognise). `new` validates the discriminant, so an out-of-range kind can never be stored. The
/// consume path that DISPATCHES on `kind` (apply heal / reset points / open bag / gacha-roll) lives in a future
/// game-package upgrade; growth is ADDITIVE — append discriminants above `KIND_MAX`, never renumber.
module aresrpg::consumable_effect;

use aresrpg::item::{Self, ItemTemplate};
use std::string::String;
use sui::dynamic_field as df;

// ── The frozen §17.15 consumable vocabulary (u8 discriminants; additive growth only) ──
const KIND_HEAL: u8 = 0; // restore HP (dispatcher blocks it at full HP)
const KIND_STAT_RESET: u8 = 1; // refund all allocated stat points (retro respec scroll)
const KIND_SPELL_RESET: u8 = 2; // refund all allocated spell points
const KIND_BAG_OPEN: u8 = 3; // grant the bag's contents (template-defined)
const KIND_GACHA_ROLL: u8 = 4; // roll on-chain randomness across referenced templates
const KIND_MAX: u8 = 4; // highest valid discriminant (bump on additive growth)

const EInvalidEffectKind: u64 = 101; // new: the effect kind is outside the frozen vocabulary

/// The typed DF key the effect hangs under on the template's UID.
public struct EffectKey has copy, drop, store {}

/// One consumable effect: a `kind` discriminant from the frozen vocabulary + its `amount` magnitude. Pure data —
/// a future consume upgrade dispatches on `kind`. `copy + drop + store`.
public struct ConsumableEffect has copy, drop, store {
  kind: u8,
  amount: u64,
}

// ╔════════════════ [ Constructor (public — a PTB builds the effect to pass to create_template) ] ═ ]

/// Build an effect, VALIDATING the discriminant against the frozen vocabulary (`EInvalidEffectKind` otherwise).
/// This is the SOLE constructor, so an out-of-range `kind` can never reach `attach` or the stored DF.
public fun new(kind: u8, amount: u64): ConsumableEffect {
  assert!(kind <= KIND_MAX, EInvalidEffectKind);
  ConsumableEffect { kind, amount }
}

// ── Public discriminant accessors (the cross-package dispatcher names the kinds without reading private consts) ──
// ALL FIVE ARE PUBLIC ON PURPOSE (#1836). The reseed ceremony composes this call by INTERPOLATED FUNCTION NAME
// (`seed_full_corpus.mjs`: `::consumable_effect::${ceff.fn}`, one of these five), which is why the 07-30
// shrink's caller census — Move sources plus literal JS `target:` strings — could not see three of them and
// demoted `stat_reset`/`spell_reset`/`bag_open` to `#[test_only]`: a whole-PTB abort at the next ceremony.
// `seed_full_corpus_doors.test.mjs` now holds this row mechanically; demote one and it turns red on the PR.
public fun heal(): u8 { KIND_HEAL }
public fun stat_reset(): u8 { KIND_STAT_RESET }
public fun spell_reset(): u8 { KIND_SPELL_RESET }
public fun bag_open(): u8 { KIND_BAG_OPEN }
public fun gacha_roll(): u8 { KIND_GACHA_ROLL }

/// True if `category` is the consumable category (the ONLY category that may carry an effect). The gate calls
/// this before attaching. The `consumable` slug is single-homed in `item` (`y56`), so it lives in
/// exactly one place across the package (the effect-attach gate and the stackability rule read the same source).
public fun is_consumable(category: String): bool { category == item::y56() }

// ╔════════════════ [ Attach / read on the TEMPLATE ] ════════════════════════ ]

/// Attach the effect to `template` (package-private — the authoring surface calls it before the template is
/// shared, and only after asserting the category is consumable). Aborts if an effect is already attached.
public(package) fun attach(template: &mut ItemTemplate, effect: ConsumableEffect) {
  df::add(item::y57(template), EffectKey {}, effect);
}

public fun has_effect(template: &ItemTemplate): bool {
  df::exists(item::y58(template), EffectKey {})
}

public fun effect(template: &ItemTemplate): &ConsumableEffect {
  df::borrow(item::y58(template), EffectKey {})
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// Detach + drop the consumable effect from `template` if present. Package-private — the burn path calls it so
/// deleting the template's UID orphans no dynamic field. No-op when the template carries no effect. The
/// `ConsumableEffect` has `drop`, so removal just discards.
public(package) fun y17(template: &mut ItemTemplate) {
  if (has_effect(template)) {
    let _: ConsumableEffect = df::remove(item::y57(template), EffectKey {});
  }
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun kind(self: &ConsumableEffect): u8 { self.kind }

public fun amount(self: &ConsumableEffect): u64 { self.amount }
