// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Unit tests for the pure event→Redis projection ([`super::map`]).
//!
//! Synthetic bodies here exercise projection semantics only. Decode/layout coverage
//! lives in captured-wire tests and the Move↔Rust parity gate.

use super::*; // map, RedisWrite, the write/key helpers, and the model types (re-globbed)
use serde::Serialize;
use serde_json::json;
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};

fn oid(fill: u8) -> ObjectID {
    ObjectID::from_bytes([fill; 32]).unwrap()
}
fn saddr(fill: u8) -> SuiAddress {
    SuiAddress::from_bytes([fill; 32]).unwrap()
}
fn enc<T: Serialize>(v: &T) -> Vec<u8> {
    bcs::to_bytes(v).unwrap()
}

const PKG: &str = "0xace"; // stand-in emitting package (map is address-agnostic except version liveness)
const SENDER: &str = "0x5e11e2"; // stand-in tx sender
const TS: u64 = 1_700_000_000_000; // stand-in checkpoint timestamp (the sale "when")

// ── pools: absolute reserves in, idempotent sets out ─────────────────────────

#[test]
fn pool_buy_sets_absolute_reserves_not_relative() {
    let pool = oid(0x11);
    let body = enc(&PoolBuy {
        pool,
        template: oid(0x22),
        buyer: saddr(0x33),
        quantity: 3,
        sui_in: 42,
        item_reserve: 497,
        real_sui: 1_042,
    });
    let w = map("pool", "PoolBuy", PKG, SENDER, TS, &body).unwrap();
    let ps = pool.to_canonical_string(true);
    assert_eq!(
        w,
        vec![
            set(k_pool(&ps), "$.item_reserve", json!(497)),
            set(k_pool(&ps), "$.real_sui_mist", json!("1042")),
        ]
    );
    // No relative counter — replay-safe.
    assert!(w.iter().all(|x| !matches!(x, RedisWrite::NumIncrBy { .. })));
}

// ── shop: created is a full upsert; bought is the one documented relative counter ─

#[test]
fn sale_created_seeds_supply_and_index() {
    let (sale, tmpl) = (oid(0x44), oid(0x55));
    let body = enc(&SaleCreated {
        sale,
        template: tmpl,
        price: 250,
        supply: Some(10),
    });
    let w = map("shop", "SaleCreated", PKG, SENDER, TS, &body).unwrap();
    let ss = sale.to_canonical_string(true);
    assert_eq!(
        w,
        vec![
            set(
                k_sale(&ss),
                "$",
                json!({
                    "sale": ss, "template": tmpl.to_canonical_string(true), "price_mist": "250",
                    "supply": 10, "minted": 0, "paused": false, "start_ms": null, "end_ms": null,
                })
            ),
            sadd(K_SALES.into(), ss),
        ]
    );
}

#[test]
fn sale_created_then_burned_removes_document_and_shop_index() {
    let (sale, template) = (oid(0x44), oid(0x55));
    let sale_id = sale.to_canonical_string(true);
    let sale_key = k_sale(&sale_id);
    let created = map(
        "shop",
        "SaleCreated",
        PKG,
        SENDER,
        TS,
        &enc(&SaleCreated {
            sale,
            template,
            price: 250,
            supply: Some(10),
        }),
    )
    .unwrap();
    let burned = map(
        "shop",
        "SaleBurned",
        PKG,
        SENDER,
        TS,
        &enc(&SaleBurned {
            sale,
            template,
            minted: 3,
        }),
    )
    .unwrap_or_default();

    let mut documents = std::collections::HashSet::new();
    let mut shop_index = std::collections::HashSet::new();
    for write in created.iter().chain(&burned) {
        match write {
            RedisWrite::Set { key, path, .. } if key == &sale_key && path == "$" => {
                documents.insert(key.clone());
            }
            RedisWrite::Del { key, path } if key == &sale_key && path == "$" => {
                documents.remove(key);
            }
            RedisWrite::SetAdd { key, member } if key == K_SALES && member == &sale_id => {
                shop_index.insert(member.clone());
            }
            RedisWrite::SetDel { key, member } if key == K_SALES && member == &sale_id => {
                shop_index.remove(member);
            }
            _ => {}
        }
    }

    assert!(
        !shop_index.contains(&sale_id),
        "burn left sale in rpc:idx:sales"
    );
    assert!(
        !documents.contains(&sale_key),
        "burn left rpc:sale document"
    );
}

#[test]
fn sale_bought_increments_minted_by_amount() {
    let sale = oid(0x44);
    let item = oid(0x77);
    let body = enc(&SaleBought {
        sale,
        template: oid(0x55),
        buyer: saddr(0x66),
        item,
        price: 250,
        amount: 3,
    });
    let w = map("shop", "SaleBought", PKG, SENDER, TS, &body).unwrap();
    let receipt = json!({
        "sale": sale.to_canonical_string(true),
        "item": item.to_canonical_string(true),
        "price_mist": "250",
        "amount": 3,
        "ts": TS,
    })
    .to_string();
    assert_eq!(
        w,
        vec![
            incr(k_sale(&sale.to_canonical_string(true)), "$.minted", 3),
            zadd(K_SALES_OVER_TIME.into(), TS as i64, receipt),
            zrem_score_through(
                K_SALES_OVER_TIME.into(),
                TS.saturating_sub(SALES_OVER_TIME_RETENTION_MS) as i64,
            ),
        ]
    );
}

#[test]
fn sale_bought_history_receipt_is_idempotent_on_replay() {
    let event = enc(&SaleBought {
        sale: oid(0x44),
        template: oid(0x55),
        buyer: saddr(0x66),
        item: oid(0x77),
        price: 250,
        amount: 3,
    });
    let first = map("shop", "SaleBought", PKG, SENDER, TS, &event).unwrap();
    let replay = map("shop", "SaleBought", PKG, SENDER, TS, &event).unwrap();
    assert_eq!(first, replay);
}

#[test]
fn sale_unlimited_supply_serializes_null() {
    let sale = oid(0x44);
    let body = enc(&SaleCreated {
        sale,
        template: oid(0x55),
        price: 1,
        supply: None,
    });
    let w = map("shop", "SaleCreated", PKG, SENDER, TS, &body).unwrap();
    match &w[0] {
        RedisWrite::Set { json, .. } => assert!(json.contains("\"supply\":null")),
        _ => panic!("expected doc upsert"),
    }
}

// ── characters: owner comes from the tx SENDER, equipment keyed by item id ────

#[test]
fn character_created_records_name_class_owner_and_indexes() {
    let ch = oid(0x88);
    let body = enc(&CharacterCreated {
        character: ch,
        name: "Aiden".into(),
        class: "sram".into(),
        price: 5,
    });
    let w = map("creation", "CharacterCreated", PKG, SENDER, TS, &body).unwrap();
    let cs = ch.to_canonical_string(true);
    let key = k_character(&cs);
    assert_eq!(
        w,
        vec![
            set_nx(key.clone(), "$", json!({ "id": cs, "equipment": {} })),
            set(key.clone(), "$.name", json!("Aiden")),
            set(key.clone(), "$.class", json!("sram")),
            set(key, "$.owner", json!(SENDER)),
            sadd(k_char_owner(SENDER), cs.clone()),
            sadd(k_char_name("Aiden"), cs),
        ]
    );
}

