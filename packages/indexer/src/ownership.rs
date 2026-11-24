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
    /// Canonical package identity. Certified game defining IDs normalize to their lineage original.
    pub package: String,
    pub module: String,
    pub name: String,
    pub type_params: Vec<String>,
}

impl TypeKey {
    /// Exact type identity, never a substring match.
    pub fn is(&self, package: &str, module: &str, name: &str) -> bool {
        self.package == package && self.module == module && self.name == name
    }

    /// The `Field<K, V>` KEY type parameter of a dynamic field.
    pub fn field_key(&self) -> Option<&str> {
        self.is(SUI_FRAMEWORK, "dynamic_field", "Field")
            .then(|| self.type_params[0].as_str())
    }
}

/// One object as the resolver sees it.
#[derive(Debug, Clone)]
pub struct ObjView<'a> {
    pub id: Id,
    pub version: u64,
    pub owner: OwnerKind,
    pub type_key: &'a TypeKey,
    pub bytes: &'a [u8],
}

impl ObjView<'_> {
    /// Decode a type-matched object. A failure is layout drift, never noise: it stops the
    /// checkpoint loudly instead of letting the watermark pass unprojected state.
    pub fn decode<T: serde::de::DeserializeOwned>(&self) -> anyhow::Result<T> {
        decode::from_bytes(self.bytes).map_err(|error| {
            let t = self.type_key;
            anyhow::anyhow!(
                "layout drift: {}::{}::{}<{}> {} failed decode: {error}",
                t.package,
                t.module,
                t.name,
                t.type_params.join(", "),
                self.id.hex()
            )
        })
    }
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
    /// Immutable personal custody, witnessed by a cap or owner marker (including read inputs).
    KioskOwned {
        kiosk: Id,
        owner: Addr,
        personal_cap: Option<Id>,
    },
    /// `(Kiosk)-[:HOLDS]->(object)` — kiosk custody (placed or locked).
    /// `label` is the child's node label ("Character" | "Item") — the resolver
    /// knows the type, so the Cypher lookup stays index-backed (never a
    /// label-less full-graph scan).
    KioskHolds {
        kiosk: Id,
        object: Id,
        label: &'static str,
        /// The immutable owner witnessed by a personal cap or marker in this transaction.
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

/// The canonical full-width `0x2` framework address (TypeKey convention).
pub const SUI_FRAMEWORK: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000002";

/// A `0x2::dynamic_field::Field<0x2::dynamic_object_field::Wrapper<K>, ID>`
/// whose authored key type is exact — never a substring match.
fn is_dynamic_object_field_with_key(t: &TypeKey, key_package: &str, key_path: &str) -> bool {
    t.is(SUI_FRAMEWORK, "dynamic_field", "Field")
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

    let owners = crate::personal_kiosk::owners(objects)?;
    let mut facts: Vec<_> = owners
        .iter()
        .map(|(kiosk, owner)| Custody::KioskOwned {
            kiosk: *kiosk,
            owner: owner.address,
            personal_cap: owner.cap,
        })
        .collect();
    for view in by_id.values() {
        let t = view.type_key;

        // ── the two-hop children: game Character / Item under a wrapper ──
        // (An Item at an "address" is an EQUIPPED item — the address IS its
        // character's id, equipment.move sends to id.to_address(). NOT a
        // custody fact: the equipment-map DF is the one home.)
        if t.package == game_package && (t.name == "Character" || t.name == "Item") {
            if let OwnerKind::Object(wrapper_id) = view.owner {
                let Some(wrapper) = by_id.get(&wrapper_id) else {
                    continue; // wrapper untouched ⇒ custody unchanged
                };
                let OwnerKind::Object(parent) = wrapper.owner else {
                    continue;
                };
                if is_dynamic_object_field_with_key(wrapper.type_key, SUI_FRAMEWORK, "kiosk::Item")
                {
                    let field =
                        wrapper.decode::<Field<DynamicObjectFieldWrapper<KioskItemKey>, Id>>()?;
                    // wrapper key pins the child id — assert, never assume
                    if field.name.name.id == view.id {
                        let owner = owners.get(&parent).map(|owner| owner.address);
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
                    let field =
                        wrapper.decode::<Field<DynamicObjectFieldWrapper<FighterKey>, Id>>()?;
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
        if t.package == game_package && t.name == "Giftcard" {
            if let OwnerKind::Address(user) = view.owner {
                facts.push(Custody::VoucherHeld {
                    user,
                    giftcard: view.id,
                });
            }
            continue;
        }
        // the soulbound claims (grind-safe rolls) sit at their owner's address
        if t.package == game_package && (t.name == "BoxClaim" || t.name == "CrushClaim") {
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
