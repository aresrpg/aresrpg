// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The graph projection — decoded chain objects → Cypher, PURE.
//!
//! One checkpoint's views in, an ORDERED list of Cypher statements out; no
//! store reads, ever. The laws this file carries (README):
//!
//! * **Objects are the sole writers** — every statement here derives from an
//!   output object, its pre-state input, a custody fact, or a pre-state delete view.
//! * **Per-property writes** — each decoded source SETs exactly its own
//!   properties over a `MERGE` skeleton; nothing ever replaces a whole node.
//! * **One ownership edge per object** — custody writes DELETE the standing
//!   `HOLDS|FIGHTER|EQUIPS` edge before creating the new one.
//! * **DF writes are parent-guarded, never parent-blocked** — a DF born WITH its
//!   typed parent merges order-free; a DF arriving alone (equip/hp/scribe mutate
//!   only the child — a `&mut` borrow emits no parent object)
//!   writes MATCH-guarded on the parent's label: a foreign or unknown parent
//!   matches nothing (this still keeps ceremony-template DFs out of the item space).
//! * **Strings ≥ 2⁵³** — seeds, bitmasks, MIST are string properties.
//!
//! Each transaction applies consumed pre-state before its surviving final outputs: nodes,
//! dependent fields, custody and seat fixups. The pipeline preserves transaction order.

use std::collections::BTreeSet;

use serde_json::{json, Value};

use crate::decode::{self, Field, Id, MarkerKey};
use crate::ownership::{Custody, ObjView, OwnerKind, SUI_FRAMEWORK};

/// One transaction's final effects.
pub struct CheckpointView<'a> {
    pub lamport_version: u64,
    pub ckpt: u64,
    pub ts_ms: u64,
    /// The transaction's pre-state inputs: lifecycle clocks are input → output deltas.
    pub inputs: &'a [ObjView<'a>],
    /// Surviving outputs from exactly one transaction.
    pub outputs: &'a [ObjView<'a>],
    /// PRE-STATE views of that transaction's deleted ids (law 2).
    pub deleted: &'a [ObjView<'a>],
    pub custody: &'a [Custody],
}