#[test]
fn item_equipped_writes_bracket_keyed_equipment_entry() {
    let (ch, item, tmpl) = (oid(0x88), oid(0x99), oid(0xaa));
    let body = enc(&ItemEquip {
        character: ch,
        item,
        template: tmpl,
        amount: 1,
    });
    let w = map("extract", "ItemEquipped", PKG, SENDER, TS, &body).unwrap();
    let (cs, is) = (ch.to_canonical_string(true), item.to_canonical_string(true));
    let key = k_character(&cs);
    assert_eq!(
        w,
        vec![
            set_nx(key.clone(), "$", json!({ "id": cs, "equipment": {} })),
            set(
                key,
                &format!("$.equipment[\"{is}\"]"),
                json!({ "template": tmpl.to_canonical_string(true), "amount": 1 })
            ),
        ]
    );
}

#[test]
fn equipment_cursor_tracks_both_identity_mutations() {
    let character = oid(0x88);
    let body = enc(&ItemEquip {
        character,
        item: oid(0x99),
        template: oid(0xaa),
        amount: 1,
    });
    let key = k_character(&character.to_canonical_string(true));
    for name in ["ItemEquipped", "ItemUnequipped"] {
        assert_eq!(
            super::super::equipment_cursor_write("extract", name, &body, 488, 7),
            Some(set(
                key.clone(),
                "$.equipment_cursor",
                json!({ "checkpoint": 488, "tx_index": 7 })
            ))
        );
    }
    assert_eq!(
        super::super::equipment_cursor_write("item", "ItemMinted", &body, 488, 7),
        None
    );
}

#[test]
fn item_unequipped_deletes_the_entry() {
    let (ch, item) = (oid(0x88), oid(0x99));
    let body = enc(&ItemEquip {
        character: ch,
        item,
        template: oid(0xaa),
        amount: 1,
    });
    let w = map("extract", "ItemUnequipped", PKG, SENDER, TS, &body).unwrap();
    let (cs, is) = (ch.to_canonical_string(true), item.to_canonical_string(true));
    assert_eq!(
        w,
        vec![del(k_character(&cs), &format!("$.equipment[\"{is}\"]"))]
    );
}

// ── encyclopedia templates + listing feed ────────────────────────────────────

#[test]
fn template_created_lives_and_indexes() {
    let t = oid(0xbb);
    let body = enc(&Template {
        template: t,
        item_type: "weapon".into(),
    });
    let w = map("item", "TemplateCreated", PKG, SENDER, TS, &body).unwrap();
    let ts = t.to_canonical_string(true);
    assert_eq!(
        w,
        vec![
            // NX-init + per-field set (no full `$` replace) so the object snapshot can co-enrich the doc.
            set_nx(
                k_template(&ts),
                "$",
                json!({ "template": ts, "live": true })
            ),
            set(k_template(&ts), "$.item_type", json!("weapon")),
            sadd(K_TEMPLATES.into(), ts),
        ]
    );
}

#[test]
fn template_created_then_renamed_reuses_one_document_and_index_member() {
    #[derive(Serialize)]
    struct TemplateRenamedFixture {
        template: ObjectID,
        name: String,
    }

    let template = oid(0xbc);
    let template_id = template.to_canonical_string(true);
    let template_key = k_template(&template_id);
    let created = map(
        "item",
        "TemplateCreated",
        PKG,
        SENDER,
        TS,
        &enc(&Template {
            template,
            item_type: "cloak".into(),
        }),
    )
    .unwrap_or_default();
    let snapshotted = super::super::snapshot::map_item_template_object(
        &template_id,
        &enc(&ItemTemplateObject {
            id: template,
            name: "Lorito Cloak (Agility)".into(),
            description: "Old description".into(),
            item_type: "cloak".into(),
            category: "cloak".into(),
            level: 1,
        }),
    )
    .unwrap_or_default();
    let renamed = map(
        "item",
        "TemplateRenamed",
        PKG,
        SENDER,
        TS + 1,
        &enc(&TemplateRenamedFixture {
            template,
            name: "Lorito Cloak (Emerald)".into(),
        }),
    )
    .unwrap_or_default();

    let mut document_keys = std::collections::HashSet::new();
    let mut index_entries = std::collections::HashSet::new();
    let mut projected_name = None;
    for write in created.iter().chain(&snapshotted).chain(&renamed) {
        match write {
            RedisWrite::Set {
                key, path, json, ..
            } => {
                document_keys.insert(key.clone());
                if path == "$.name" {
                    projected_name = serde_json::from_str(json).ok();
                }
            }
            RedisWrite::SetAdd { key, member } => {
                index_entries.insert((key.clone(), member.clone()));
            }
            _ => {}
        }
    }

    assert_eq!(
        document_keys,
        std::collections::HashSet::from([template_key])
    );
    assert_eq!(
        index_entries,
        std::collections::HashSet::from([(K_TEMPLATES.into(), template_id)])
    );
    assert_eq!(projected_name, Some("Lorito Cloak (Emerald)"));
}

// ── item supply arm: SUM-of-units mint/burn counter (rpc:supply:{template}) ──

#[test]
fn item_minted_seeds_and_bumps_supply_by_amount() {
    let (item, tmpl) = (oid(0x11), oid(0x22));
    let body = enc(&ItemMinted {
        item,
        template: tmpl,
        item_type: "potion".into(),
        amount: 5,
    });
    let w = map("item", "ItemMinted", PKG, SENDER, TS, &body).unwrap();
    let (is, ts) = (
        item.to_canonical_string(true),
        tmpl.to_canonical_string(true),
    );
    assert_eq!(
        w,
        vec![
            set_nx(k_item(&is), "$", json!({ "id": is, "level": Value::Null })),
            set(k_item(&is), "$.template", json!(ts)),
            set(k_item(&is), "$.item_type", json!("potion")),
            set_nx(k_supply(&ts), "$", json!({ "template": ts, "amount": 0 })),
            incr(k_supply(&ts), "$.amount", 5),
        ]
    );
}

#[test]
fn item_burned_decrements_supply_by_the_destroyed_amount() {
    let (item, tmpl) = (oid(0x11), oid(0x22));
    // extract::burn always destroys the WHOLE item object and reports its full `amount` —
    // there is no partial/unit-level consume door (verified against extract.move).
    let body = enc(&ItemBurned {
        item,
        template: tmpl,
        amount: 3,
    });
    let w = map("extract", "ItemBurned", PKG, SENDER, TS, &body).unwrap();
    let (is, ts) = (
        item.to_canonical_string(true),
        tmpl.to_canonical_string(true),
    );
    assert_eq!(
        w,
        vec![
            del(k_item(&is), "$"),
            del(k_pet_feed(&is), "$"),
            del(k_listing(&is), "$"),
            srem(K_LISTINGS.into(), is),
            set_nx(k_supply(&ts), "$", json!({ "template": ts, "amount": 0 })),
            incr(k_supply(&ts), "$.amount", -3),
        ]
    );
}

#[test]
fn pet_power_advanced_sets_absolute_feed_state() {
    let pet = oid(0x33);
    let body = enc(&PetPowerAdvanced {
        pet,
        feeder: saddr(0x44),
        feed_count: 7,
        next_feed_ms: 1_700_064_000_000,
    });
    let w = map("pet", "PetPowerAdvanced", PKG, SENDER, TS, &body).unwrap();
    let pet = pet.to_canonical_string(true);
    assert_eq!(
        w,
        vec![set(
            k_pet_feed(&pet),
            "$",
            json!({ "pet": pet, "feed_count": 7, "next_feed_at_ms": 1_700_064_000_000u64 })
        )]
    );
}

