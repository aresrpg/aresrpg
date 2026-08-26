// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The graph projection — decoded chain objects → Cypher, PURE.
//!
//! One checkpoint's views in, an ORDERED list of Cypher statements out; no
//! store reads, ever. The laws this file carries (README):
//!
//! * **Objects are the primary writers** — every statement here derives from an
//!   output object, custody fact, or pre-state delete view. `:Market` prices and Fight lifecycle
//!   clocks are event-envelope facts computed by `publish.rs`.
//! * **Per-property writes** — each decoded source SETs exactly its own
//!   properties over a `MERGE` skeleton; nothing ever replaces a whole node.
//! * **One ownership edge per object** — custody writes DELETE the standing
//!   `HOLDS|FIGHTER|EQUIPS` edge before creating the new one.
//! * **DF writes are parent-guarded, never parent-blocked** — a DF born WITH its
//!   typed parent merges order-free; a DF arriving alone (equip/hp/scribe mutate
//!   only the child — a `&mut` borrow emits no parent object, measured 2026-08-21)
//!   writes MATCH-guarded on the parent's label: a foreign or unknown parent
//!   matches nothing (this still keeps ceremony-template DFs out of the item space).
//! * **Strings ≥ 2⁵³** — seeds, bitmasks, MIST are string properties.
//!
//! Statement order per checkpoint: nodes (tx order) → dynamic fields (tx order) → custody
//! edges → fight seat-team fixups → deletes → market stamps. Fields run after nodes because
//! relationship fields may name a node born in the same checkpoint. An object created and
//! deleted in one checkpoint ends deleted; replay converges to the same final state.

use std::collections::BTreeSet;

use serde_json::{json, Value};

use crate::decode::{self, Field, Id, MarkerKey};
use crate::ownership::{Custody, ObjView, OwnerKind, TypeKey, SUI_FRAMEWORK};

/// A realised per-unit sale price for one item type — computed by `publish.rs`
/// (the ONE event-derived graph write; README law 9).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarketStamp {
    pub item_type: String,
    pub price_per_unit_mist: u64,
    pub ts_ms: u64,
}

/// A lifecycle timestamp derived from the checkpoint envelope of FightStarted/FightEnded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FightLifecycleStamp {
    pub fight: String,
    pub started: bool,
    pub ts_ms: u64,
}

/// Everything one checkpoint gives the projection.
pub struct CheckpointView<'a> {
    pub ckpt: u64,
    pub ts_ms: u64,
    /// Output objects, transaction order.
    pub outputs: &'a [ObjView<'a>],
    /// PRE-STATE views of this checkpoint's deleted ids (law 2).
    pub deleted: &'a [ObjView<'a>],
    pub custody: &'a [Custody],
    pub market: &'a [MarketStamp],
    pub fight_lifecycle: &'a [FightLifecycleStamp],
}

/// Project one checkpoint into Cypher statements.
///
/// A decode failure of a type-matched game object is LAYOUT DRIFT, never noise
/// (type identity pins these types to our package) — it errors the checkpoint,
/// stalling ingestion loudly instead of letting the watermark advance past
/// unprojected state (the no-silent-failures law).
pub fn project(view: &CheckpointView<'_>, game: &str) -> anyhow::Result<Vec<String>> {
    let mut cypher = vec![];
    for output in view
        .outputs
        .iter()
        .filter(|output| field_key(output.type_key).is_none())
    {
        emit_object(&mut cypher, output, view, game)?;
    }
    for output in view
        .outputs
        .iter()
        .filter(|output| field_key(output.type_key).is_some())
    {
        emit_object(&mut cypher, output, view, game)?;
    }
    for fact in view.custody {
        emit_custody(&mut cypher, fact);
    }
    for output in view.outputs {
        emit_fight_seat_teams(&mut cypher, output, game)?;
    }
    for gone in view.deleted {
        emit_delete(&mut cypher, gone, game)?;
    }
    for stamp in view.market {
        cypher.push(format!(
            "MERGE (m:Market {{item_type: {t}}}) SET m.last_sale_mist = {p}, m.last_sale_ms = {ts}, m.ckpt = {ckpt}",
            t = q(&stamp.item_type),
            p = q(&stamp.price_per_unit_mist.to_string()),
            ts = stamp.ts_ms,
            ckpt = view.ckpt,
        ));
    }
    for stamp in view.fight_lifecycle {
        cypher.push(format!(
            "MATCH (f:Fight {{id: {fight}}}) SET f.{field} = {ts}",
            fight = q(&stamp.fight),
            field = if stamp.started {
                "started_ms"
            } else {
                "ended_ms"
            },
            ts = stamp.ts_ms,
        ));
    }
    Ok(cypher)
}

fn drift(what: &str, id: Id, error: anyhow::Error) -> anyhow::Error {
    anyhow::anyhow!("layout drift: {what} {} failed decode: {error}", id.hex())
}

// ╔════════════════ [ Cypher building blocks ] ═══════════════════════════════ ]