/// Project one transaction into Cypher statements; the pipeline retains certified transaction order.
///
/// A decode failure of a type-matched game object is LAYOUT DRIFT, never noise
/// (type identity pins these types to our package) — it errors the checkpoint,
/// stalling ingestion loudly instead of letting the watermark advance past
/// unprojected state (the no-silent-failures law).
pub fn project(view: &CheckpointView<'_>, game: &str) -> anyhow::Result<Vec<String>> {
    let mut cypher = vec![];
    for gone in view.deleted {
        if !view.outputs.iter().any(|output| output.id == gone.id) {
            emit_delete(&mut cypher, gone, game)?;
        }
    }
    let is_kiosk = |output: &&ObjView<'_>| output.type_key.is(SUI_FRAMEWORK, "kiosk", "Kiosk");
    for output in view
        .outputs
        .iter()
        .filter(|output| output.type_key.field_key().is_none() && !is_kiosk(output))
    {
        emit_object(&mut cypher, output, view, game)?;
    }
    for output in view
        .outputs
        .iter()
        .filter(|output| output.type_key.field_key().is_some())
    {
        emit_object(&mut cypher, output, view, game)?;
    }
    // Only a relation to a game asset (holding or listing it) creates a Kiosk node. The kiosk's
    // own facts follow and update an existing node only, so an unrelated kiosk leaves no record.
    let (kiosk_owners, relations): (Vec<_>, Vec<_>) = view
        .custody
        .iter()
        .partition(|fact| matches!(fact, Custody::KioskOwned { .. }));
    for fact in relations.into_iter().chain(kiosk_owners) {
        emit_custody(&mut cypher, fact);
    }
    for output in view.outputs.iter().filter(is_kiosk) {
        let k = output.decode::<decode::Kiosk>()?;
        child_set(
            &mut cypher,
            false,
            "Kiosk",
            &k.id,
            view.ckpt,
            &[format!("v.profits = {}", q(&k.profits.value.to_string()))],
        );
    }
    for output in view.outputs {
        emit_fight_seat_teams(&mut cypher, output, game)?;
    }
    // The catalogue revision follows all of its relation writes. A read cannot certify an
    // older catalogue with the transaction's newer native version.
    let listing_key = format!("{SUI_FRAMEWORK}::kiosk::Listing");
    let kiosks: BTreeSet<_> = view
        .outputs
        .iter()
        .chain(view.deleted)
        .filter_map(|object| match (object.type_key.field_key(), object.owner) {
            (Some(key), OwnerKind::Object(kiosk)) if key == listing_key => Some(kiosk.hex()),
            _ => None,
        })
        .collect();
    for kiosk in kiosks {
        cypher.push(format!(
            "MATCH (k:Kiosk {{id: {kiosk}}}) SET k.market_version = {version}",
            kiosk = q(&kiosk),
            version = q(&view.lamport_version.to_string())
        ));
    }
    // Publish native Character versions only after all dependent fields and custody writes.
    // Root writes clear the old marker so partial replay cannot certify mixed state.
    for output in view
        .outputs
        .iter()
        .filter(|output| output.type_key.is(game, "character", "Character"))
    {
        cypher.push(format!(
            "MATCH (c:Character {{id: {id}}}) SET c.version = {version}",
            id = q_id(&output.id),
            version = q(&output.version.to_string()),
        ));
    }
    Ok(cypher)
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

/// Character field vocabulary shared by graph projection and its post-projection invalidation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CharacterField {
    Hp,
    JobXp,
    SpellBook,
    Folded,
    Equipment,
    CurrentWorld,
    Checkpoint,
    DungeonRun,
    Ambush,
}
pub(crate) fn character_field(key: &str, game: &str) -> Option<CharacterField> {
    match key.strip_prefix(game)?.strip_prefix("::")? {
        "progression::HpKey" => Some(CharacterField::Hp),
        "progression::JobXpKey" => Some(CharacterField::JobXp),
        "progression::SpellBookKey" => Some(CharacterField::SpellBook),
        "equipment::FoldedKey" => Some(CharacterField::Folded),
        "equipment::EquipmentKey" => Some(CharacterField::Equipment),
        "world::CurrentWorldKey" => Some(CharacterField::CurrentWorld),
        "world::CheckpointKey" => Some(CharacterField::Checkpoint),
        "dungeon::DungeonRunKey" => Some(CharacterField::DungeonRun),
        "gathering::AmbushKey" => Some(CharacterField::Ambush),
        _ => None,
    }
}

/// The parent of a DF, from its owner edge. The bool marks TYPED CO-PRESENCE: the parent
/// object rode the same transaction (a fresh parent+DF birth — write with MERGE, order-free).
/// A DF arriving ALONE (equip/hp/scribe mutate only the child) writes MATCH-guarded instead:
/// the GRAPH's own label is the type guard, a foreign parent matches nothing.
pub(crate) fn df_parent<'a>(
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
        .any(|o| o.id == parent && o.type_key.is(game, module, name));
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