#[test]
fn food_power_set_adds_template_to_pet_food_allowlist() {
    let food_template = oid(0x55);
    let body = enc(&FoodPowerSet {
        food_template,
        power_per_unit: 1,
    });
    let w = map("pet", "FoodPowerSet", PKG, SENDER, TS, &body).unwrap();
    assert_eq!(
        w,
        vec![sadd(
            K_PET_FEED_FOODS.into(),
            food_template.to_canonical_string(true)
        )]
    );
}

#[test]
fn supply_drift_check_two_mints_one_burn_nets_to_one() {
    // The exact drift gate: create + create + delete -> net supply 1. Two non-stackable
    // mints (amount=1 each) of the SAME template, then one of the two instances burned (amount=1).
    // Sums every NUMINCRBY delta the arm projects against that template's supply key and asserts
    // the net lands on 1 — proves the counter is drift-free under the mint/burn pairing (merge/
    // split are net-zero by construction and deliberately untracked, so they can't be a drift
    // source either — see the k_supply doc comment).
    let tmpl = oid(0x22);
    let mint = |item: ObjectID| {
        enc(&ItemMinted {
            item,
            template: tmpl,
            item_type: "sword".into(),
            amount: 1,
        })
    };
    let burn = |item: ObjectID| {
        enc(&ItemBurned {
            item,
            template: tmpl,
            amount: 1,
        })
    };

    let w1 = map("item", "ItemMinted", PKG, SENDER, TS, &mint(oid(0x31))).unwrap();
    let w2 = map("item", "ItemMinted", PKG, SENDER, TS, &mint(oid(0x32))).unwrap();
    let w3 = map("extract", "ItemBurned", PKG, SENDER, TS, &burn(oid(0x31))).unwrap();

    let ts = tmpl.to_canonical_string(true);
    let net: i64 = [w1, w2, w3]
        .iter()
        .flatten()
        .filter_map(|w| match w {
            RedisWrite::NumIncrBy { key, path, by }
                if *key == k_supply(&ts) && path == "$.amount" =>
            {
                Some(*by)
            }
            _ => None,
        })
        .sum();
    assert_eq!(net, 1);
}

#[test]
fn kiosk_item_listed_uses_sender_as_seller_and_records_the_kiosk_directory() {
    let (kiosk, item) = (oid(0xcc), oid(0xdd));
    let body = enc(&KioskItemListed {
        kiosk,
        id: item,
        price: 1200,
    });
    let w = map("kiosk", "ItemListed", "0x2", SENDER, TS, &body).unwrap();
    let is = item.to_canonical_string(true);
    let ks = kiosk.to_canonical_string(true);
    assert_eq!(
        w,
        vec![
            set(
                k_listing(&is),
                "$",
                json!({
                    "item_id": is, "kiosk": ks,
                    "price_mist": "1200", "seller": SENDER,
                })
            ),
            sadd(K_LISTINGS.into(), is),
            // the durable seller→kiosk edge sales-history resolves `?seller=` through
            sadd(k_seller_kiosks(SENDER), ks),
        ]
    );
}

#[test]
fn kiosk_delist_removes_the_listing_exactly() {
    let item = oid(0xdd);
    let is = item.to_canonical_string(true);
    let delisted = map(
        "kiosk",
        "ItemDelisted",
        "0x2",
        SENDER,
        TS,
        &enc(&KioskItemDelisted {
            kiosk: oid(0xcc),
            id: item,
        }),
    )
    .unwrap();
    assert_eq!(
        delisted,
        vec![del(k_listing(&is), "$"), srem(K_LISTINGS.into(), is)]
    );
}