/// Quote + escape a string literal. Backslash first, then the quote — the only
/// two bytes that can break out of a single-quoted Cypher string.
fn q(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// A JSON document stored as a STRING property (maps are not FalkorDB values).
fn q_json(v: &Value) -> String {
    q(&v.to_string())
}

fn q_id(id: &Id) -> String {
    q(&id.hex())
}

/// An array of u64 BITMASK/seed words as string elements (2⁵³ law).
fn strs_u64(words: &[u64]) -> Value {
    Value::Array(words.iter().map(|w| json!(w.to_string())).collect())
}

/// A native Cypher list of quoted addresses (arrays of primitives are
/// first-class FalkorDB property values — no JSON-string indirection).
fn addr_array(addrs: &[crate::decode::Addr]) -> String {
    format!(
        "[{}]",
        addrs
            .iter()
            .map(|a| q(&a.hex()))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

/// A stats block as a 15-int array, canonical field order (README schema).
fn stats_array(s: &decode::ItemStatistics) -> String {
    format!(
        "[{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]",
        s.vitality,
        s.wisdom,
        s.strength,
        s.intelligence,
        s.chance,
        s.agility,
        s.range,
        s.movement,
        s.action,
        s.critical,
        s.raw_damage,
        s.earth_resistance,
        s.fire_resistance,
        s.water_resistance,
        s.air_resistance,
    )
}

fn damages_json(lines: &[decode::ItemDamages]) -> Value {
    Value::Array(
        lines
            .iter()
            .map(|d| {
                json!({
                    "from": d.from,
                    "to": d.to,
                    "damage_type": d.damage_type,
                    "element": d.element,
                })
            })
            .collect(),
    )
}

/// `MERGE (v:Label {id: '0x…'}) SET v.ckpt = N, <assign>, …` — the one write
/// shape every node emitter uses (per-property law: MERGE never resets).
fn merge_set(cypher: &mut Vec<String>, label: &str, id: &Id, ckpt: u64, assigns: &[String]) {
    let mut set = format!("v.ckpt = {ckpt}");
    for assign in assigns {
        set.push_str(", ");
        set.push_str(assign);
    }
    cypher.push(format!(
        "MERGE (v:{label} {{id: {id}}}) SET {set}",
        id = q_id(id),
    ));
}

// ╔════════════════ [ Object dispatch ] ══════════════════════════════════════ ]

fn is_game(t: &TypeKey, game: &str, module: &str, name: &str) -> bool {
    t.package == game && t.module == module && t.name == name
}

fn is_native(t: &TypeKey, module: &str, name: &str) -> bool {
    t.package == SUI_FRAMEWORK && t.module == module && t.name == name
}

/// The `Field<K, V>` KEY type parameter, exactly.
fn field_key(t: &TypeKey) -> Option<&str> {
    (is_native(t, "dynamic_field", "Field")).then(|| t.type_params[0].as_str())
}

/// The parent of a DF, from its owner edge. The bool marks TYPED CO-PRESENCE: the parent
/// object rode the same checkpoint (a fresh parent+DF birth — write with MERGE, order-free).
/// A DF arriving ALONE (equip/hp/scribe mutate only the child — measured 2026-08-21: the
/// equip projection silently dropped for every real player) writes MATCH-guarded instead:
/// the GRAPH's own label is the type guard, a foreign parent matches nothing.
fn df_parent<'a>(
    view: &ObjView<'_>,
    outputs: &'a [ObjView<'a>],
    game: &str,
    module: &str,
    name: &str,
) -> Option<(Id, bool)> {
    let OwnerKind::Object(parent) = view.owner else {
        return None;
    };
    let co_present = outputs
        .iter()
        .any(|o| o.id == parent && is_game(o.type_key, game, module, name));
    Some((parent, co_present))
}

/// A DF-driven write on the parent node: MERGE when the typed parent is co-present (birth
/// order inside one checkpoint is arbitrary), MATCH otherwise (the label guards the type).
fn child_set(
    cypher: &mut Vec<String>,
    co_present: bool,
    label: &str,
    id: &Id,
    ckpt: u64,
    assigns: &[String],
) {
    if co_present {
        merge_set(cypher, label, id, ckpt, assigns);
        return;
    }
    let mut set = format!("v.ckpt = {ckpt}");
    for assign in assigns {
        set.push_str(", ");
        set.push_str(assign);
    }
    cypher.push(format!(
        "MATCH (v:{label} {{id: {id}}}) SET {set}",
        id = q_id(id),
    ));
}

fn emit_object(
    cypher: &mut Vec<String>,
    o: &ObjView<'_>,
    view: &CheckpointView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let t = o.type_key;
    let ckpt = view.ckpt;

    // ── game objects ──
    if is_game(t, game, "character", "Character") {
        let c = decode::from_bytes::<decode::Character>(o.bytes)
            .map_err(|e| drift("character::Character", o.id, e))?;
        merge_set(
            cypher,
            "Character",
            &c.id,
            ckpt,
            &[
                format!("v.name = {}", q(&c.name)),
                format!("v.classe = {}", q(&c.classe)),
                format!("v.sex = {}", q(&c.sex)),
                format!("v.experience = {}", q(&c.experience.to_string())),
                format!("v.level = {}", c.level),
                format!("v.color_1 = {}", c.color_1),
                format!("v.color_2 = {}", c.color_2),
                format!("v.color_3 = {}", c.color_3),
                format!("v.vitality = {}", c.vitality),
                format!("v.wisdom = {}", c.wisdom),
                format!("v.strength = {}", c.strength),
                format!("v.intelligence = {}", c.intelligence),
                format!("v.chance = {}", c.chance),
                format!("v.agility = {}", c.agility),
                format!("v.available_points = {}", c.available_points),
                format!("v.available_spell_points = {}", c.available_spell_points),
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "item", "Item") {
        let i = decode::from_bytes::<decode::Item>(o.bytes)
            .map_err(|e| drift("item::Item", o.id, e))?;
        merge_set(
            cypher,
            "Item",
            &i.id,
            ckpt,
            &[
                format!("v.name = {}", q(&i.name)),
                format!("v.item_type = {}", q(&i.item_type)),
                format!("v.category = {}", q(&i.category)),
                format!("v.level = {}", i.level),
                format!("v.amount = {}", i.amount),
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "fight", "Fight") {
        return emit_fight(cypher, o, ckpt);
    }
    if is_game(t, game, "party", "Party") {
        return emit_party(cypher, o, ckpt);
    }
    if is_game(t, game, "trade", "Trade") {
        return emit_trade(cypher, o, ckpt);
    }
    if is_game(t, game, "friends", "FriendList") {
        return emit_friend_list(cypher, o);
    }
    if is_game(t, game, "kolizeum", "Kolizeum") {
        let k = decode::from_bytes::<decode::Kolizeum>(o.bytes)
            .map_err(|e| drift("kolizeum::Kolizeum", o.id, e))?;
        let allowed = k.allowed.as_ref().map(|set| addr_array(&set.contents));
        merge_set(
            cypher,
            "Kolizeum",
            &k.id,
            ckpt,
            &[
                format!("v.pot = {}", q(&k.pot.value.to_string())),
                format!("v.pledge = {}", q(&k.pledge.to_string())),
                format!("v.fight_id = {}", q_id(&k.fight)),
                format!("v.format = {}", k.format),
                format!("v.level_min = {}", k.level_min),
                format!("v.level_max = {}", k.level_max),
                match allowed {
                    Some(list) => format!("v.allowed = {list}"),
                    None => "v.allowed = NULL".to_string(),
                },
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "shop", "Sale") {
        let s = decode::from_bytes::<decode::Sale>(o.bytes)
            .map_err(|e| drift("shop::Sale", o.id, e))?;
        merge_set(
            cypher,
            "Sale",
            &s.id,
            ckpt,
            &[
                format!("v.item_type = {}", q(&s.item_type)),
                format!("v.template = {}", q_id(&s.template)),
                format!("v.price = {}", q(&s.price.to_string())),
                format!("v.supply = {}", q(&s.supply.to_string())),
                format!("v.infinite = {}", s.infinite),
                format!("v.enabled = {}", s.enabled),
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "shop", "Airdrop") {
        let a = decode::from_bytes::<decode::Airdrop>(o.bytes)
            .map_err(|e| drift("shop::Airdrop", o.id, e))?;
        let whitelist = addr_array(&a.whitelist.contents);
        merge_set(
            cypher,
            "Airdrop",
            &a.id,
            ckpt,
            &[
                format!("v.drop_id = {}", q(&a.drop_id)),
                format!("v.template = {}", q_id(&a.template)),
                format!("v.amount_each = {}", a.amount_each),
                format!("v.whitelist = {whitelist}"),
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "shop", "Giftcard") {
        let g = decode::from_bytes::<decode::Giftcard>(o.bytes)
            .map_err(|e| drift("shop::Giftcard", o.id, e))?;
        merge_set(
            cypher,
            "Giftcard",
            &g.id,
            ckpt,
            &[
                format!("v.template = {}", q_id(&g.template)),
                format!("v.amount = {}", g.amount),
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "loot_box", "BoxClaim") {
        let c = decode::from_bytes::<decode::BoxClaim>(o.bytes)
            .map_err(|e| drift("loot_box::BoxClaim", o.id, e))?;
        merge_set(
            cypher,
            "BoxClaim",
            &c.id,
            ckpt,
            &[
                format!("v.box_template = {}", q_id(&c.box_template)),
                format!("v.rolled_template = {}", q_id(&c.rolled_template)),
                format!("v.amount = {}", c.amount),
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "forgemagie", "CrushClaim") {
        let c = decode::from_bytes::<decode::CrushClaim>(o.bytes)
            .map_err(|e| drift("forgemagie::CrushClaim", o.id, e))?;
        let owed = if c.revealed {
            format!(
                "[{}]",
                c.owed
                    .iter()
                    .map(u64::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        } else {
            "NULL".to_string()
        };
        merge_set(
            cypher,
            "CrushClaim",
            &c.id,
            ckpt,
            &[
                format!("v.seed = {}", q(&c.seed.to_string())),
                format!("v.revealed = {}", c.revealed),
                format!("v.owed = {owed}"),
            ],
        );
        return Ok(());
    }
    if is_game(t, game, "version", "Version") {
        let v = decode::from_bytes::<decode::Version>(o.bytes)
            .map_err(|e| drift("version::Version", o.id, e))?;
        cypher.push(format!(
            "MERGE (m:Meta {{id: 'meta'}}) SET m.version = {}, m.ckpt = {ckpt}",
            v.version
        ));
        return Ok(());
    }

    // ── native kiosk ──
    if is_native(t, "kiosk", "Kiosk") {
        let k = decode::from_bytes::<decode::Kiosk>(o.bytes)
            .map_err(|e| drift("kiosk::Kiosk", o.id, e))?;
        merge_set(
            cypher,
            "Kiosk",
            &k.id,
            ckpt,
            &[format!("v.profits = {}", q(&k.profits.value.to_string()))],
        );
        // OWNS is the kiosk's one incoming edge — replaced, never accumulated.
        cypher.push(format!(
            "MATCH (k:Kiosk {{id: {id}}})<-[r:OWNS]-() DELETE r",
            id = q_id(&k.id),
        ));
        cypher.push(format!(
            "MATCH (k:Kiosk {{id: {id}}}) MERGE (u:User {{address: {owner}}}) CREATE (u)-[:OWNS]->(k)",
            id = q_id(&k.id),
            owner = q(&k.owner.hex()),
        ));
        return Ok(());
    }

    // ── the personal kiosk wrapper (Mysten's official rule package — the one that mints
    //    every live cap). The projected cap id is what the wire hands the client for custody
    //    transactions: the client never discovers kiosks over RPC (owner 2026-08-21). ──
    if is_personal_kiosk_cap(t) {
        let p = decode::from_bytes::<decode::PersonalKioskCap>(o.bytes)
            .map_err(|e| drift("personal_kiosk::PersonalKioskCap", o.id, e))?;
        // a borrowed cap (None) is a mid-transaction state no checkpoint output persists
        if let Some(inner) = &p.cap {
            cypher.push(format!(
                "MERGE (k:Kiosk {{id: {kiosk}}}) SET k.personal_cap = {cap}, k.ckpt = {ckpt}",
                kiosk = q_id(&inner.for_),
                cap = q(&p.id.hex()),
            ));
        }
        return Ok(());
    }

    // ── dynamic fields, dispatched by KEY type ──
    if let Some(key) = field_key(t) {
        emit_field(cypher, o, key, view, game)?;
    }
    Ok(())
}

/// The two OFFICIAL personal-kiosk rule packages (@mysten/kiosk constants — protocol-stable).
const PERSONAL_KIOSK_PACKAGES: [&str; 2] = [
    // testnet
    "0x06f6bdd3f2e2e759d8a4b9c252f379f7a05e72dfe4c0b9311cdac27b8eb791b1",
    // mainnet
    "0x0cb4bcc0560340eb1a1b929cabe56b33fc6449820ec8c1980d69bb98b649b802",
];

fn is_personal_kiosk_cap(t: &TypeKey) -> bool {
    t.module == "personal_kiosk"
        && t.name == "PersonalKioskCap"
        && PERSONAL_KIOSK_PACKAGES.contains(&t.package.as_str())
}

// ╔════════════════ [ Dynamic fields ] ═══════════════════════════════════════ ]

fn game_key(game: &str, path: &str) -> String {
    format!("{game}::{path}")
}

fn emit_field(
    cypher: &mut Vec<String>,
    o: &ObjView<'_>,
    key: &str,
    view: &CheckpointView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let ckpt = view.ckpt;
    let outputs = view.outputs;

    // ── Character DFs ──
    if key == game_key(game, "progression::HpKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::Hp>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        child_set(
            cypher,
            co_present,
            "Character",
            &parent,
            ckpt,
            &[
                format!("v.hp = {}", q(&f.value.current.to_string())),
                format!("v.hp_ms = {}", f.value.last_ms),
            ],
        );
        return Ok(());
    }
    if key == game_key(game, "progression::JobXpKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<decode::JobXpKey, u64>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        // one flat prop per job — jobs are separate DFs, so a map prop would
        // need read-modify-write; the 11 slugs are immutable vocabulary.
        let slug: String = f
            .name
            .0
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        child_set(
            cypher,
            co_present,
            "Character",
            &parent,
            ckpt,
            &[format!(
                "v.job_{} = {}",
                slug.to_lowercase(),
                q(&f.value.to_string())
            )],
        );
        return Ok(());
    }
    if key == game_key(game, "progression::SpellBookKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::SpellBook>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        let book: Value = Value::Object(
            f.value
                .contents
                .iter()
                .map(|e| (e.key.clone(), json!(e.value)))
                .collect(),
        );
        child_set(
            cypher,
            co_present,
            "Character",
            &parent,
            ckpt,
            &[format!("v.spells = {}", q_json(&book))],
        );
        return Ok(());
    }
    if key == game_key(game, "equipment::FoldedKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::ItemStatistics>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        child_set(
            cypher,
            co_present,
            "Character",
            &parent,
            ckpt,
            &[format!("v.folded_stats = {}", stats_array(&f.value))],
        );
        return Ok(());
    }
    if key == game_key(game, "equipment::EquipmentKey") {
        let Some((parent, _)) = df_parent(o, outputs, game, "character", "Character") else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::EquipmentMap>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        // the map is whole-value latest-wins: replace ALL the character's
        // EQUIPS edges, then recreate; each equipped item loses its standing
        // ownership edge (it left the kiosk when it was sent to the character).
        let c = q_id(&parent);
        cypher.push(format!(
            "MATCH (:Character {{id: {c}}})-[r:EQUIPS]->() DELETE r"
        ));
        for entry in &f.value.contents {
            let i = q_id(&entry.value.item);
            cypher.push(format!(
                "MATCH (i:Item {{id: {i}}})<-[r:HOLDS|FIGHTER]-() DELETE r"
            ));
            cypher.push(format!(
                "MERGE (c:Character {{id: {c}}}) MERGE (i:Item {{id: {i}}}) \
                 CREATE (c)-[:EQUIPS {{slot: {slot}}}]->(i)",
                slot = q(&entry.key),
            ));
        }
        return Ok(());
    }
    if key == game_key(game, "world::CurrentWorldKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, String>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        child_set(
            cypher,
            co_present,
            "Character",
            &parent,
            ckpt,
            &[format!("v.world = {}", q(&f.value))],
        );
        return Ok(());
    }
    if key == game_key(game, "world::CheckpointKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<decode::CheckpointKey, decode::Checkpoint>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        // `checkpoint_world` names which world this position belongs to — the
        // consumer trusts x/z only when it equals `world` (both land in the
        // same tx, so they cohere; no read-modify-write needed here).
        child_set(
            cypher,
            co_present,
            "Character",
            &parent,
            ckpt,
            &[
                format!("v.checkpoint_world = {}", q(&f.name.0)),
                format!("v.x = {}", f.value.x),
                format!("v.z = {}", f.value.z),
                format!("v.at_ms = {}", f.value.at_ms),
                format!("v.pet = {}", f.value.pet),
            ],
        );
        return Ok(());
    }
    if key == game_key(game, "dungeon::DungeonRunKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::DungeonRun>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        let run = json!({
            "world": f.value.world.clone(),
            "room": f.value.room.to_string(),
            "x": f.value.x,
            "z": f.value.z,
            "seed": f.value.seed.to_string(),
        });
        child_set(
            cypher,
            co_present,
            "Character",
            &parent,
            ckpt,
            &[
                format!("v.dungeon_run = {}", q_json(&run)),
                format!("v.dungeon_world = {}", q(&f.value.world)),
                format!("v.dungeon_room = {}", f.value.room),
                format!("v.dungeon_x = {}", f.value.x),
                format!("v.dungeon_z = {}", f.value.z),
                format!("v.dungeon_seed = {}", q(&f.value.seed.to_string())),
            ],
        );
        return Ok(());
    }
    if key == game_key(game, "gathering::AmbushKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::PendingAmbush>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        // written on EVERY gather (gas-uniform) — only a FIRED verdict is
        // state; a quiet one clears it.
        let assign = if f.value.fires {
            let v = json!({
                "protector": f.value.protector,
                "x": f.value.x,
                "z": f.value.z,
                "scalar": f.value.scalar,
                "board_seed": f.value.board_seed.to_string(),
                "hp": f.value.hp.to_string(),
            });
            format!("v.ambush = {}", q_json(&v))
        } else {
            "v.ambush = NULL".to_string()
        };
        child_set(cypher, co_present, "Character", &parent, ckpt, &[assign]);
        return Ok(());
    }

    // ── Item DFs ──
    if key == game_key(game, "item::StatsKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "item", "Item") else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::ItemStatistics>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        child_set(
            cypher,
            co_present,
            "Item",
            &parent,
            ckpt,
            &[format!("v.stats = {}", stats_array(&f.value))],
        );
        return Ok(());
    }
    if key == game_key(game, "item::DamagesKey") {
        // the SAME key exists on ceremony templates — the parent check keeps
        // those out (a template is never an Item output).
        let Some((parent, co_present)) = df_parent(o, outputs, game, "item", "Item") else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, Vec<decode::ItemDamages>>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        child_set(
            cypher,
            co_present,
            "Item",
            &parent,
            ckpt,
            &[format!("v.damages = {}", q_json(&damages_json(&f.value)))],
        );
        return Ok(());
    }
    if key == game_key(game, "forgemagie::ForgeKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "item", "Item") else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::ForgeState>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        let apps = Value::Array(f.value.apps.iter().map(|a| json!(a)).collect());
        child_set(
            cypher,
            co_present,
            "Item",
            &parent,
            ckpt,
            &[
                format!("v.puits = {}", q(&f.value.puits.to_string())),
                format!("v.apps = {}", apps),
            ],
        );
        return Ok(());
    }
    if key == game_key(game, "pet::FeedKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "item", "Item") else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<MarkerKey, decode::FeedState>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        child_set(
            cypher,
            co_present,
            "Item",
            &parent,
            ckpt,
            &[
                format!("v.pet_power = {}", f.value.count),
                format!("v.pet_last_day = {}", f.value.last_day),
            ],
        );
        return Ok(());
    }

    // ── World DFs: zones ──
    if key == game_key(game, "zone::ZoneKey") {
        let Some((parent, _)) = df_parent(o, outputs, game, "world", "World") else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<decode::ZoneKey, decode::Zone>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        // A zone is addressed by its WORLD'S NAME, like every other node in this graph (a Fight
        // carries `world` as the name too). The DF hangs off the World OBJECT, so the name has to
        // be read off the parent — and it is always there to read: every Move door that writes a
        // zone DF takes `&mut World` (search, consume_mob_group, consume_resource_node), so the
        // World is a mutated output of the same transaction, always.
        //
        // Keying on the parent's OBJECT ID instead (with the name kept beside it as a second
        // property) is what this used to do, and it made every zone unreadable: the server asks
        // for `{world: "01_first_shore"}` because that is the only world identity the chain gives
        // a player, and nothing ever matched.
        let Some(world) = outputs.iter().find(|w| w.id == parent) else {
            return Err(anyhow::anyhow!(
                "zone {} wrote without its parent World {} in the same checkpoint — the world \
                 name is this node's key and is never invented",
                o.id.hex(),
                parent.hex(),
            ));
        };
        let world_name = decode::from_bytes::<decode::World>(world.bytes)
            .map_err(|e| drift("world::World", world.id, e))?
            .name;
        let taken = Value::Array(f.value.res_taken.iter().map(|n| json!(n)).collect());
        let assigns = [
            format!("v.seed = {}", q(&f.value.seed.to_string())),
            format!("v.searched_at_ms = {}", f.value.searched_at_ms),
            format!("v.mob_taken = {}", q(&f.value.mob_taken.to_string())),
            format!("v.res_taken = {}", taken),
            format!("v.ckpt = {}", ckpt),
        ];
        cypher.push(format!(
            "MERGE (v:Zone {{world: {w}, zx: {zx}, zz: {zz}}}) SET {set}",
            w = q(&world_name),
            zx = f.name.zx,
            zz = f.name.zz,
            set = assigns.join(", "),
        ));
        return Ok(());
    }

    // ── native kiosk listing DF → LISTED_IN edge ──
    if key == format!("{SUI_FRAMEWORK}::kiosk::Listing") {
        let OwnerKind::Object(kiosk) = o.owner else {
            return Ok(());
        };
        let f = decode::from_bytes::<Field<decode::KioskListingKey, u64>>(o.bytes)
            .map_err(|e| drift(key, o.id, e))?;
        // the listed object's label is unknown here (the DF names only the id,
        // and `kiosk::list` does not touch the object) — try both labels; the
        // wrong one MATCHes nothing and no-ops. Labeled = index-backed lookups.
        let listed = q_id(&f.name.id);
        for label in ["Item", "Character"] {
            cypher.push(format!(
                "MATCH (:{label} {{id: {listed}}})-[r:LISTED_IN]->() DELETE r"
            ));
            cypher.push(format!(
                "MATCH (o:{label} {{id: {listed}}}) MERGE (k:Kiosk {{id: {kiosk}}}) \
                 CREATE (o)-[:LISTED_IN {{price: {price}, exclusive: {exclusive}, at_ms: {ts}}}]->(k)",
                kiosk = q_id(&kiosk),
                price = q(&f.value.to_string()),
                exclusive = f.name.is_exclusive,
                ts = view.ts_ms,
            ));
        }
    }
    Ok(())
}

// ╔════════════════ [ Fight — node + machine blob ] ══════════════════════════ ]

fn emit_fight(cypher: &mut Vec<String>, o: &ObjView<'_>, ckpt: u64) -> anyhow::Result<()> {
    let f =
        decode::from_bytes::<decode::Fight>(o.bytes).map_err(|e| drift("fight::Fight", o.id, e))?;
    let phase = if f.ended {
        "ended"
    } else if f.round == 0 {
        "placement"
    } else {
        "active"
    };
    let closable = f.ended
        && f.fighters
            .iter()
            .all(|fighter| fighter.settled && fighter.drops.is_empty());
    merge_set(
        cypher,
        "Fight",
        &f.id,
        ckpt,
        &[
            format!("v.world = {}", q(&f.world)),
            format!("v.x = {}", f.x),
            format!("v.z = {}", f.z),
            format!("v.phase = {}", q(phase)),
            match f.winner {
                Some(team) => format!("v.winner = {team}"),
                None => "v.winner = NULL".to_string(),
            },
            format!("v.access_a = {}", f.access_a),
            format!("v.access_b = {}", f.access_b),
            // the SIDE OPENERS ride the row, not just the machine blob: a reserved seat names
            // the character it waits for, and the client that must answer the invitation reads
            // it off the same marker row a bystander sees (2026-08-22 — matching a fight to a
            // player by POSITION was the alternative, and it matched the wrong things)
            match &f.opener_a {
                Some(id) => format!("v.opener_a = {}", q(&id.hex())),
                None => "v.opener_a = NULL".to_string(),
            },
            match &f.opener_b {
                Some(id) => format!("v.opener_b = {}", q(&id.hex())),
                None => "v.opener_b = NULL".to_string(),
            },
            format!("v.managed = {}", f.managed),
            format!("v.wagered = {}", f.wagered),
            match f.dungeon {
                Some(room) => format!("v.dungeon_room = {room}"),
                None => "v.dungeon_room = NULL".to_string(),
            },
            format!("v.drops_rolled = {}", f.drops_rolled),
            format!("v.closable = {closable}"),
            format!("v.turn_ptr = {}", f.turn_ptr),
            format!("v.round = {}", f.round),
            format!("v.turn_seed = {}", q(&f.turn_seed.to_string())),
            format!("v.placement_ms = {}", f.placement_ms),
            format!("v.turn_started_ms = {}", f.turn_started_ms),
            format!("v.machine = {}", q_json(&fight_machine(&f))),
        ],
    );
    cypher.push(format!(
        "MATCH (f:Fight {{id: {}}}) OPTIONAL MATCH (f)-[r:CLOSABLE_FOR]->() DELETE r",
        q_id(&f.id)
    ));
    if closable {
        let closers = f
            .fighters
            .iter()
            .filter_map(|fighter| match &fighter.kind {
                decode::FighterKind::Player { owner, .. } => Some(owner.hex()),
                decode::FighterKind::Mob(_) => None,
            })
            .collect::<BTreeSet<_>>();
        for owner in closers {
            cypher.push(format!(
                "MATCH (f:Fight {{id: {fight}}}) MERGE (u:User {{address: {owner}}}) CREATE (f)-[:CLOSABLE_FOR]->(u)",
                fight = q_id(&f.id),
                owner = q(&owner),
            ));
        }
    }
    // Durable post-fight work. It exists before the player's one atomic settlement and vanishes
    // from the output that returns the character and clears every assigned drop. Rebuilding the
    // complete edge set makes reconnect recovery latest-wins and idempotent.
    cypher.push(format!(
        "MATCH (f:Fight {{id: {}}}) OPTIONAL MATCH (f)-[r:RESULT_FOR]->() DELETE r",
        q_id(&f.id)
    ));
    if f.ended {
        for (seat, fighter) in f.fighters.iter().enumerate() {
            let decode::FighterKind::Player {
                character, owner, ..
            } = &fighter.kind
            else {
                continue;
            };
            if fighter.settled && fighter.drops.is_empty() {
                continue;
            }
            let drops = json!(fighter
                .drops
                .iter()
                .map(|drop| json!({ "item_type": drop.item_type, "qty": drop.qty }))
                .collect::<Vec<_>>());
            let loot_types = if f.winner == Some(fighter.team) {
                json!(f
                    .fighters
                    .iter()
                    .filter(|candidate| candidate.team != fighter.team)
                    .flat_map(|candidate| match &candidate.kind {
                        decode::FighterKind::Mob(snapshot) => snapshot
                            .loot
                            .iter()
                            .map(|row| row.item_type.clone())
                            .collect::<Vec<_>>(),
                        decode::FighterKind::Player { .. } => vec![],
                    })
                    .collect::<BTreeSet<_>>())
            } else {
                json!([])
            };
            cypher.push(format!(
                "MATCH (f:Fight {{id: {fight}}}) MERGE (u:User {{address: {owner}}}) \
                 CREATE (f)-[:RESULT_FOR {{seat: {seat}, character: {character}, team: {team}, \
                 dead: {dead}, settled: {settled}, loot_types: {loot_types}, drops: {drops}}}]->(u)",
                fight = q_id(&f.id),
                owner = q(&owner.hex()),
                character = q(&character.hex()),
                team = fighter.team,
                dead = fighter.dead,
                settled = fighter.settled,
                loot_types = q_json(&loot_types),
                drops = q_json(&drops),
            ));
        }
    }
    Ok(())
}

/// The machine blob — everything the server replays, one latest-wins document.
/// Seeds and bitmask words are STRINGS (2⁵³ law); small counters stay numbers.
fn fight_machine(f: &decode::Fight) -> Value {
    json!({
        "board": {
            "width": f.board.width,
            "height": f.board.height,
            "shape_mask": strs_u64(&f.board.shape_mask),
            "obstacles": f.board.obstacles,
            "holes": f.board.holes,
            "start_cells_a": f.board.start_cells_a,
            "start_cells_b": f.board.start_cells_b,
        },
        "closed": strs_u64(&f.closed),
        "opener_a": f.opener_a.as_ref().map(Id::hex),
        "opener_b": f.opener_b.as_ref().map(Id::hex),
        "queue": f.queue,
        "turn_slot": f.turn_slot,
        "turn_casts": f.turn_casts.iter().map(|c| json!({
            "spell": c.spell,
            "target": c.target.to_string(),
        })).collect::<Vec<_>>(),
        "zones": f.zones.iter().map(board_zone_json).collect::<Vec<_>>(),
        "fighters": f.fighters.iter().map(fighter_json).collect::<Vec<_>>(),
    })
}

fn fighter_json(fighter: &decode::Fighter) -> Value {
    let kind = match &fighter.kind {
        decode::FighterKind::Player {
            character,
            owner,
            level,
        } => json!({
            "player": { "character": character.hex(), "owner": owner.hex(), "level": level },
        }),
        decode::FighterKind::Mob(m) => json!({
            "mob": {
                "mob_type": m.mob_type,
                "level": m.level,
                "max_hp": m.max_hp,
                "ap": m.ap,
                "mp": m.mp,
                "agility": m.agility,
                "wisdom": m.wisdom,
                "earth_res": m.earth_res,
                "fire_res": m.fire_res,
                "water_res": m.water_res,
                "air_res": m.air_res,
                "xp": m.xp,
                "kit": m.kit.iter().map(|k| json!({
                    "name": k.name,
                    "ordinal": k.ordinal,
                    "level": spell_level_json(&k.level),
                })).collect::<Vec<_>>(),
                "loot": m.loot.iter().map(|l| json!({
                    "item_type": l.item_type,
                    "chance_bp": l.chance_bp,
                    "min_qty": l.min_qty,
                    "max_qty": l.max_qty,
                })).collect::<Vec<_>>(),
            },
        }),
    };
    json!({
        "team": fighter.team,
        "kind": kind,
        "cell": fighter.cell,
        "ready": fighter.ready,
        "dead": fighter.dead,
        "settled": fighter.settled,
        "forfeited": fighter.forfeited,
        "hp": fighter.hp,
        "ap": fighter.ap,
        "mp": fighter.mp,
        "drops": fighter.drops.iter().map(|d| json!({
            "item_type": d.item_type,
            "qty": d.qty,
        })).collect::<Vec<_>>(),
        "effects": fighter.effects.iter().map(|e| json!({
            "kind": e.kind,
            "element": e.element,
            "value": e.value,
            "turns_left": e.turns_left,
            "source": e.source,
            "stat": e.stat,
        })).collect::<Vec<_>>(),
        "cooldowns": fighter.cooldowns.iter().map(|c| json!({
            "spell": c.spell,
            "left": c.left,
        })).collect::<Vec<_>>(),
    })
}

fn board_zone_json(z: &decode::BoardZone) -> Value {
    json!({
        "owner_fighter": z.owner_fighter,
        "trap": z.trap,
        "shape": z.shape,
        "size": z.size,
        "anchor": z.anchor,
        "turns_left": z.turns_left,
        "effects": z.effects.iter().map(effect_json).collect::<Vec<_>>(),
    })
}

fn effect_json(e: &decode::Effect) -> Value {
    json!({
        "kind": e.kind,
        "element": e.element,
        "value": e.value,
        "value_max": e.value_max,
        "area_shape": e.area_shape,
        "area_size": e.area_size,
        "target_filter": e.target_filter,
        "chance_bp": e.chance_bp,
        "turns": e.turns,
        "stat": e.stat,
    })
}

fn spell_level_json(l: &decode::SpellLevel) -> Value {
    json!({
        "ap_cost": l.ap_cost,
        "range_min": l.range_min,
        "range_max": l.range_max,
        "modifiable_range": l.modifiable_range,
        "line_of_sight": l.line_of_sight,
        "line_launch": l.line_launch,
        "free_cell": l.free_cell,
        "casts_per_turn": l.casts_per_turn,
        "casts_per_target": l.casts_per_target,
        "cooldown_turns": l.cooldown_turns,
        "crit_1_in": l.crit_1_in,
        "effects": l.effects.iter().map(effect_json).collect::<Vec<_>>(),
        "crit_effects": l.crit_effects.iter().map(effect_json).collect::<Vec<_>>(),
    })
}

/// After custody edges exist, stamp each Player seat's team from the fighters
/// vector (index = seat). Runs only when the Fight object is in the checkpoint
/// — exactly when seats can have changed.
fn emit_fight_seat_teams(
    cypher: &mut Vec<String>,
    o: &ObjView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    if !is_game(o.type_key, game, "fight", "Fight") {
        return Ok(());
    }
    let f =
        decode::from_bytes::<decode::Fight>(o.bytes).map_err(|e| drift("fight::Fight", o.id, e))?;
    for (seat, fighter) in f.fighters.iter().enumerate() {
        if let decode::FighterKind::Player {
            character, owner, ..
        } = &fighter.kind
        {
            cypher.push(format!(
                "MATCH (:Fight {{id: {id}}})-[r:FIGHTER {{seat: {seat}}}]->() SET r.team = {team}",
                id = q_id(&f.id),
                team = fighter.team,
            ));
            cypher.push(format!(
                "MATCH (c:Character {{id: {c}}}) SET c.owner = {u}",
                c = q_id(character),
                u = q(&owner.hex()),
            ));
        }
    }
    Ok(())
}

// ╔════════════════ [ Party / friends — whole-value edge replacement ] ═══════ ]

/// The escrow's whole negotiation state on ONE node — the realtime layer enriches the cap
/// manifests from the Item/Character nodes it already has.
fn emit_trade(cypher: &mut Vec<String>, o: &ObjView<'_>, ckpt: u64) -> anyhow::Result<()> {
    let t =
        decode::from_bytes::<decode::Trade>(o.bytes).map_err(|e| drift("trade::Trade", o.id, e))?;
    let ids = |caps: &[Id]| {
        serde_json::to_string(&caps.iter().map(|c| c.hex()).collect::<Vec<_>>())
            .expect("string array json")
    };
    merge_set(
        cypher,
        "Trade",
        &t.id,
        ckpt,
        &[
            format!("v.a = {}", q(&t.a.hex())),
            format!("v.b = {}", q(&t.b.hex())),
            format!("v.version = {}", t.version),
            format!("v.accept_a = {}", t.accept_a),
            format!("v.accept_b = {}", t.accept_b),
            format!("v.locked = {}", t.locked),
            format!("v.sui_a = {}", q(&t.sui_a.value.to_string())),
            format!("v.sui_b = {}", q(&t.sui_b.value.to_string())),
            format!("v.caps_a = {}", q(&ids(&t.caps_a))),
            format!("v.caps_b = {}", q(&ids(&t.caps_b))),
        ],
    );
    Ok(())
}

fn emit_party(cypher: &mut Vec<String>, o: &ObjView<'_>, ckpt: u64) -> anyhow::Result<()> {
    let p =
        decode::from_bytes::<decode::Party>(o.bytes).map_err(|e| drift("party::Party", o.id, e))?;
    let id = q_id(&p.id);
    merge_set(cypher, "Party", &p.id, ckpt, &[]);
    cypher.push(format!(
        "MATCH (:Party {{id: {id}}})<-[r:MEMBER_OF]-() DELETE r"
    ));
    cypher.push(format!(
        "MATCH (:Party {{id: {id}}})-[r:INVITED]->() DELETE r"
    ));
    // MATCH, never MERGE: the chain does not verify an invited id exists, so a
    // MERGE would let invite-spam mint phantom Character nodes. A real
    // character always has a node (created at mint); a junk id matches nothing.
    for (order, member) in p.members.iter().enumerate() {
        cypher.push(format!(
            "MATCH (p:Party {{id: {id}}}) MATCH (c:Character {{id: {c}}}) \
             CREATE (c)-[:MEMBER_OF {{order: {order}}}]->(p)",
            c = q_id(member),
        ));
    }
    for invited in &p.pending {
        cypher.push(format!(
            "MATCH (p:Party {{id: {id}}}) MATCH (c:Character {{id: {c}}}) \
             CREATE (p)-[:INVITED]->(c)",
            c = q_id(invited),
        ));
    }
    Ok(())
}

fn emit_friend_list(cypher: &mut Vec<String>, o: &ObjView<'_>) -> anyhow::Result<()> {
    let list = decode::from_bytes::<decode::FriendList>(o.bytes)
        .map_err(|e| drift("friends::FriendList", o.id, e))?;
    let owner = q(&list.owner.hex());
    let friends = addr_array(&list.friends.contents);
    cypher.push(format!(
        "MERGE (u:User {{address: {owner}}}) \
         WITH u OPTIONAL MATCH (u)-[r:FRIEND]->() DELETE r \
         WITH DISTINCT u, {friends} AS friends UNWIND friends AS friend \
         MERGE (f:User {{address: friend}}) CREATE (u)-[:FRIEND]->(f)"
    ));
    Ok(())
}

// ╔════════════════ [ Custody — the one-ownership-edge law ] ═════════════════ ]

fn emit_custody(cypher: &mut Vec<String>, fact: &Custody) {
    match fact {
        Custody::KioskHolds {
            kiosk,
            object,
            label,
            owner,
        } => {
            let o = q_id(object);
            cypher.push(format!(
                "MATCH (:{label} {{id: {o}}})<-[r:HOLDS|FIGHTER|EQUIPS]-() DELETE r"
            ));
            cypher.push(format!(
                "MATCH (o:{label} {{id: {o}}}) MERGE (k:Kiosk {{id: {k}}}) CREATE (k)-[:HOLDS]->(o)",
                k = q_id(kiosk),
            ));
            // Character.owner stays fresh through custody (README schema) —
            // the kiosk's owner rode along whenever the kiosk was co-present.
            if *label == "Character" {
                if let Some(owner) = owner {
                    cypher.push(format!(
                        "MATCH (c:Character {{id: {o}}}) SET c.owner = {u}",
                        u = q(&owner.hex()),
                    ));
                }
            }
        }
        Custody::FightSeats {
            fight,
            seat,
            character,
        } => {
            let c = q_id(character);
            cypher.push(format!(
                "MATCH (:Character {{id: {c}}})<-[r:HOLDS|FIGHTER|EQUIPS]-() DELETE r"
            ));
            cypher.push(format!(
                "MATCH (c:Character {{id: {c}}}) MERGE (f:Fight {{id: {f}}}) \
                 CREATE (f)-[:FIGHTER {{seat: {seat}}}]->(c)",
                f = q_id(fight),
            ));
        }
        Custody::ClaimHeld { user, claim, label } => {
            let c = q_id(claim);
            cypher.push(format!(
                "MATCH (:{label} {{id: {c}}})<-[r:HOLDS_CLAIM]-() DELETE r"
            ));
            cypher.push(format!(
                "MATCH (n:{label} {{id: {c}}}) MERGE (u:User {{address: {u}}}) \
                 CREATE (u)-[:HOLDS_CLAIM]->(n)",
                u = q(&user.hex()),
            ));
        }
        Custody::VoucherHeld { user, giftcard } => {
            let g = q_id(giftcard);
            cypher.push(format!(
                "MATCH (:Giftcard {{id: {g}}})<-[r:HOLDS_VOUCHER]-() DELETE r"
            ));
            cypher.push(format!(
                "MATCH (g:Giftcard {{id: {g}}}) MERGE (u:User {{address: {u}}}) \
                 CREATE (u)-[:HOLDS_VOUCHER]->(g)",
                u = q(&user.hex()),
            ));
        }
    }
}

// ╔════════════════ [ Deletes — pre-state-typed reaping ] ════════════════════ ]

fn emit_delete(cypher: &mut Vec<String>, gone: &ObjView<'_>, game: &str) -> anyhow::Result<()> {
    let t = gone.type_key;
    let node = [
        ("character", "Character", "Character"),
        ("item", "Item", "Item"),
        ("fight", "Fight", "Fight"),
        ("party", "Party", "Party"),
        ("kolizeum", "Kolizeum", "Kolizeum"),
        ("shop", "Giftcard", "Giftcard"),
        ("shop", "Airdrop", "Airdrop"),
        ("loot_box", "BoxClaim", "BoxClaim"),
        ("forgemagie", "CrushClaim", "CrushClaim"),
        ("trade", "Trade", "Trade"),
    ]
    .iter()
    .find(|(module, name, _)| is_game(t, game, module, name))
    .map(|(_, _, label)| *label);
    if let Some(label) = node {
        cypher.push(format!(
            "MATCH (n:{label} {{id: {id}}}) DETACH DELETE n",
            id = q_id(&gone.id),
        ));
        return Ok(());
    }
    if let Some(key) = field_key(t) {
        // the run DF is the one REMOVABLE game DF (end_run) — its deletion
        // clears the character's run (the pre-state owner IS the character).
        if key == game_key(game, "dungeon::DungeonRunKey") {
            if let OwnerKind::Object(character) = gone.owner {
                cypher.push(format!(
                    "MATCH (c:Character {{id: {id}}}) SET c.dungeon_run = NULL, c.dungeon_world = NULL, \
                     c.dungeon_room = NULL, c.dungeon_x = NULL, c.dungeon_z = NULL, c.dungeon_seed = NULL",
                    id = q_id(&character),
                ));
            }
            return Ok(());
        }
        // a deleted listing DF ends the listing (delist or purchase).
        if key == format!("{SUI_FRAMEWORK}::kiosk::Listing") {
            let f = decode::from_bytes::<Field<decode::KioskListingKey, u64>>(gone.bytes)
                .map_err(|e| drift("deleted kiosk::Listing", gone.id, e))?;
            for label in ["Item", "Character"] {
                cypher.push(format!(
                    "MATCH (:{label} {{id: {id}}})-[r:LISTED_IN]->() DELETE r",
                    id = q_id(&f.name.id),
                ));
            }
        }
    }
    Ok(())
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode::{Addr, Hp};

    const GAME: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn t(package: &str, module: &str, name: &str, params: &[&str]) -> TypeKey {
        TypeKey {
            package: package.into(),
            module: module.into(),
            name: name.into(),
            type_params: params.iter().map(|p| p.to_string()).collect(),
        }
    }

    fn view<'a>(
        outputs: &'a [ObjView<'a>],
        deleted: &'a [ObjView<'a>],
        custody: &'a [Custody],
    ) -> CheckpointView<'a> {
        CheckpointView {
            ckpt: 100,
            ts_ms: 1_700_000_000_000,
            outputs,
            deleted,
            custody,
            market: &[],
            fight_lifecycle: &[],
        }
    }

    #[test]
    fn escaping_defuses_injection() {
        assert_eq!(q("it's"), "'it\\'s'");
        assert_eq!(q(r"back\slash"), r"'back\\slash'");
        let hostile = "'}) DETACH DELETE (n) //";
        assert!(q(hostile).starts_with("'\\'"));
    }

    #[test]
    fn character_object_writes_only_its_props() {
        let chr = crate::decode::Character {
            id: Id([1; 32]),
            name: "aiden".into(),
            classe: "yajin".into(),
            sex: "male".into(),
            experience: 10,
            level: 2,
            color_1: 1,
            color_2: 2,
            color_3: 3,
            vitality: 5,
            wisdom: 0,
            strength: 0,
            intelligence: 0,
            chance: 0,
            agility: 0,
            available_points: 5,
            available_spell_points: 2,
        };
        let bytes = bcs::to_bytes(&chr).unwrap();
        let ty = t(GAME, "character", "Character", &[]);
        let outputs = [ObjView {
            id: Id([1; 32]),
            owner: OwnerKind::Shared,
            type_key: &ty,
            bytes: &bytes,
        }];
        let cypher = project(&view(&outputs, &[], &[]), GAME).unwrap();
        assert_eq!(cypher.len(), 1);
        assert!(cypher[0].starts_with("MERGE (v:Character {id: '0x"));
        assert!(cypher[0].contains("v.name = 'aiden'"));
        assert!(cypher[0].contains("v.experience = '10'"));
        // per-property law: hp/world/jobs are OTHER sources' props — untouched.
        assert!(!cypher[0].contains("v.hp"));
        assert!(!cypher[0].contains("v.world"));
    }

    #[test]
    fn hp_field_needs_its_character_co_present() {
        let field = Field {
            id: Id([9; 32]),
            name: false,
            value: Hp {
                current: 137,
                last_ms: 5,
            },
        };
        let bytes = bcs::to_bytes(&field).unwrap();
        let key = format!("{GAME}::progression::HpKey");
        let ty = t(
            crate::ownership::SUI_FRAMEWORK,
            "dynamic_field",
            "Field",
            &[&key, "u64"],
        );
        // parent ABSENT from the checkpoint → the write is MATCH-guarded: it lands on the
        // character IF the graph knows it, and on nothing otherwise (2026-08-21: equip/hp
        // transactions mutate only the DF — the old drop-it rule lost every such write)
        let orphan = [ObjView {
            id: Id([9; 32]),
            owner: OwnerKind::Object(Id([1; 32])),
            type_key: &ty,
            bytes: &bytes,
        }];
        let lone = project(&view(&orphan, &[], &[]), GAME).unwrap();
        assert_eq!(lone.len(), 1);
        assert!(
            lone[0].starts_with("MATCH (v:Character"),
            "guarded, never MERGE: {}",
            lone[0]
        );
        assert!(lone[0].contains("v.hp = '137'"));

        // parent present → the two hp props land on the character node
        let chr_ty = t(GAME, "character", "Character", &[]);
        let chr_bytes = bcs::to_bytes(&crate::decode::Character {
            id: Id([1; 32]),
            name: "a".into(),
            classe: "yajin".into(),
            sex: "male".into(),
            experience: 0,
            level: 1,
            color_1: 0,
            color_2: 0,
            color_3: 0,
            vitality: 0,
            wisdom: 0,
            strength: 0,
            intelligence: 0,
            chance: 0,
            agility: 0,
            available_points: 0,
            available_spell_points: 0,
        })
        .unwrap();
        let outputs = [
            ObjView {
                id: Id([1; 32]),
                owner: OwnerKind::Shared,
                type_key: &chr_ty,
                bytes: &chr_bytes,
            },
            ObjView {
                id: Id([9; 32]),
                owner: OwnerKind::Object(Id([1; 32])),
                type_key: &ty,
                bytes: &bytes,
            },
        ];
        let cypher = project(&view(&outputs, &[], &[]), GAME).unwrap();
        let hp_write = cypher.iter().find(|c| c.contains("v.hp = '137'")).unwrap();
        assert!(hp_write.contains("v.hp_ms = 5"));
    }

    /// A World is id + NAME — all a zone needs from it (slim by law, Lever 2).
    fn world_bytes(name: &str) -> Vec<u8> {
        bcs::to_bytes(&decode::World {
            id: Id([1; 32]),
            name: name.into(),
        })
        .unwrap()
    }

    #[test]
    fn a_zone_is_keyed_by_its_world_name_like_every_other_node() {
        // 2026-08-22: this node used to key on the parent World's OBJECT ID and keep the name
        // beside it as `world_name`. Every read asks for `{world: "01_first_shore"}` — the only
        // world identity the chain hands a player — so nothing ever matched and a searched zone
        // came back empty: no mobs, no resources, no compass pips, and a discovery prompt that
        // never went away because the row it waits for could not arrive.
        let world_ty = t(GAME, "world", "World", &[]);
        let world = world_bytes("01_first_shore");
        let zone_ty = t(
            crate::ownership::SUI_FRAMEWORK,
            "dynamic_field",
            "Field",
            &[
                &format!("{GAME}::zone::ZoneKey"),
                &format!("{GAME}::zone::Zone"),
            ],
        );
        let zone = bcs::to_bytes(&Field {
            id: Id([9; 32]),
            name: decode::ZoneKey { zx: 97, zz: 98 },
            value: decode::Zone {
                seed: 4_163_223_416,
                searched_at_ms: 1_787_383_013_369,
                mob_taken: 5,
                res_taken: vec![1, 2],
            },
        })
        .unwrap();
        let outputs = [
            ObjView {
                id: Id([1; 32]),
                owner: OwnerKind::Shared,
                type_key: &world_ty,
                bytes: &world,
            },
            ObjView {
                id: Id([9; 32]),
                owner: OwnerKind::Object(Id([1; 32])),
                type_key: &zone_ty,
                bytes: &zone,
            },
        ];

        let cypher = project(&view(&outputs, &[], &[]), GAME).unwrap();
        let write = cypher.iter().find(|c| c.contains(":Zone")).unwrap();

        assert!(write.contains("MERGE (v:Zone {world: '01_first_shore', zx: 97, zz: 98})"));
        // the name is the KEY, never a second property beside an id key
        assert!(!write.contains("world_name"));
        assert!(!write.contains("0x0101"));
        assert!(write.contains("v.seed = '4163223416'"));
        assert!(write.contains("v.mob_taken = '5'"));
        assert!(write.contains("v.res_taken = [1,2]"));
    }

    #[test]
    fn a_zone_without_its_parent_world_fails_loudly_rather_than_unkeyed() {
        // the name cannot be invented, and a zone written under a guessed key is worse than one
        // not written at all — it would be permanently invisible to every read
        let zone_ty = t(
            crate::ownership::SUI_FRAMEWORK,
            "dynamic_field",
            "Field",
            &[
                &format!("{GAME}::zone::ZoneKey"),
                &format!("{GAME}::zone::Zone"),
            ],
        );
        let zone = bcs::to_bytes(&Field {
            id: Id([9; 32]),
            name: decode::ZoneKey { zx: 1, zz: 2 },
            value: decode::Zone {
                seed: 7,
                searched_at_ms: 1,
                mob_taken: 0,
                res_taken: vec![],
            },
        })
        .unwrap();
        let outputs = [ObjView {
            id: Id([9; 32]),
            owner: OwnerKind::Object(Id([1; 32])),
            type_key: &zone_ty,
            bytes: &zone,
        }];

        let failure = project(&view(&outputs, &[], &[]), GAME)
            .unwrap_err()
            .to_string();

        assert!(failure.contains("without its parent World"));
    }

    #[test]
    fn custody_replaces_the_one_ownership_edge() {
        let facts = [Custody::FightSeats {
            fight: Id([8; 32]),
            seat: 2,
            character: Id([1; 32]),
        }];
        let cypher = project(&view(&[], &[], &facts), GAME).unwrap();
        assert_eq!(cypher.len(), 2);
        assert!(cypher[0].contains("[r:HOLDS|FIGHTER|EQUIPS]"));
        assert!(cypher[0].contains("DELETE r"));
        assert!(cypher[1].contains("CREATE (f)-[:FIGHTER {seat: 2}]->(c)"));
    }

    #[test]
    fn deleted_character_is_detach_deleted() {
        let ty = t(GAME, "character", "Character", &[]);
        let gone = [ObjView {
            id: Id([1; 32]),
            owner: OwnerKind::Shared,
            type_key: &ty,
            bytes: &[],
        }];
        let cypher = project(&view(&[], &gone, &[]), GAME).unwrap();
        assert_eq!(cypher.len(), 1);
        assert!(cypher[0].contains("DETACH DELETE"));
    }

    #[test]
    fn deleted_listing_field_ends_the_listing() {
        let field = Field {
            id: Id([9; 32]),
            name: crate::decode::KioskListingKey {
                id: Id([5; 32]),
                is_exclusive: false,
            },
            value: 1_000u64,
        };
        let bytes = bcs::to_bytes(&field).unwrap();
        let key = format!("{}::kiosk::Listing", crate::ownership::SUI_FRAMEWORK);
        let ty = t(
            crate::ownership::SUI_FRAMEWORK,
            "dynamic_field",
            "Field",
            &[&key, "u64"],
        );
        let gone = [ObjView {
            id: Id([9; 32]),
            owner: OwnerKind::Object(Id([2; 32])),
            type_key: &ty,
            bytes: &bytes,
        }];
        // one labeled reap per possible label — the wrong one MATCHes nothing
        let cypher = project(&view(&[], &gone, &[]), GAME).unwrap();
        assert_eq!(cypher.len(), 2);
        assert!(cypher[0].contains(":Item") && cypher[1].contains(":Character"));
        for statement in &cypher {
            assert!(statement.contains("[r:LISTED_IN]"));
            assert!(statement.contains(&Id([5; 32]).hex()));
        }
    }

    #[test]
    fn a_new_split_lot_exists_before_its_listing_edge_is_created() {
        let item_id = Id([5; 32]);
        let listing = bcs::to_bytes(&Field {
            id: Id([9; 32]),
            name: crate::decode::KioskListingKey {
                id: item_id,
                is_exclusive: false,
            },
            value: 1_000u64,
        })
        .unwrap();
        let listing_key = format!("{}::kiosk::Listing", crate::ownership::SUI_FRAMEWORK);
        let listing_ty = t(
            crate::ownership::SUI_FRAMEWORK,
            "dynamic_field",
            "Field",
            &[&listing_key, "u64"],
        );
        let item = bcs::to_bytes(&crate::decode::Item {
            id: item_id,
            template: Id([4; 32]),
            name: "Wool".into(),
            item_type: "wooling_wool".into(),
            category: "resource".into(),
            level: 1,
            amount: 10,
        })
        .unwrap();
        let item_ty = t(GAME, "item", "Item", &[]);
        // Sui may return the listing field before the split Item it names.
        let outputs = [
            ObjView {
                id: Id([9; 32]),
                owner: OwnerKind::Object(Id([2; 32])),
                type_key: &listing_ty,
                bytes: &listing,
            },
            ObjView {
                id: item_id,
                owner: OwnerKind::Object(Id([2; 32])),
                type_key: &item_ty,
                bytes: &item,
            },
        ];

        let cypher = project(&view(&outputs, &[], &[]), GAME).unwrap();
        let item_write = cypher
            .iter()
            .position(|statement| statement.starts_with("MERGE (v:Item"))
            .unwrap();
        let listing_write = cypher
            .iter()
            .position(|statement| statement.contains("CREATE (o)-[:LISTED_IN"))
            .unwrap();

        assert!(item_write < listing_write);
    }

    #[test]
    fn market_stamp_is_latest_wins_set() {
        let stamps = [MarketStamp {
            item_type: "wooling_wool".into(),
            price_per_unit_mist: 15_000_000,
            ts_ms: 1_700_000_000_000,
        }];
        let v = CheckpointView {
            ckpt: 100,
            ts_ms: 1_700_000_000_000,
            outputs: &[],
            deleted: &[],
            custody: &[],
            market: &stamps,
            fight_lifecycle: &[],
        };
        let cypher = project(&v, GAME).unwrap();
        assert_eq!(cypher.len(), 1);
        assert!(cypher[0].contains("MERGE (m:Market {item_type: 'wooling_wool'})"));
        assert!(cypher[0].contains("m.last_sale_mist = '15000000'"));
    }

    #[test]
    fn fight_lifecycle_events_persist_the_checkpoint_clock() {
        let stamps = [
            FightLifecycleStamp {
                fight: "0xf1".into(),
                started: true,
                ts_ms: 10_000,
            },
            FightLifecycleStamp {
                fight: "0xf1".into(),
                started: false,
                ts_ms: 135_000,
            },
        ];
        let v = CheckpointView {
            ckpt: 100,
            ts_ms: 135_000,
            outputs: &[],
            deleted: &[],
            custody: &[],
            market: &[],
            fight_lifecycle: &stamps,
        };

        let cypher = project(&v, GAME).unwrap();
        assert!(cypher[0].contains("f.started_ms = 10000"));
        assert!(cypher[1].contains("f.ended_ms = 135000"));
    }

    #[test]
    fn friend_list_replaces_all_edges() {
        let list = crate::decode::FriendList {
            id: Id([3; 32]),
            owner: Addr([1; 32]),
            friends: crate::decode::VecSet {
                contents: vec![Addr([2; 32])],
            },
        };
        let bytes = bcs::to_bytes(&list).unwrap();
        let ty = t(GAME, "friends", "FriendList", &[]);
        let outputs = [ObjView {
            id: Id([3; 32]),
            owner: OwnerKind::Address(Addr([1; 32])),
            type_key: &ty,
            bytes: &bytes,
        }];
        let cypher = project(&view(&outputs, &[], &[]), GAME).unwrap();
        assert_eq!(cypher.len(), 1);
        assert!(cypher[0].contains("[r:FRIEND]->() DELETE r"));
        assert!(cypher[0].contains("UNWIND friends AS friend"));
        assert!(cypher[0].contains("CREATE (u)-[:FRIEND]->(f)"));
    }
}
