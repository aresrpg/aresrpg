// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Custody resolution — who holds what, from checkpoint object owners alone.
//!
//! PURE: a checkpoint's object views in, custody facts out — no store reads.
//! The chain encodes custody in the OWNER of each object (README, law 4):
//!
//! * a kiosk-held object's owner is `ObjectOwner(wrapper)` where the wrapper is
//!   a `dynamic_field::Field<dynamic_object_field::Wrapper<kiosk::Item>, ID>`
//!   whose OWN owner is the kiosk — the two-hop walk;
//! * a fight-held Character's owner is `ObjectOwner(wrapper)` where the wrapper
//!   is `Field<Wrapper<fight::FighterKey(seat)>, ID>` owned by the Fight — same walk,
//!   and the KEY carries the seat;
//! * an EQUIPPED item's owner is `AddressOwner(character-id-as-address)` — the
//!   TYPE disambiguates the address space: by construction an `Item` never sits
//!   at a wallet (kiosk-locked or sent to its character), so Item + address ⇒
//!   equipped. No state lookup needed;
//! * a `Giftcard` / `PurchaseCap` at an address ⇒ a wallet holds it.
//!
//! A game child ending at an Address/Shared/Immutable owner produces NO fact
//! BY DESIGN: an Item at an address is EQUIPPED (the equipment-map DF rewrites
//! its edges in the same tx — one home), and the kiosk-lock rule makes every
//! other wallet/shared terminal state unreachable for game objects.
//!
//! The walk only resolves when the wrapper is IN the checkpoint — which is
//! exactly every moment the binding changes (mint / place / take / trade /
//! custody enter / custody exit both output the wrapper). A child mutating
//! WITHOUT its wrapper means custody did not change; existing edges stand.

use std::collections::HashMap;

use crate::decode::{self, Addr, DynamicObjectFieldWrapper, Field, FighterKey, Id, KioskItemKey};

/// A checkpoint object's owner, simplified to what custody needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerKind {
    Address(Addr),
    Object(Id),
    Shared,
    Immutable,
    /// Ownership kinds the game never uses (consensus Party, future variants) —
    /// the OBJECT still projects its node; only custody stays silent.
    Other,
}

/// What one object IS, simplified from its struct tag. `type_params` are the
/// fully-qualified inner types for generics (`Field<K, V>` → `[K, V]`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeKey {
    /// Defining package, canonical `0x…` (the ORIGINAL id — Sui type identity).
    pub package: String,
    pub module: String,
    pub name: String,
    pub type_params: Vec<String>,
}

/// One object as the resolver sees it.
#[derive(Debug, Clone)]
pub struct ObjView<'a> {
    pub id: Id,
    pub owner: OwnerKind,
    pub type_key: &'a TypeKey,
    pub bytes: &'a [u8],
}

/// A resolved custody fact — `graph.rs` turns each into the ONE ownership edge
/// of its object (replacing whatever edge stood before, law 4).
///
/// NO `Equipped` fact exists on purpose: an equipped item's state has ONE home,
/// the character's equipment-map DF (it carries the slot; it mutates in the
/// same tx as the send). The resolver still OWNS the seam's knowledge — an
/// `Item` at an "address" is a character's, never a wallet's — by never minting
/// a wallet fact for it (asserted in tests).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Custody {
    /// `(Kiosk)-[:HOLDS]->(object)` — kiosk custody (placed or locked).
    /// `label` is the child's node label ("Character" | "Item") — the resolver
    /// knows the type, so the Cypher lookup stays index-backed (never a
    /// label-less full-graph scan).
    KioskHolds {
        kiosk: Id,
        object: Id,
        label: &'static str,
        /// The kiosk's owner when the kiosk is co-present (it is at every
        /// lock/place/trade) — keeps `Character.owner` fresh through custody.
        owner: Option<Addr>,
    },
    /// `(Fight)-[:FIGHTER {seat}]->(Character)` — fight custody.
    FightSeats { fight: Id, seat: u64, character: Id },
    /// `(User)-[:HOLDS_VOUCHER]->(Giftcard)`.
    VoucherHeld { user: Addr, giftcard: Id },
    /// `(User)-[:HOLDS_CLAIM]->(BoxClaim | CrushClaim)` — the soulbound
    /// grind-safe roll claims (they never transfer; the edge replaces anyway).
    ClaimHeld {
        user: Addr,
        claim: Id,
        label: &'static str,
    },
}

/// Is this type the game's, by ORIGINAL package id (Sui type identity)?
fn is_game(t: &TypeKey, game_package: &str) -> bool {
    t.package == game_package
}

/// The canonical full-width `0x2` framework address (TypeKey convention).
pub const SUI_FRAMEWORK: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000002";

fn is_native(t: &TypeKey, module: &str, name: &str) -> bool {
    t.package == SUI_FRAMEWORK && t.module == module && t.name == name
}