#[test]
fn kiosk_purchase_drops_listing_and_logs_a_capped_idempotent_sale() {
    let (kiosk, item) = (oid(0xcc), oid(0xdd));
    let is = item.to_canonical_string(true);
    let ks = kiosk.to_canonical_string(true);
    let w = map(
        "kiosk",
        "ItemPurchased",
        "0x2",
        SENDER,
        TS,
        &enc(&KioskItemListed {
            kiosk,
            id: item,
            price: 5000,
        }),
    )
    .unwrap();

    // 1) the consumed active listing is still dropped (unchanged behaviour)…
    assert_eq!(
        &w[..2],
        &[
            del(k_listing(&is), "$"),
            srem(K_LISTINGS.into(), is.clone())
        ][..]
    );
    // 2) …then the sale is appended to the seller's per-kiosk log: a row scored by ts,
    //    a rank cap, and a refreshed idle TTL. Buyer = the purchase tx sender.
    let row = json!({ "item": is, "price_mist": "5000", "buyer": SENDER, "ts": TS }).to_string();
    assert_eq!(
        &w[2..],
        &[
            zadd(k_sales(&ks), TS as i64, row),
            zrem_rank_keep_newest(k_sales(&ks), SALES_CAP),
            expire(k_sales(&ks), SALES_TTL_SECS),
        ][..]
    );
    // The money path carries NO relative counter — replaying the batch is a no-op.
    assert!(w.iter().all(|x| !matches!(x, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn kiosk_equip_exit_does_not_create_sale_history_row() {
    let (kiosk, item) = (oid(0xcc), oid(0xdd));
    let is = item.to_canonical_string(true);
    let ks = kiosk.to_canonical_string(true);
    let body = enc(&KioskItemListed {
        kiosk,
        id: item,
        price: 0,
    });
    let w = map_with_context(
        "kiosk",
        "ItemPurchased",
        "0x2",
        SENDER,
        TS,
        &body,
        KioskPurchaseContext {
            transient_zero_listing: true,
            has_royalty_receipt: false,
            confirmed_extract_exit: true,
        },
    )
    .unwrap();

    // `extract::extract_for_equip` generates this zero-price native purchase while
    // moving an owned item from its kiosk onto its character. It closes the
    // transient listing, but it is not a sale and must never enter history.
    let phantom = json!({ "item": is, "price_mist": "0", "buyer": SENDER, "ts": TS }).to_string();
    assert_eq!(
        w,
        vec![
            del(k_listing(&is), "$"),
            srem(K_LISTINGS.into(), is.clone()),
            zrem(k_sales(&ks), phantom),
        ]
    );

    // A successful standalone zero-price ItemPurchased is a genuine purchase
    // receipt; an atomic zero-price buy with royalty proof is genuine too.
    let standalone = map("kiosk", "ItemPurchased", "0x2", SENDER, TS, &body).unwrap();
    assert!(standalone
        .iter()
        .any(|write| matches!(write, RedisWrite::ZAdd { .. })));
    let receipted = map_with_context(
        "kiosk",
        "ItemPurchased",
        "0x2",
        SENDER,
        TS,
        &body,
        KioskPurchaseContext {
            transient_zero_listing: true,
            has_royalty_receipt: true,
            confirmed_extract_exit: false,
        },
    )
    .unwrap();
    assert!(receipted
        .iter()
        .any(|write| matches!(write, RedisWrite::ZAdd { .. })));
}

#[test]
fn kiosk_purchase_row_is_idempotent_on_replay() {
    // Same event twice → byte-identical ZADD member → a Redis no-op on replay (the
    // sorted set is why the sale log needs no non-idempotent NUMINCRBY, unlike shop
    // minted). Proven at the projection level: the two projections are equal.
    let (kiosk, item) = (oid(0xcc), oid(0xdd));
    let ev = enc(&KioskItemListed {
        kiosk,
        id: item,
        price: 5000,
    });
    let a = map("kiosk", "ItemPurchased", "0x2", SENDER, TS, &ev).unwrap();
    let b = map("kiosk", "ItemPurchased", "0x2", SENDER, TS, &ev).unwrap();
    assert_eq!(a, b);
}

// ── worlds / zones ────────────────────────────────────────────────────────────

#[test]
fn zone_searched_records_counts_and_zone_index() {
    let world = oid(0xee);
    let body = enc(&ZoneSearched {
        world,
        zx: 7,
        zy: 9,
        at_ms: 1_700_000_000_000,
        mob_groups: 5,
        resource_nodes: 12,
    });
    let w = map("zones", "ZoneSearched", PKG, SENDER, TS, &body).unwrap();
    let ws = world.to_canonical_string(true);
    // NX skeleton + per-field sets (NOT a full `$` replace) so the Zone-DF object snapshot
    // (snapshot.rs `map_zone_field`) can add `$.seed` + consumed bitmaps to the SAME doc without
    // either write wiping the other.
    assert_eq!(
        w,
        vec![
            set_nx(
                k_zone(&ws, 7, 9),
                "$",
                json!({ "world": ws, "zx": 7, "zy": 9, "discovered": true })
            ),
            set(
                k_zone(&ws, 7, 9),
                "$.discovered_at_ms",
                json!(1_700_000_000_000u64)
            ),
            set(k_zone(&ws, 7, 9), "$.mob_groups", json!(5)),
            set(k_zone(&ws, 7, 9), "$.resource_nodes", json!(12)),
            sadd(k_zones(&ws), "7:9".into()),
        ]
    );
}

#[test]
fn mob_group_claimed_projects_group_template() {
    // The overworld world-fight door (aresrpg::zones claim + fight::create, ONE PTB) emits
    // MobGroupClaimed carrying the group's homogeneous MobTemplate id — the SAME id the GroupTicket
    // provenance hands `fight::create` as `content_template` → `fight.group.template`. Projected by
    // (world, spawn_id) so the /v1/fights view joins it to NAME the mobs. character/x/z/group_size are
    // unused here (the fight doc already carries the roster + mob_count).
    let world = oid(0xb0);
    let template = oid(0xb1);
    let body = enc(&MobGroupClaimed {
        world,
        character: oid(0xb2),
        spawn_id: 42,
        template,
        x: 10,
        z: 20,
        group_size: 3,
    });
    let w = map("zones", "MobGroupClaimed", PKG, SENDER, TS, &body).unwrap();
    let ws = world.to_canonical_string(true);
    assert_eq!(
        w,
        vec![set(
            k_group_template(&ws, 42),
            "$",
            json!(template.to_canonical_string(true))
        )]
    );
}

#[test]
fn world_created_seeds_the_doc_without_clobbering_the_object_snapshot() {
    // The snapshot pipeline (own watermark) writes the FULL world doc incl. `required_level`
    // (snapshot.rs `map_world_object`); the create event must only SEED the skeleton when absent
    // (NX), never reset the doc to its 3 event fields (that clobber re-created the infamous
    // "Lv 1+ on every world" state on every backfill).
    let world = oid(0x77);
    let ws = world.to_canonical_string(true);
    let w = map(
        "world",
        "WorldCreated",
        PKG,
        SENDER,
        TS,
        &enc(&WorldCreated {
            world,
            seed: 424242,
            biome: "archipelago".into(),
        }),
    )
    .unwrap();
    assert_eq!(
        w,
        vec![
            set_nx(
                k_world(&ws),
                "$",
                json!({ "world": ws, "seed": "424242", "biome": "archipelago" })
            ),
            sadd(K_WORLDS.into(), ws),
        ]
    );
}

#[test]
fn rare_link_set_and_cleared_upsert_then_remove() {
    let world = oid(0xee);
    let template = oid(0x1a);
    let rare = oid(0x9d);
    let ws = world.to_canonical_string(true);
    let ts = template.to_canonical_string(true);
    // SET: link the base template to its rare variant + index it under the world.
    let set_w = map(
        "world",
        "RareLinkSet",
        PKG,
        SENDER,
        TS,
        &enc(&RareLinkSet {
            world,
            template,
            rare_template: rare,
        }),
    )
    .unwrap();
    assert_eq!(
        set_w,
        vec![
            set(
                k_rare_link(&ws, &ts),
                "$",
                json!(rare.to_canonical_string(true))
            ),
            sadd(k_rare_links(&ws), ts.clone()),
        ]
    );
    // CLEARED: remove both the link doc and the index entry.
    let clr_w = map(
        "world",
        "RareLinkCleared",
        PKG,
        SENDER,
        TS,
        &enc(&RareLinkCleared { world, template }),
    )
    .unwrap();
    assert_eq!(
        clr_w,
        vec![del(k_rare_link(&ws, &ts), "$"), srem(k_rare_links(&ws), ts),]
    );
}

// ── config dials ──────────────────────────────────────────────────────────────

#[test]
fn dial_changed_inits_config_then_sets_dial() {
    let body = enc(&DialChanged {
        dial: "xp_multiplier".into(),
        value: 2,
    });
    let w = map("config", "DialChanged", PKG, SENDER, TS, &body).unwrap();
    assert_eq!(
        w,
        vec![
            set_nx(K_CONFIG.into(), "$", json!({ "dials": {}, "classes": {} })),
            set(K_CONFIG.into(), "$.dials[\"xp_multiplier\"]", json!(2)),
        ]
    );
}

// ── kolizeum lobby + dungeon run ──────────────────────────────────────────────

#[test]
fn kolizeum_created_opens_lobby_and_indexes() {
    let kz = oid(0x1a);
    let body = enc(&KolizeumCreated {
        kolizeum: kz,
        creator: saddr(0x2b),
        format_slots: 3,
        pledge_amount: 10_000,
        is_public: true,
    });
    let w = map("kolizeum_events", "KolizeumCreated", PKG, SENDER, TS, &body).unwrap();
    let ks = kz.to_canonical_string(true);
    match &w[0] {
        RedisWrite::Set { key, json, .. } => {
            assert_eq!(key, &k_kolizeum(&ks));
            assert!(
                json.contains("\"status\":\"open\"") && json.contains("\"pledge_mist\":\"10000\"")
            );
        }
        _ => panic!("expected lobby doc"),
    }
    assert_eq!(w[1], sadd(K_KOLIZEUMS.into(), ks));
}

/// DRIFT GUARD (the 2026-07-12 10%-cut `fee` insertion — money-hat blocker). A fixture built
/// from `KolizeumSettled` itself can never catch a missing/misplaced field (encode and decode
/// drift in lockstep and stay green — exactly how this broke). This pins the decode against an
/// INDEPENDENT mirror of the CURRENT `aresrpg_kolizeum::kolizeum_events::KolizeumSettled` source
/// order (kolizeum_events.move: kolizeum, winning_side, pot, fee, winners — `fee` inserted
/// between `pot` and `winners`). Before the fix this panics: the missing `fee: u64` desyncs the
/// byte stream, `bcs::from_bytes` leaves 8 trailing bytes, and `map()` returns `None` — settled
/// lobbies silently stuck on "started" forever. `winners` landing on the CORRECT value (not
/// `fee`'s bytes) proves `fee` occupies its own 8 bytes rather than bleeding into its neighbour.
#[test]
fn kolizeum_settled_decodes_current_onchain_field_order() {
    #[derive(serde::Serialize)]
    struct ChainKolizeumSettled {
        kolizeum: ObjectID,
        winning_side: u8,
        pot: u64,
        fee: u64,
        winners: u64,
    }
    let kz = oid(0x1a);
    let chain = ChainKolizeumSettled {
        kolizeum: kz,
        winning_side: 1,
        pot: 100_000,
        fee: 10_000,
        winners: 3,
    };
    let w = map(
        "kolizeum_events",
        "KolizeumSettled",
        PKG,
        SENDER,
        TS,
        &enc(&chain),
    )
    .expect("current-layout KolizeumSettled must decode");
    let key = k_kolizeum(&kz.to_canonical_string(true));
    assert_eq!(
        w,
        vec![
            set(key.clone(), "$.status", json!("settled")),
            set(key.clone(), "$.winning_side", json!(1)),
            set(key.clone(), "$.pot_mist", json!("100000")),
            set(key, "$.winners", json!(3)),
        ]
    );
}

#[test]
fn run_activated_records_bound_character() {
    let (pass, world, player, character) = (oid(0x3c), oid(0x4d), saddr(0x5e), oid(0x6f));
    let body = enc(&RunActivated {
        pass,
        world,
        player,
        character,
    });
    let w = map("dungeon_events", "RunActivated", PKG, SENDER, TS, &body).unwrap();
    let (ps, ws, pl, ch) = (
        pass.to_canonical_string(true),
        world.to_canonical_string(true),
        player.to_string(),
        character.to_canonical_string(true),
    );
    assert_eq!(
        w,
        vec![
            set(
                k_run(&ps),
                "$",
                json!({
                    "pass": ps, "world": ws, "player": pl, "character": ch,
                    "status": "active", "room": 1, "fight": null,
                })
            ),
            sadd(k_runs(&pl), ps),
        ]
    );
}

#[test]
fn pass_entered_fight_backfills_character() {
    let (pass, fight, world, player, character) =
        (oid(0x3c), oid(0xf1), oid(0x4d), saddr(0x5e), oid(0x6f));
    let body = enc(&PassEnteredFight {
        pass,
        fight,
        world,
        player,
        room: 2,
        character,
    });
    let w = map("dungeon_events", "PassEnteredFight", PKG, SENDER, TS, &body).unwrap();
    let ps = pass.to_canonical_string(true);
    let key = k_run(&ps);
    assert_eq!(
        w,
        vec![
            set_nx(
                key.clone(),
                "$",
                json!({
                    "pass": ps, "world": world.to_canonical_string(true),
                    "player": player.to_string(), "status": "active",
                })
            ),
            set(
                key.clone(),
                "$.character",
                json!(character.to_canonical_string(true))
            ),
            set(
                key.clone(),
                "$.fight",
                json!(fight.to_canonical_string(true))
            ),
            set(key, "$.room", json!(2)),
        ]
    );
}

#[test]
fn run_advanced_backfills_character_and_clears_fight() {
    let (pass, world, player, character) = (oid(0x3c), oid(0x4d), saddr(0x5e), oid(0x6f));
    let body = enc(&RunAdvanced {
        pass,
        world,
        player,
        room: 3,
        character,
    });
    let w = map("dungeon_events", "RunAdvanced", PKG, SENDER, TS, &body).unwrap();
    let ps = pass.to_canonical_string(true);
    let key = k_run(&ps);
    assert_eq!(
        w,
        vec![
            set_nx(
                key.clone(),
                "$",
                json!({
                    "pass": ps, "world": world.to_canonical_string(true),
                    "player": player.to_string(), "status": "active",
                })
            ),
            set(
                key.clone(),
                "$.character",
                json!(character.to_canonical_string(true))
            ),
            set(key.clone(), "$.room", json!(3)),
            set(key, "$.fight", json!(null)),
        ]
    );
}

#[test]
fn run_ended_deletes_doc_and_unindexes_owner() {
    let (pass, player, character) = (oid(0x3c), saddr(0x5e), oid(0x6f));
    let body = enc(&RunEnded {
        pass,
        world: oid(0x4d),
        player,
        reason: 2,
        return_x: 10,
        return_z: 20,
        character,
    });
    let w = map("dungeon_events", "RunEnded", PKG, SENDER, TS, &body).unwrap();
    let (ps, pl) = (pass.to_canonical_string(true), player.to_string());
    assert_eq!(w, vec![del(k_run(&ps), "$"), srem(k_runs(&pl), ps)]);
}

// ── commission: artisan-commission v2 lifecycle (aresrpg::commission) ────────

#[test]
fn craft_requested_seeds_doc_and_indexes_both_parties() {
    let request = oid(0xc0);
    let (customer, artisan) = (saddr(0xcc), saddr(0xa5));
    let recipe = oid(0x4e);
    let body = enc(&CraftRequested {
        request,
        customer,
        artisan,
        recipe,
        amount: 2_000_000_000,
    });
    let w = map("commission", "CraftRequested", PKG, SENDER, TS, &body).unwrap();
    let id = request.to_canonical_string(true);
    let (cs, ars) = (customer.to_string(), artisan.to_string());
    assert_eq!(
        w,
        vec![
            set(
                k_commission(&id),
                "$",
                json!({
                    "commission": id, "customer": cs, "artisan": ars,
                    "recipe": recipe.to_canonical_string(true),
                    "amount_mist": "2000000000", "accepted": false, "requested_at_ms": TS,
                })
            ),
            sadd(k_commissions_by_artisan(&ars), id.clone()),
            sadd(k_commissions_by_customer(&cs), id),
        ]
    );
}

#[test]
fn craft_accepted_marks_accepted_and_records_artisan_proof() {
    let request = oid(0xc0);
    let artisan = saddr(0xa5);
    let character = oid(0xce);
    let body = enc(&CraftAccepted {
        request,
        artisan,
        artisan_level: 42,
        artisan_character: character,
    });
    let w = map("commission", "CraftAccepted", PKG, SENDER, TS, &body).unwrap();
    let key = k_commission(&request.to_canonical_string(true));
    assert_eq!(
        w,
        vec![
            set(key.clone(), "$.accepted", json!(true)),
            set(key.clone(), "$.artisan_level", json!(42)),
            set(
                key,
                "$.artisan_character",
                json!(character.to_canonical_string(true))
            ),
        ]
    );
}

#[test]
fn craft_executed_deletes_doc_and_unindexes_both_parties() {
    // Executed carries BOTH customer and artisan, so the un-index is exact.
    let request = oid(0xc0);
    let (customer, artisan) = (saddr(0xcc), saddr(0xa5));
    let body = enc(&CraftExecuted {
        request,
        customer,
        artisan,
        recipe: oid(0x4e),
        amount: 2_000_000_000,
        fee: 200_000_000,
        success: true,
        artisan_xp: 150,
    });
    let w = map("commission", "CraftExecuted", PKG, SENDER, TS, &body).unwrap();
    let id = request.to_canonical_string(true);
    assert_eq!(
        w,
        vec![
            del(k_commission(&id), "$"),
            srem(k_commissions_by_artisan(&artisan.to_string()), id.clone()),
            srem(k_commissions_by_customer(&customer.to_string()), id),
        ]
    );
}

/// DRIFT GUARD (the 2026-07-12 10%-cut `fee` insertion — money-hat blocker). Mirrors the
/// `kolizeum_settled_decodes_current_onchain_field_order` guard above: an INDEPENDENT mirror of
/// the CURRENT `aresrpg::commission::CraftExecuted` source order (commission.move: request,
/// customer, artisan, recipe, amount, fee, success, artisan_xp — `fee` inserted between `amount`
/// and `success`). Before the fix this panics: the missing `fee: u64` desyncs the byte stream
/// (`success`'s bool byte lands inside `fee`, `artisan_xp` reads garbage, bytes remain
/// unconsumed) so `bcs::from_bytes` errors and `map()` returns `None` — completed commissions
/// never clear from the /v1 pending lists. `map()`'s CraftExecuted arm never projects
/// amount/fee/success/artisan_xp into Redis (only request/customer/artisan un-index the doc), so
/// this ALSO decodes the struct directly to prove `fee` itself lands on its own value, not just
/// that some 8-byte gap exists somewhere.
#[test]
fn craft_executed_decodes_current_onchain_field_order() {
    #[derive(serde::Serialize)]
    struct ChainCraftExecuted {
        request: ObjectID,
        customer: SuiAddress,
        artisan: SuiAddress,
        recipe: ObjectID,
        amount: u64,
        fee: u64,
        success: bool,
        artisan_xp: u64,
    }
    let request = oid(0xc0);
    let (customer, artisan) = (saddr(0xcc), saddr(0xa5));
    let chain = ChainCraftExecuted {
        request,
        customer,
        artisan,
        recipe: oid(0x4e),
        amount: 2_000_000_000,
        fee: 200_000_000,
        success: true,
        artisan_xp: 150,
    };
    let body = enc(&chain);

    let w = map("commission", "CraftExecuted", PKG, SENDER, TS, &body)
        .expect("current-layout CraftExecuted must decode");
    let id = request.to_canonical_string(true);
    assert_eq!(
        w,
        vec![
            del(k_commission(&id), "$"),
            srem(k_commissions_by_artisan(&artisan.to_string()), id.clone()),
            srem(k_commissions_by_customer(&customer.to_string()), id),
        ]
    );

    // amount/fee/success/artisan_xp carry no Redis projection today — pin them directly.
    let e: CraftExecuted =
        bcs::from_bytes(&body).expect("struct decode must match the chain layout");
    assert_eq!(e.amount, 2_000_000_000);
    assert_eq!(e.fee, 200_000_000);
    assert!(e.success);
    assert_eq!(e.artisan_xp, 150);
}

#[test]
fn craft_cancelled_deletes_doc_and_unindexes_both_parties() {
    // v2 CraftCancelled now carries BOTH customer AND artisan (commission.move names
    // both even though the refund is customer-owned), so the un-index is EXACT under
    // both parties — the v1 cancel's artisan-index monotonic wart is gone.
    let request = oid(0xc0);
    let (customer, artisan) = (saddr(0xcc), saddr(0xa5));
    let body = enc(&CraftCancelled {
        request,
        customer,
        artisan,
        amount: 2_000_000_000,
    });
    let w = map("commission", "CraftCancelled", PKG, SENDER, TS, &body).unwrap();
    let id = request.to_canonical_string(true);
    assert_eq!(
        w,
        vec![
            del(k_commission(&id), "$"),
            srem(k_commissions_by_artisan(&artisan.to_string()), id.clone()),
            srem(k_commissions_by_customer(&customer.to_string()), id),
        ]
    );
}

#[test]
fn kolizeum_drawn_sets_drawn_status_and_refund() {
    let kz = oid(0x1a);
    let body = enc(&KolizeumDrawn {
        kolizeum: kz,
        refunded_total: 30_000,
    });
    let w = map("kolizeum_events", "KolizeumDrawn", PKG, SENDER, TS, &body).unwrap();
    let key = k_kolizeum(&kz.to_canonical_string(true));
    assert_eq!(
        w,
        vec![
            set(key.clone(), "$.status", json!("drawn")),
            set(key, "$.refunded_mist", json!("30000")),
        ]
    );
}

#[test]
fn kolizeum_outcome_opened_is_deferred() {
    // Added with the aresrpg_kolizeum package split. Recognised-but-deferred: the
    // consumed FightOutcome object DELETE rides the ares_snapshot pipeline, and the
    // event carries no outcome_id/owner to key /v1/pending-outcomes (HANDLERS.md).
    assert!(map(
        "kolizeum_events",
        "KolizeumOutcomeOpened",
        PKG,
        SENDER,
        TS,
        &[]
    )
    .is_none());
}

#[test]
fn creation_sponsor_and_free_surface_on_the_creation_doc() {
    let sponsor = saddr(0x9a);
    let sp = map(
        "creation",
        "SponsorSet",
        PKG,
        SENDER,
        TS,
        &enc(&SponsorSet {
            sponsor: Some(sponsor),
        }),
    )
    .unwrap();
    assert_eq!(
        sp,
        vec![
            set_nx(
                K_CREATION.into(),
                "$",
                json!({ "classes": {}, "starters": {} })
            ),
            set(K_CREATION.into(), "$.sponsor", json!(sponsor.to_string())),
        ]
    );
    // None → null (self-pay).
    let cleared = map(
        "creation",
        "SponsorSet",
        PKG,
        SENDER,
        TS,
        &enc(&SponsorSet { sponsor: None }),
    )
    .unwrap();
    assert_eq!(cleared[1], set(K_CREATION.into(), "$.sponsor", json!(null)));

    let free = map(
        "creation",
        "FreeEnabledSet",
        PKG,
        SENDER,
        TS,
        &enc(&FreeEnabledSet { enabled: true }),
    )
    .unwrap();
    assert_eq!(free[1], set(K_CREATION.into(), "$.free", json!(true)));
}

// ── fights: the shared Fight object (aresrpg_fight::fight_events) ─────────────

#[test]
fn fight_created_seeds_doc_and_world_index() {
    let (fight, world) = (oid(0xf1), oid(0xe0));
    let body = enc(&FightCreated {
        fight,
        world,
        spawn_id: 77,
        anchor_x: 100,
        anchor_z: 200,
        public_fight: true,
        aged_bp: 500,
        mob_count: 3,
    });
    let w = map("fight_events", "FightCreated", PKG, SENDER, TS, &body).unwrap();
    let (fs, ws) = (
        fight.to_canonical_string(true),
        world.to_canonical_string(true),
    );
    assert_eq!(
        w,
        vec![
            set(
                k_fight(&fs),
                "$",
                json!({
                    "fight": fs, "world": ws, "spawn_id": "77", "anchor_x": 100, "anchor_z": 200,
                    "public_fight": true, "aged_bp": 500, "mob_count": 3,
                    "status": "placement", "participants": {}, "current_turn": null,
                })
            ),
            sadd(k_fights(&ws), fs),
        ]
    );
}

#[test]
fn fight_joined_maps_seat_and_reverse_pointer() {
    let (fight, ch) = (oid(0xf1), oid(0xc2));
    let body = enc(&FightJoined {
        fight,
        character: ch,
        seat: 1,
    });
    let w = map("fight_events", "FightJoined", PKG, SENDER, TS, &body).unwrap();
    let (fs, cs) = (
        fight.to_canonical_string(true),
        ch.to_canonical_string(true),
    );
    let key = k_fight(&fs);
    assert_eq!(
        w,
        vec![
            set_nx(key.clone(), "$", json!({ "fight": fs, "participants": {} })),
            set(key, &format!("$.participants[\"{cs}\"]"), json!(1)),
            set(k_char_fight(&cs), "$", json!(fs)),
        ]
    );
}

// ── #1579: the TurnStarted mirror, pinned to REAL CAPTURED WIRE ──────────────
//
// RUNTIME PROVENANCE. Both byte arrays are the EXACT base64 `bcs` bodies of the two events
// emitted by testnet transaction `4KTjXhW15G2GYVXSxcPX2GtqhzxpvLAULtiZo3HgfBz4`
// (`turns::force_start`, checkpoint 365484088, engine package
// `0x9cfadccfe8063db9ad280777e9e7780dcc9ebe21bd64594c0481170fb0c884b3`, fight
// `0xaf742984…8167`), read off the fullnode's own event response. They are a CONTROLLED PAIR
// from ONE transaction: `MobMoved` (48 bytes) indexed fine while `TurnStarted` (65) was
// dropped, which is how the mirror — not the ingest path — was convicted.
//
// This is the code-law's "assert captured wire bytes" (docs/CODE_LAW.md): the previous test
// here BCS-encoded with the very struct it decoded with, so a mirror wrong in both directions
// stayed green — and did, while every fight on testnet wedged in placement. These bytes come
// from the chain, so no change to `model.rs` can ever make them agree with themselves.
const TURN_STARTED_WIRE: &[u8] = &[
    175, 116, 41, 132, 62, 213, 68, 206, 221, 158, 208, 208, 160, 138, 192, 202, 181, 210, 96, 148,
    86, 59, 250, 25, 120, 6, 195, 197, 76, 179, 129, 103, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 224, 88,
    171, 159, 1, 0, 0, 189, 45, 249, 176, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
];
// The positive control: same transaction, same checkpoint, consecutive event sequence.
const MOB_MOVED_WIRE: &[u8] = &[
    175, 116, 41, 132, 62, 213, 68, 206, 221, 158, 208, 208, 160, 138, 192, 202, 181, 210, 96, 148,
    86, 59, 250, 25, 120, 6, 195, 197, 76, 179, 129, 103, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0,
    0, 0,
];
const WEDGED_FIGHT: &str = "0xaf7429843ed544cedd9ed0d0a08ac0cab5d26094563bfa197806c3c54cb38167";

#[test]
fn turn_started_real_wire_flips_active_and_sets_cursor() {
    // The fullnode's own parsedJson for this event: is_mob false, idx "0",
    // deadline_ms "1785286156291", turn_entropy "2969120189", turn_ordinal "1".
    let w = map(
        "fight_events",
        "TurnStarted",
        PKG,
        SENDER,
        TS,
        TURN_STARTED_WIRE,
    )
    .expect(
        "the captured on-chain TurnStarted must decode — it is the only writer of status:active",
    );
    let key = k_fight(WEDGED_FIGHT);
    assert_eq!(
        w,
        vec![
            set(key.clone(), "$.status", json!("active")),
            set(
                key,
                "$.current_turn",
                json!({ "is_mob": false, "idx": 0, "deadline_ms": 1_785_286_156_291u64 })
            ),
        ]
    );
}

#[test]
fn the_mirror_consumes_the_whole_turn_started_wire() {
    // BCS refuses trailing input, so a successful decode already proves the widths agree; this
    // states the arithmetic the bug hid behind: 32 (ID) + 1 (bool) + 4×8 (u64) = 65.
    let e: TurnStarted = bcs::from_bytes(TURN_STARTED_WIRE).expect("mirror must match the wire");
    assert_eq!(TURN_STARTED_WIRE.len(), 65);
    assert_eq!(e.fight.to_canonical_string(true), WEDGED_FIGHT);
    assert_eq!(
        (e.is_mob, e.idx, e.deadline_ms),
        (false, 0, 1_785_286_156_291)
    );
    assert_eq!((e.turn_entropy, e.turn_ordinal), (2_969_120_189, 1));
}

#[test]
fn the_same_transactions_mob_moved_is_the_positive_control() {
    // MobMoved decoded and indexed throughout the outage — same tx, same checkpoint, same
    // fight key. It is what proves the ingest path was healthy and only the mirror was wrong.
    let w = map("fight_events", "MobMoved", PKG, SENDER, TS, MOB_MOVED_WIRE).unwrap();
    let key = k_fight(WEDGED_FIGHT);
    assert_eq!(MOB_MOVED_WIRE.len(), 48);
    assert_eq!(
        w,
        vec![
            set_nx(
                key.clone(),
                "$",
                json!({ "fight": WEDGED_FIGHT, "mob_positions": {} })
            ),
            set_nx(key.clone(), "$.mob_positions", json!({})),
            set(key, "$.mob_positions[\"0\"]", json!(4)),
        ]
    );
}

#[test]
fn mob_moved_stores_latest_cell_on_the_fight_doc() {
    let fight = oid(0xf1);
    let body = enc(&MobMoved {
        fight,
        idx: 3,
        to_cell: 15,
    });
    let w = map("fight_events", "MobMoved", PKG, SENDER, TS, &body).unwrap();
    let fs = fight.to_canonical_string(true);
    let key = k_fight(&fs);
    assert_eq!(
        w,
        vec![
            set_nx(
                key.clone(),
                "$",
                json!({ "fight": fs, "mob_positions": {} })
            ),
            set_nx(key.clone(), "$.mob_positions", json!({})),
            set(key, "$.mob_positions[\"3\"]", json!(15)),
        ]
    );
    // Absolute set (the event carries the mob's new cell) — replay-safe, no relative counter.
    assert!(w.iter().all(|x| !matches!(x, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn victory_defeat_flip_status_settle_and_sweep_delete() {
    let fight = oid(0xf1);
    let fs = fight.to_canonical_string(true);
    let victory = map(
        "fight_events",
        "Victory",
        PKG,
        SENDER,
        TS,
        &enc(&FightVictory {
            fight,
            aged_bp: 500,
        }),
    )
    .unwrap();
    assert_eq!(
        victory,
        vec![set(k_fight(&fs), "$.status", json!("victory"))]
    );
    let defeat = map(
        "fight_events",
        "Defeat",
        PKG,
        SENDER,
        TS,
        &enc(&OneId { id: fight }),
    )
    .unwrap();
    assert_eq!(defeat, vec![set(k_fight(&fs), "$.status", json!("defeat"))]);
    let settled = map(
        "fight_events",
        "Settled",
        PKG,
        SENDER,
        TS,
        &enc(&FightSettled {
            fight,
            outcome: 2,
            results: 2,
        }),
    )
    .unwrap();
    assert_eq!(settled, vec![del(k_fight(&fs), "$")]);
    let swept = map(
        "fight_events",
        "Swept",
        PKG,
        SENDER,
        TS,
        &enc(&OneId { id: fight }),
    )
    .unwrap();
    assert_eq!(swept, vec![del(k_fight(&fs), "$")]);
}

// ── stat allocation + gathering (§3 / §17.22) ────────────────────────────────

#[test]
fn stat_raised_upserts_absolute_per_stat_allocation() {
    let ch = oid(0xc1);
    // raise vitality (index 0) by 10 → new total 10.
    let body = enc(&StatRaised {
        character: ch,
        stat: 0,
        points: 10,
        stat_total: 10,
    });
    let w = map("stat_allocation", "StatRaised", PKG, SENDER, TS, &body).unwrap();
    let cs = ch.to_canonical_string(true);
    let key = k_character(&cs);
    assert_eq!(
        w,
        vec![
            char_init(&key, &cs),
            set_nx(key.clone(), "$.stats", json!({})),
            set(key, "$.stats[\"0\"]", json!(10)),
        ]
    );
    // Absolute set (the event carries the stat's NEW total) — replay-safe, no relative counter.
    assert!(w.iter().all(|x| !matches!(x, RedisWrite::NumIncrBy { .. })));
}

/// REGRESSION (issue #1315 finding 8): the #1289 module merge folded `stat_allocation` into
/// `character_link`, so every FRESH stat raise is emitted as `character_link::StatRaised`. Matching
/// the retired module alone silently stopped indexing stat allocations — the character doc kept
/// serving the pre-republish `$.stats` while the chain moved on. Same body, same projection.
#[test]
fn stat_raised_projects_from_the_merged_character_link_module() {
    let ch = oid(0xc2);
    let body = enc(&StatRaised {
        character: ch,
        stat: 3,
        points: 5,
        stat_total: 41,
    });
    let merged = map("character_link", "StatRaised", PKG, SENDER, TS, &body).unwrap();
    let cs = ch.to_canonical_string(true);
    let key = k_character(&cs);
    assert_eq!(
        merged,
        vec![
            char_init(&key, &cs),
            set_nx(key.clone(), "$.stats", json!({})),
            set(key, "$.stats[\"3\"]", json!(41)),
        ]
    );
    // Byte-identical projection from BOTH emitters — the history before the republish keeps
    // re-indexing correctly, which is why the retired module is matched rather than replaced.
    assert_eq!(
        merged,
        map("stat_allocation", "StatRaised", PKG, SENDER, TS, &body).unwrap()
    );
}

#[test]
fn protector_triggered_writes_the_per_gatherer_signal() {
    let (world, tmpl) = (oid(0xe0), oid(0x7b));
    let gatherer = saddr(0xab);
    let body = enc(&ProtectorTriggered {
        world,
        gatherer,
        template: tmpl,
        x: 12,
        z: 34,
        spawn_id: 99,
    });
    let w = map("gathering", "ProtectorTriggered", PKG, SENDER, TS, &body).unwrap();
    let g = gatherer.to_string();
    assert_eq!(
        w,
        vec![set(
            k_protector(&g),
            "$",
            json!({
                "gatherer": g, "world": world.to_canonical_string(true),
                "template": tmpl.to_canonical_string(true), "x": 12, "z": 34,
                "spawn_id": "99", "at_ms": TS,
            })
        )]
    );
}

#[test]
fn result_minted_seeds_doc_maps_outcome_and_indexes_by_owner() {
    let (result, fight, ch) = (oid(0xab), oid(0xf1), oid(0xc1));
    let owner = saddr(0x5e);
    let body = enc(&ResultMinted {
        result,
        fight,
        character: ch,
        owner,
        outcome: 2,
        xp_share: 1200,
        final_hp: 45,
    });
    let w = map("fight_events", "ResultMinted", PKG, SENDER, TS, &body).unwrap();
    let (rs, os) = (result.to_canonical_string(true), owner.to_string());
    assert_eq!(
        w,
        vec![
            set(
                k_result(&rs),
                "$",
                json!({
                    "result": rs, "fight": fight.to_canonical_string(true),
                    "character": ch.to_canonical_string(true), "owner": os,
                    "outcome": "victory", "xp_share": 1200, "final_hp": 45,
                    "opened": false, "loot_units": 0,
                })
            ),
            sadd(k_results(&os), rs),
        ]
    );
}

#[test]
fn result_opened_creates_ticket_doc_and_burned_deletes() {
    // ResultOpened carries the NEW core FightResult id (NOT the engine FightOutcome
    // id ResultMinted carried) — the arm must CREATE the doc (sender = owner) and
    // index it, never patch a root that does not exist.
    let result = oid(0xab);
    let rs = result.to_canonical_string(true);
    let opened = map(
        "results",
        "ResultOpened",
        PKG,
        SENDER,
        TS,
        &enc(&ResultOpened {
            result,
            character: oid(0xc1),
            xp_share: 1200,
            loot_units: 3,
        }),
    )
    .unwrap();
    assert_eq!(
        opened,
        vec![
            set(
                k_result(&rs),
                "$",
                json!({
                    "result": rs.clone(), "fight": null,
                    "character": oid(0xc1).to_canonical_string(true), "owner": SENDER,
                    "outcome": null, "xp_share": 1200, "final_hp": null,
                    "opened": true, "loot_units": 3,
                })
            ),
            sadd(k_results(SENDER), rs.clone()),
        ]
    );
    let burned = map(
        "results",
        "ResultBurned",
        PKG,
        SENDER,
        TS,
        &enc(&OneId { id: result }),
    )
    .unwrap();
    assert_eq!(burned, vec![del(k_result(&rs), "$")]);
}

// ── scope fences: deferred fight + deferred/foreign events are not indexed ────

#[test]
fn deferred_fight_events_return_none() {
    // Granular board/turn events + LootMinted are deferred (live board = presence
    // + client sim replay) — see HANDLERS.md.
    for n in [
        "Placed",
        "Ready",
        "Moved",
        "Cast",
        "Hit",
        "TurnEnded",
        "LootMinted",
    ] {
        assert!(
            map("fight_events", n, PKG, SENDER, TS, &[]).is_none(),
            "fight_events::{n} should be deferred"
        );
    }
}

#[test]
fn deferred_and_foreign_events_return_none() {
    // Recognised-but-deferred (object/DF state) and unrelated modules alike.
    for (m, n) in [
        ("world", "WorldUpdated"),
        ("item", "ItemMerged"),
        ("catalog", "CategoryAdded"),
        ("some_other_pkg", "Whatever"),
    ] {
        assert!(
            map(m, n, PKG, SENDER, TS, &[]).is_none(),
            "{m}::{n} should not be indexed"
        );
    }
}

#[test]
fn craft_pet_analytics_runes_gather_verbs_are_deferred() {
    // PetFed is analytics-only; FoodPowerSet and PetPowerAdvanced are projected above.
    // The remaining activity events have no read view; their durable result is object/DF
    // state (minted items, job-xp, item level, rune inventory). See HANDLERS.md.
    for (m, n) in [
        ("crafting", "Crafted"),
        ("crafting", "RecipeCreated"),
        ("pet", "PetFed"),
        ("runes", "GearCrushed"),
        ("runes", "GearScribed"),
        ("runes", "CrushOutputSet"),
        ("gathering", "ResourceGathered"),
        ("gathering", "ProtectorTriggered"),
        ("commission", "CraftXpRedeemed"),
    ] {
        assert!(
            map(m, n, PKG, SENDER, TS, &[]).is_none(),
            "{m}::{n} should be deferred (activity → object state)"
        );
    }
}