/// A remembered per-world checkpoint may be replayed after the character has left that world.
/// Without this guard it overwrites the active anchor and the client correctly refuses control.
fn child_set_in_world(
    cypher: &mut Vec<String>,
    label: &str,
    id: &Id,
    ckpt: u64,
    world: &str,
    assigns: &[String],
) {
    let mut set = format!("v.ckpt = {ckpt}");
    for assign in assigns {
        set.push_str(", ");
        set.push_str(assign);
    }
    cypher.push(format!(
        "MATCH (v:{label} {{id: {id}}}) WHERE v.world = {world} SET {set}",
        id = q_id(id),
        world = q(world),
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
    if t.is(game, "character", "Character") {
        let c = o.decode::<decode::Character>()?;
        merge_set(
            cypher,
            "Character",
            &c.id,
            ckpt,
            &[
                "v.version = NULL".into(),
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
    if t.is(game, "item", "Item") {
        let i = o.decode::<decode::Item>()?;
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
                format!("v.version = {}", q(&o.version.to_string())),
            ],
        );
        return Ok(());
    }
    if t.is(game, "zone", "Zone") {
        let zone = o.decode::<decode::Zone>()?;
        let taken = Value::Array(zone.res_taken.iter().map(|count| json!(count)).collect());
        cypher.push(format!(
            "MERGE (v:Zone {{world: {world}, zx: {zone_x}, zz: {zone_z}}}) SET \
             v.id = {id}, v.seed = {seed}, v.searched_at_ms = {searched_at_ms}, \
             v.mob_taken = {mob_taken}, v.res_taken = {res_taken}, v.ckpt = {ckpt}",
            world = q(&zone.world),
            zone_x = zone.zone_x,
            zone_z = zone.zone_z,
            id = q_id(&zone.id),
            seed = q(&zone.seed.to_string()),
            searched_at_ms = zone.searched_at_ms,
            mob_taken = q(&zone.mob_taken.to_string()),
            res_taken = taken,
        ));
        return Ok(());
    }
    if t.is(game, "fight", "Fight") {
        return emit_fight(cypher, o, view);
    }
    if t.is(game, "party", "Party") {
        return emit_party(cypher, o, ckpt);
    }
    if t.is(game, "trade", "Trade") {
        return emit_trade(cypher, o, ckpt);
    }
    if t.is(game, "friends", "FriendList") {
        return emit_friend_list(cypher, o);
    }
    if t.is(game, "mastery", "Mastery") {
        let mastery = o.decode::<decode::Mastery>()?;
        let owner = q(&mastery.owner.hex());
        let last_completed = mastery
            .last_completed_epoch
            .map_or_else(|| "NULL".to_string(), |epoch| q(&epoch.to_string()));
        cypher.push(format!(
            "MERGE (u:User {{address: {owner}}}) SET u.mastery_id = {id}, \
             u.mastery_points = {points}, u.mastery_last_completed_epoch = {last_completed}, \
             u.mastery_quest_epoch = {quest_epoch}, u.mastery_quest_world = {world}, \
             u.mastery_quest_started_ms = {started_ms}, \
             u.mastery_quest_dungeon = {dungeon}, u.mastery_quest_reward = {reward}, \
             u.mastery_quest_completed = {completed}",
            id = q_id(&mastery.id),
            points = q(&mastery.points.to_string()),
            quest_epoch = q(&mastery.quest_epoch.to_string()),
            started_ms = q(&mastery.quest_started_ms.to_string()),
            world = q(&mastery.quest_world),
            dungeon = q_id(&mastery.quest_dungeon),
            reward = mastery.quest_reward,
            completed = mastery.quest_completed,
        ));
        return Ok(());
    }
    if t.is(game, "mastery", "MasteryOffer") {
        let offer = o.decode::<decode::MasteryOffer>()?;
        merge_set(
            cypher,
            "MasteryOffer",
            &offer.id,
            ckpt,
            &[
                format!("v.item_type = {}", q(&offer.item_type)),
                format!("v.template = {}", q_id(&offer.template)),
                format!("v.cost = {}", q(&offer.cost.to_string())),
                format!("v.enabled = {}", offer.enabled),
            ],
        );
        return Ok(());
    }
    if t.is(game, "tournament", "KaresPool") {
        let pool = o.decode::<decode::TournamentKaresPool>()?;
        let claims = pool
            .funds
            .claimed
            .contents
            .iter()
            .map(|id| id.hex())
            .collect::<Vec<_>>();
        merge_set(
            cypher,
            "TournamentKaresPool",
            &pool.id,
            ckpt,
            &[
                format!("v.balance = {}", q(&pool.funds.balance.value.to_string())),
                format!(
                    "v.total = {}",
                    q(&(pool.funds.balance.value + pool.funds.paid).to_string())
                ),
                format!("v.claimed = {}", serde_json::to_string(&claims)?),
                format!("v.refunded = {}", pool.funds.refunded),
                format!("v.version = {}", q(&o.version.to_string())),
            ],
        );
        return Ok(());
    }
    if t.is(game, "tournament", "Tournament") {
        let tournament = o.decode::<decode::Tournament>()?;
        anyhow::ensure!(
            tournament.matches.len() == tournament.fights.len(),
            "tournament match links differ"
        );
        let row = crate::tournament::row(&tournament, o.version);
        if tournament.status == "finished" {
            // Claims also write Tournament. Only the actual terminal transition owns this clock;
            // an already-finished legacy projection must not acquire a fabricated completion time.
            cypher.push(format!(
                "MATCH (v:Tournament {{id: {}}}) WHERE v.status = 'in_progress' AND v.finished_at_ms IS NULL SET v.finished_at_ms = {}",
                q_id(&tournament.id), view.ts_ms
            ));
        }
        merge_set(
            cypher,
            "Tournament",
            &tournament.id,
            ckpt,
            &[
                format!("v.status = {}", q(&tournament.status)),
                format!(
                    "v.kares_pool = {}",
                    tournament
                        .kares_pool
                        .map(|id| q_id(&id))
                        .unwrap_or_else(|| "NULL".into())
                ),
                format!("v.data = {}", q(&row.to_string())),
                format!("v.created_ckpt = coalesce(v.created_ckpt, {ckpt})"),
            ],
        );
        cypher.push(format!(
            "MATCH (t:Tournament {{id: {}}})-[r:REGISTERED]->() DELETE r",
            q_id(&tournament.id)
        ));
        for (team, roster) in tournament.teams.iter().enumerate() {
            for (seat, member) in roster.seats.iter().enumerate() {
                cypher.push(format!("MATCH (t:Tournament {{id: {}}}) MERGE (u:User {{address: {}}}) CREATE (t)-[:REGISTERED {{pending: {}, eligible: {}, character: {}}}]->(u)",
                    q_id(&tournament.id), q(&member.owner.hex()), crate::tournament::pending(&tournament, team, seat), roster.place > 0, q_id(&member.character)));
            }
        }
        for (index, fight) in tournament.fights.iter().enumerate() {
            if let Some(fight) = fight {
                cypher.push(format!("MERGE (m:TournamentMatch {{fight_id: {}}}) SET m.tournament = {}, m.index = {index}", q_id(fight), q_id(&tournament.id)));
            }
        }
        return Ok(());
    }
    if t.is(game, "kolizeum", "Kolizeum") {
        let k = o.decode::<decode::Kolizeum>()?;
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
    if t.is(game, "distribution", "Giftcard") {
        let g = o.decode::<decode::Giftcard>()?;
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
    if t.is(game, "loot_box", "BoxClaim") {
        let c = o.decode::<decode::BoxClaim>()?;
        merge_set(
            cypher,
            "BoxClaim",
            &c.id,
            ckpt,
            &[
                format!("v.rolled_template = {}", q_id(&c.rolled_template)),
                format!("v.amount = {}", c.amount),
            ],
        );
        return Ok(());
    }
    if t.is(game, "forgemagie", "CrushClaim") {
        // The claim node anchors its HOLDS_CLAIM edge; readers need its id alone.
        merge_set(cypher, "CrushClaim", &o.id, ckpt, &[]);
        return Ok(());
    }
    if t.is(game, "version", "Version") {
        let v = o.decode::<decode::Version>()?;
        cypher.push(format!(
            "MERGE (m:Meta {{id: 'meta'}}) SET m.version = {}, m.ckpt = {ckpt}",
            v.version
        ));
        return Ok(());
    }

    // ── dynamic fields, dispatched by KEY type ──
    if let Some(key) = t.field_key() {
        emit_field(cypher, o, key, view, game)?;
    }
    Ok(())
}

// ╔════════════════ [ Dynamic fields ] ═══════════════════════════════════════ ]

fn game_key(game: &str, path: &str) -> String {
    format!("{game}::{path}")
}

pub(crate) fn current_world_output(
    outputs: &[ObjView<'_>],
    parent: &Id,
    game: &str,
) -> anyhow::Result<Option<String>> {
    let current_key = game_key(game, "world::CurrentWorldKey");
    for candidate in outputs {
        if !matches!(candidate.owner, OwnerKind::Object(owner) if owner == *parent)
            || candidate.type_key.field_key() != Some(current_key.as_str())
        {
            continue;
        }
        let field = candidate.decode::<Field<MarkerKey, String>>()?;
        return Ok(Some(field.value));
    }
    Ok(None)
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

    if key == game_key(game, "tournament::RulesKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "tournament", "Tournament")
        else {
            return Ok(());
        };
        let field = o.decode::<Field<MarkerKey, decode::TournamentRules>>()?;
        child_set(
            cypher,
            co_present,
            "Tournament",
            &parent,
            ckpt,
            &[
                format!(
                    "v.entry_fee_mist = {}",
                    q(&field.value.entry_fee_mist.to_string())
                ),
                format!(
                    "v.max_level = {}",
                    field
                        .value
                        .max_level
                        .map(|level| level.to_string())
                        .unwrap_or_else(|| "NULL".into())
                ),
            ],
        );
        return Ok(());
    }

    // ── Character DFs ──
    if character_field(key, game) == Some(CharacterField::Hp) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, decode::Hp>>()?;
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
    if character_field(key, game) == Some(CharacterField::JobXp) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<decode::JobXpKey, u64>>()?;
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
    if character_field(key, game) == Some(CharacterField::SpellBook) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, decode::SpellBook>>()?;
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
    if character_field(key, game) == Some(CharacterField::Folded) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, decode::ItemStatistics>>()?;
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
    if character_field(key, game) == Some(CharacterField::Equipment) {
        let Some((parent, _)) = df_parent(o, outputs, game, "character", "Character") else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, decode::EquipmentMap>>()?;
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
    if character_field(key, game) == Some(CharacterField::CurrentWorld) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, String>>()?;
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
    if character_field(key, game) == Some(CharacterField::Checkpoint) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<decode::CheckpointKey, decode::Checkpoint>>()?;
        let current = current_world_output(outputs, &parent, game)?;
        if current.as_ref().is_some_and(|world| world != &f.name.0) {
            return Ok(());
        }
        let assigns = [
            format!("v.checkpoint_world = {}", q(&f.name.0)),
            format!("v.x = {}", f.value.x),
            format!("v.z = {}", f.value.z),
            format!("v.at_ms = {}", f.value.at_ms),
            format!("v.pet = {}", f.value.pet),
        ];
        // Travel writes CurrentWorld beside the destination checkpoint. That sibling makes the
        // update order-free. A lone checkpoint mutation must match the already-current world.
        if current.is_some() {
            child_set(cypher, co_present, "Character", &parent, ckpt, &assigns);
        } else {
            child_set_in_world(cypher, "Character", &parent, ckpt, &f.name.0, &assigns);
        }
        return Ok(());
    }
    if character_field(key, game) == Some(CharacterField::DungeonRun) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, decode::DungeonRun>>()?;
        let run = json!({
            "dungeon": f.value.dungeon.clone(),
            "room": f.value.room.to_string(),
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
                format!("v.dungeon = {}", q(&f.value.dungeon)),
                format!("v.dungeon_room = {}", f.value.room),
            ],
        );
        return Ok(());
    }
    if character_field(key, game) == Some(CharacterField::Ambush) {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "character", "Character")
        else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, decode::PendingAmbush>>()?;
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
        let f = o.decode::<Field<MarkerKey, decode::RolledStats>>()?;
        child_set(
            cypher,
            co_present,
            "Item",
            &parent,
            ckpt,
            &[
                format!("v.stats = {}", stats_array(&f.value.statistics)),
                format!("v.puits = {}", q(&f.value.puits.to_string())),
            ],
        );
        return Ok(());
    }
    if key == game_key(game, "item::DamagesKey") {
        // the SAME key exists on ceremony templates — the parent check keeps
        // those out (a template is never an Item output).
        let Some((parent, co_present)) = df_parent(o, outputs, game, "item", "Item") else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, Vec<decode::ItemDamages>>>()?;
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
    if key == game_key(game, "pet::FeedKey") {
        let Some((parent, co_present)) = df_parent(o, outputs, game, "item", "Item") else {
            return Ok(());
        };
        let f = o.decode::<Field<MarkerKey, decode::FeedState>>()?;
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

    // ── native kiosk listing DF → LISTED_IN edge ──
    if key == format!("{SUI_FRAMEWORK}::kiosk::Listing") {
        let OwnerKind::Object(kiosk) = o.owner else {
            return Ok(());
        };
        let f = o.decode::<Field<decode::KioskListingKey, u64>>()?;
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
                 CREATE (o)-[:LISTED_IN {{price: {price}, exclusive: {exclusive}, at_ms: {ts}, version: {version}}}]->(k)",
                kiosk = q_id(&kiosk),
                price = q(&f.value.to_string()),
                version = q(&o.version.to_string()),
                exclusive = f.name.is_exclusive,
                ts = view.ts_ms,
            ));
        }
    }
    Ok(())
}

// ╔════════════════ [ Fight — node + machine blob ] ══════════════════════════ ]

fn emit_fight(
    cypher: &mut Vec<String>,
    o: &ObjView<'_>,
    view: &CheckpointView<'_>,
) -> anyhow::Result<()> {
    let f = o.decode::<decode::Fight>()?;
    let before = view
        .inputs
        .iter()
        .find(|input| input.id == o.id)
        .map(|input| input.decode::<decode::Fight>())
        .transpose()?;
    // Placement ends at round 1 and the end is one-way: each clock is the transaction's delta.
    let clocks = [
        (
            "started_ms",
            f.combat.round > 0 && before.as_ref().is_none_or(|b| b.combat.round == 0),
        ),
        (
            "ended_ms",
            f.combat.ended && before.as_ref().is_none_or(|b| !b.combat.ended),
        ),
    ]
    .into_iter()
    .filter(|(_, changed)| *changed)
    .map(|(clock, _)| format!("v.{clock} = {}", view.ts_ms));
    let ckpt = view.ckpt;
    let phase = if f.combat.ended {
        "ended"
    } else if f.combat.round == 0 {
        "placement"
    } else {
        "active"
    };
    let closable = f.combat.ended
        && f.combat
            .fighters
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
            match f.combat.winner {
                Some(team) => format!("v.winner = {team}"),
                None => "v.winner = NULL".to_string(),
            },
            format!("v.access_a = {}", f.access_a),
            format!("v.access_b = {}", f.access_b),
            // A reserved seat names the character it waits for: the invited client reads it
            // off the same marker row a bystander sees.
            match &f.opener_a {
                Some(id) => format!("v.opener_a = {}", q(&id.hex())),
                None => "v.opener_a = NULL".to_string(),
            },
            match &f.opener_b {
                Some(id) => format!("v.opener_b = {}", q(&id.hex())),
                None => "v.opener_b = NULL".to_string(),
            },
            format!("v.managed = {}", f.door_policy & 1 != 0),
            format!("v.wagered = {}", f.door_policy == 31),
            match &f.dungeon {
                Some(tag) => format!("v.dungeon_room = {}", tag.room),
                None => "v.dungeon_room = NULL".to_string(),
            },
            match &f.dungeon {
                Some(tag) => format!("v.dungeon = {}", q(&tag.dungeon)),
                None => "v.dungeon = NULL".to_string(),
            },
            format!("v.drops_rolled = {}", f.drops_rolled),
            format!("v.boss_weight = {}", f.rewards.weight),
            format!(
                "v.kares_reward = {}",
                q(&f.rewards.paid.unwrap_or(0).to_string())
            ),
            format!("v.closable = {closable}"),
            format!("v.turn_ptr = {}", f.combat.turn_pointer),
            format!("v.round = {}", f.combat.round),
            format!("v.turn_seed = {}", q(&f.combat.turn_seed.to_string())),
            format!("v.placement_ms = {}", f.combat.placement_started_ms),
            format!("v.turn_started_ms = {}", f.combat.turn_started_ms),
            format!("v.machine = {}", q_json(&fight_machine(&f))),
        ]
        .into_iter()
        .chain(clocks)
        .collect::<Vec<_>>(),
    );
    cypher.push(format!(
        "MATCH (f:Fight {{id: {}}}) OPTIONAL MATCH (f)-[r:CLOSABLE_FOR]->() DELETE r",
        q_id(&f.id)
    ));
    if closable {
        let closers = f
            .authorities
            .iter()
            .filter_map(|authority| match authority {
                decode::FighterAuthority::Player { owner, .. } => Some(owner.hex()),
                decode::FighterAuthority::Mob => None,
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
    if f.combat.ended {
        for (seat, fighter) in f.combat.fighters.iter().enumerate() {
            let decode::FighterAuthority::Player {
                character, owner, ..
            } = &f.authorities[seat]
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
            let loot_types = if f.combat.winner == Some(fighter.team) {
                json!(f
                    .combat
                    .fighters
                    .iter()
                    .filter(|candidate| candidate.team != fighter.team)
                    .flat_map(|candidate| match &candidate.kind {
                        decode::FighterKind::Mob(snapshot) => snapshot
                            .loot
                            .iter()
                            .map(|row| row.item_type.clone())
                            .collect::<Vec<_>>(),
                        decode::FighterKind::Player => vec![],
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
    let state = &f.combat;
    json!({
        "board": {
            "width": state.board.width,
            "height": state.board.height,
            "shape_mask": strs_u64(&state.board.shape_mask),
            "obstacles": state.board.obstacles,
            "holes": state.board.holes,
            "start_cells_a": state.board.start_cells_a,
            "start_cells_b": state.board.start_cells_b,
        },
        "closed": strs_u64(&state.closed),
        "opener_a": f.opener_a.as_ref().map(Id::hex),
        "opener_b": f.opener_b.as_ref().map(Id::hex),
        "queue": state.queue,
        "turn_slot": state.turn_cast_index,
        "turn_casts": state.turn_casts.iter().map(|c| json!({
            "spell": c.spell,
            "target": c.target.to_string(),
        })).collect::<Vec<_>>(),
        "zones": state.zones.iter().map(board_zone_json).collect::<Vec<_>>(),
        "fighters": state.fighters.iter().zip(&f.authorities)
            .map(|(fighter, authority)| fighter_json(fighter, authority)).collect::<Vec<_>>(),
    })
}

fn fighter_json(fighter: &decode::Fighter, authority: &decode::FighterAuthority) -> Value {
    let kind = match (&fighter.kind, authority) {
        (decode::FighterKind::Player, decode::FighterAuthority::Player { character, owner }) => {
            json!({
                "player": {
                    "character": character.hex(),
                    "owner": owner.hex(),
                    "level": fighter.stats.sheet.level,
                },
            })
        }
        (decode::FighterKind::Mob(m), decode::FighterAuthority::Mob) => json!({
            "mob": {
                "mob_type": m.mob_type,
                "level": m.level,
                "max_hp": fighter.stats.max_hp,
                "ap": fighter.stats.base_ap,
                "mp": fighter.stats.base_mp,
                "agility": fighter.stats.sheet.agility,
                "wisdom": fighter.stats.sheet.wisdom,
                "earth_res": fighter.stats.earth_resistance,
                "fire_res": fighter.stats.fire_resistance,
                "water_res": fighter.stats.water_resistance,
                "air_res": fighter.stats.air_resistance,
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
        _ => panic!("fight authority and combat fighter variants diverged"),
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
    if !o.type_key.is(game, "fight", "Fight") {
        return Ok(());
    }
    let f = o.decode::<decode::Fight>()?;
    for (seat, authority) in f.authorities.iter().enumerate() {
        if let decode::FighterAuthority::Player {
            character, owner, ..
        } = authority
        {
            cypher.push(format!(
                "MATCH (:Fight {{id: {id}}})-[r:FIGHTER {{seat: {seat}}}]->() SET r.team = {team}",
                id = q_id(&f.id),
                team = f.combat.fighters[seat].team,
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
fn trade_phase(phase: &decode::TradePhase) -> &'static str {
    match phase {
        decode::TradePhase::Requested => "requested",
        decode::TradePhase::Negotiating => "negotiating",
        decode::TradePhase::Settling => "settling",
        decode::TradePhase::Cancelled => "cancelled",
    }
}

fn emit_trade(cypher: &mut Vec<String>, o: &ObjView<'_>, ckpt: u64) -> anyhow::Result<()> {
    let t = o.decode::<decode::Trade>()?;
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
            format!("v.a = {}", q(&t.state.initiator.hex())),
            format!("v.b = {}", q(&t.state.invitee.hex())),
            format!("v.phase = {}", q(trade_phase(&t.state.phase))),
            format!("v.offer_revision = {}", t.state.offer_revision),
            format!("v.accept_a = {}", t.state.initiator_accepted),
            format!("v.accept_b = {}", t.state.invitee_accepted),
            format!("v.sui_a = {}", q(&t.sui_a.value.to_string())),
            format!("v.sui_b = {}", q(&t.sui_b.value.to_string())),
            "v.token_a = coalesce(v.token_a, '0')".into(),
            "v.token_b = coalesce(v.token_b, '0')".into(),
            format!("v.caps_a = {}", q(&ids(&t.caps_a))),
            format!("v.caps_b = {}", q(&ids(&t.caps_b))),
        ],
    );
    Ok(())
}

fn emit_party(cypher: &mut Vec<String>, o: &ObjView<'_>, ckpt: u64) -> anyhow::Result<()> {
    let p = o.decode::<decode::Party>()?;
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
    let list = o.decode::<decode::FriendList>()?;
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
        Custody::KioskOwned {
            kiosk,
            owner,
            personal_cap,
        } => {
            cypher.push(format!("MATCH (k:Kiosk {{id: {kiosk}}}) WITH k OPTIONAL MATCH ()-[r:OWNS]->(k) DELETE r WITH DISTINCT k MERGE (u:User {{address: {owner}}}) MERGE (u)-[:OWNS]->(k)", kiosk = q_id(kiosk), owner = q(&owner.hex())));
            if let Some(cap) = personal_cap {
                cypher.push(format!(
                    "MATCH (k:Kiosk {{id: {kiosk}}}) SET k.personal_cap = {cap}",
                    kiosk = q_id(kiosk),
                    cap = q_id(cap)
                ));
            }
        }
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
            // personal cap or marker observations provide its immutable owner.
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
        ("tournament", "Tournament", "Tournament"),
        ("tournament", "KaresPool", "TournamentKaresPool"),
        ("distribution", "Giftcard", "Giftcard"),
        ("loot_box", "BoxClaim", "BoxClaim"),
        ("forgemagie", "CrushClaim", "CrushClaim"),
        ("trade", "Trade", "Trade"),
    ]
    .iter()
    .find(|(module, name, _)| t.is(game, module, name))
    .map(|(_, _, label)| *label);
    if let Some(label) = node {
        cypher.push(format!(
            "MATCH (n:{label} {{id: {id}}}) DETACH DELETE n",
            id = q_id(&gone.id),
        ));
        return Ok(());
    }
    if let Some(key) = t.field_key() {
        // the run DF is the one REMOVABLE game DF (end_run) — its deletion
        // clears the character's run (the pre-state owner IS the character).
        if character_field(key, game) == Some(CharacterField::DungeonRun) {
            if let OwnerKind::Object(character) = gone.owner {
                cypher.push(format!(
                    "MATCH (c:Character {{id: {id}}}) SET c.dungeon_run = NULL, c.dungeon = NULL, \
                     c.dungeon_room = NULL",
                    id = q_id(&character),
                ));
            }
            return Ok(());
        }
        // a deleted listing DF ends the listing (delist or purchase).
        if key == format!("{SUI_FRAMEWORK}::kiosk::Listing") {
            let f = gone.decode::<Field<decode::KioskListingKey, u64>>()?;
            if let OwnerKind::Object(kiosk) = gone.owner {
                for label in ["Item", "Character"] {
                    cypher.push(format!(
                        "MATCH (:{label} {{id: {id}}})-[r:LISTED_IN]->(:Kiosk {{id: {kiosk}}}) WHERE r.exclusive = {exclusive} DELETE r",
                        id = q_id(&f.name.id),
                        kiosk = q_id(&kiosk),
                        exclusive = f.name.is_exclusive,
                    ));
                }
            }
        }
    }
    Ok(())
}