/// A `0x2::dynamic_field::Field<0x2::dynamic_object_field::Wrapper<K>, ID>`
/// whose authored key type is exact — never a substring match.
fn is_dynamic_object_field_with_key(t: &TypeKey, key_package: &str, key_path: &str) -> bool {
    is_native(t, "dynamic_field", "Field")
        && t.type_params.first().is_some_and(|key| {
            key == &format!(
                "{SUI_FRAMEWORK}::dynamic_object_field::Wrapper<{key_package}::{key_path}>"
            )
        })
}

/// Resolve every custody fact this checkpoint's objects can prove.
///
/// `objects` must carry the checkpoint's INPUT and OUTPUT views together (the
/// pre-state names what deletions and exits were — README, law 2); output
/// views must come LAST so a same-checkpoint move resolves to the newest owner.
///
/// A decode failure of a type-matched wrapper/cap is a LAYOUT DRIFT, never
/// noise (type identity pins these to our package or `0x2`) — it errors the
/// whole checkpoint so the stall is loud instead of the graph rotting silently
/// under an advancing watermark (the no-silent-failures law).
pub fn resolve(objects: &[ObjView<'_>], game_package: &str) -> anyhow::Result<Vec<Custody>> {
    // Newest view of every object wins (inputs first, outputs last).
    let mut by_id: HashMap<Id, &ObjView> = HashMap::new();
    for view in objects {
        by_id.insert(view.id, view);
    }

    let mut facts = vec![];
    for view in by_id.values() {
        let t = view.type_key;

        // ── the two-hop children: game Character / Item under a wrapper ──
        // (An Item at an "address" is an EQUIPPED item — the address IS its
        // character's id, equipment.move sends to id.to_address(). NOT a
        // custody fact: the equipment-map DF is the one home.)
        if is_game(t, game_package) && (t.name == "Character" || t.name == "Item") {
            if let OwnerKind::Object(wrapper_id) = view.owner {
                let Some(wrapper) = by_id.get(&wrapper_id) else {
                    continue; // wrapper untouched ⇒ custody unchanged
                };
                let OwnerKind::Object(parent) = wrapper.owner else {
                    continue;
                };
                if is_dynamic_object_field_with_key(wrapper.type_key, SUI_FRAMEWORK, "kiosk::Item")
                {
                    let field = decode::from_bytes::<
                        Field<DynamicObjectFieldWrapper<KioskItemKey>, Id>,
                    >(wrapper.bytes)
                    .map_err(|e| drift("kiosk::Item wrapper", wrapper.id, e))?;
                    // wrapper key pins the child id — assert, never assume
                    if field.name.name.id == view.id {
                        // the kiosk's owner rides along when co-present (it is
                        // at every lock/place/trade) → Character.owner freshness
                        let owner = match by_id.get(&parent) {
                            Some(k) if is_native(k.type_key, "kiosk", "Kiosk") => Some(
                                decode::from_bytes::<decode::Kiosk>(k.bytes)
                                    .map_err(|e| drift("kiosk::Kiosk", k.id, e))?
                                    .owner,
                            ),
                            _ => None,
                        };
                        facts.push(Custody::KioskHolds {
                            kiosk: parent,
                            object: view.id,
                            label: if t.name == "Character" {
                                "Character"
                            } else {
                                "Item"
                            },
                            owner,
                        });
                    }
                } else if is_dynamic_object_field_with_key(
                    wrapper.type_key,
                    game_package,
                    "fight::FighterKey",
                ) {
                    let field = decode::from_bytes::<
                        Field<DynamicObjectFieldWrapper<FighterKey>, Id>,
                    >(wrapper.bytes)
                    .map_err(|e| drift("FighterKey wrapper", wrapper.id, e))?;
                    if field.value == view.id {
                        facts.push(Custody::FightSeats {
                            fight: parent,
                            seat: field.name.name.0,
                            character: view.id,
                        });
                    }
                }
            }
            continue;
        }

        // ── wallet-held rights ──
        if is_game(t, game_package) && t.name == "Giftcard" {
            if let OwnerKind::Address(user) = view.owner {
                facts.push(Custody::VoucherHeld {
                    user,
                    giftcard: view.id,
                });
            }
            continue;
        }
        // the soulbound claims (grind-safe rolls) sit at their owner's address
        if is_game(t, game_package) && (t.name == "BoxClaim" || t.name == "CrushClaim") {
            if let OwnerKind::Address(user) = view.owner {
                facts.push(Custody::ClaimHeld {
                    user,
                    claim: view.id,
                    label: if t.name == "BoxClaim" {
                        "BoxClaim"
                    } else {
                        "CrushClaim"
                    },
                });
            }
            continue;
        }
    }
    Ok(facts)
}

fn drift(what: &str, id: Id, error: anyhow::Error) -> anyhow::Error {
    anyhow::anyhow!("layout drift: {what} {} failed decode: {error}", id.hex())
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[cfg(test)]
mod tests {
    use super::*;

    const GAME: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SUI: &str = "0x0000000000000000000000000000000000000000000000000000000000000002";

    fn t(package: &str, module: &str, name: &str, params: &[&str]) -> TypeKey {
        TypeKey {
            package: package.into(),
            module: module.into(),
            name: name.into(),
            type_params: params.iter().map(|p| p.to_string()).collect(),
        }
    }

    #[test]
    fn captured_kiosk_two_hop_resolves_holds() {
        let character_type = t(GAME, "character", "Character", &[]);
        let wrapper_type = t(
            SUI,
            "dynamic_field",
            "Field",
            &[
                "0x0000000000000000000000000000000000000000000000000000000000000002::dynamic_object_field::Wrapper<0x0000000000000000000000000000000000000000000000000000000000000002::kiosk::Item>",
                "0x0000000000000000000000000000000000000000000000000000000000000002::object::ID",
            ],
        );
        // Live testnet capture: wrapper 0x759406…a07f @ version 981006460,
        // transaction EDhfar…Kaq6, captured 2026-08-17.
        let wrapper_bytes = hex::decode(concat!(
            "759406de53dc0570802d762b4ae48ab88580b32c8c4a3ce7d119908cf77fa07f",
            "1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69",
            "1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69",
        ))
        .unwrap();
        let child = Id(hex::decode(
            "1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69",
        )
        .unwrap()
        .try_into()
        .unwrap());
        let kiosk = Id(hex::decode(
            "77a7927ddf70d1642cd27cfe220c162383d9fdd891a56792d061aec6c878bb92",
        )
        .unwrap()
        .try_into()
        .unwrap());
        let wrapper_id = Id(hex::decode(
            "759406de53dc0570802d762b4ae48ab88580b32c8c4a3ce7d119908cf77fa07f",
        )
        .unwrap()
        .try_into()
        .unwrap());

        let objects = [
            ObjView {
                id: child,
                owner: OwnerKind::Object(wrapper_id),
                type_key: &character_type,
                bytes: &[],
            },
            ObjView {
                id: wrapper_id,
                owner: OwnerKind::Object(kiosk),
                type_key: &wrapper_type,
                bytes: &wrapper_bytes,
            },
        ];
        assert_eq!(
            resolve(&objects, GAME).unwrap(),
            vec![Custody::KioskHolds {
                kiosk,
                object: child,
                label: "Character",
                owner: None,
            }]
        );
    }

    #[test]
    fn fight_wrapper_resolves_seat() {
        let character_type = t(GAME, "character", "Character", &[]);
        let wrapper_type = t(
            SUI,
            "dynamic_field",
            "Field",
            &[
                "0x0000000000000000000000000000000000000000000000000000000000000002::dynamic_object_field::Wrapper<0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::fight::FighterKey>",
                "0x0000000000000000000000000000000000000000000000000000000000000002::object::ID",
            ],
        );
        let character = Id([1; 32]);
        let fight = Id([9; 32]);
        let wrapper_id = Id([3; 32]);
        let wrapper_bytes = bcs::to_bytes(&Field {
            id: wrapper_id,
            name: DynamicObjectFieldWrapper {
                name: FighterKey(4),
            },
            value: character,
        })
        .unwrap();

        let objects = [
            ObjView {
                id: character,
                owner: OwnerKind::Object(wrapper_id),
                type_key: &character_type,
                bytes: &[],
            },
            ObjView {
                id: wrapper_id,
                owner: OwnerKind::Object(fight),
                type_key: &wrapper_type,
                bytes: &wrapper_bytes,
            },
        ];
        assert_eq!(
            resolve(&objects, GAME).unwrap(),
            vec![Custody::FightSeats {
                fight,
                seat: 4,
                character
            }]
        );
    }

    #[test]
    fn item_at_address_mints_no_wallet_fact() {
        // an equipped item sits at its CHARACTER's id-as-address — the resolver
        // must never read that as a wallet holding anything (the equipment-map
        // DF is the one home of equip state).
        let item_type = t(GAME, "item", "Item", &[]);
        let character_as_addr = Addr([7; 32]);
        let objects = [ObjView {
            id: Id([1; 32]),
            owner: OwnerKind::Address(character_as_addr),
            type_key: &item_type,
            bytes: &[],
        }];
        assert!(resolve(&objects, GAME).unwrap().is_empty());
    }

    #[test]
    fn foreign_package_never_resolves() {
        let foreign = t(
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "item",
            "Item",
            &[],
        );
        let objects = [ObjView {
            id: Id([1; 32]),
            owner: OwnerKind::Address(Addr([7; 32])),
            type_key: &foreign,
            bytes: &[],
        }];
        assert!(resolve(&objects, GAME).unwrap().is_empty());
    }

    #[test]
    fn untouched_wrapper_means_no_custody_claim() {
        // child mutated alone (kiosk borrow_mut) — wrapper absent ⇒ no fact,
        // the standing edge is left alone.
        let character_type = t(GAME, "character", "Character", &[]);
        let objects = [ObjView {
            id: Id([1; 32]),
            owner: OwnerKind::Object(Id([3; 32])),
            type_key: &character_type,
            bytes: &[],
        }];
        assert!(resolve(&objects, GAME).unwrap().is_empty());
    }
}
