// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The one pipeline: checkpoint in → ordered write batch out.
//!
//! `process` is the IMPURE-EXTRACTION shell around the pure core: it lifts the
//! framework's checkpoint into plain owned views (objects, deletes, events),
//! then the pure modules decide everything — `ownership::resolve` the custody
//! facts, `publish::analyze` the wire + analytics + sales + market, `graph::project` the
//! Cypher. `commit` executes the list verbatim. Every write is idempotent by
//! construction (README, law 5), so a crash-replay of any batch converges.

use std::sync::Arc;

use anyhow::{ensure, Result};
use async_trait::async_trait;
use sui_indexer_alt_framework::pipeline::{sequential::Handler, Processor};
use sui_indexer_alt_framework::store::Store;
use sui_indexer_alt_framework::types::effects::TransactionEffectsAPI;
use sui_indexer_alt_framework::types::execution_status::ExecutionStatus;
use sui_indexer_alt_framework::types::full_checkpoint_content::Checkpoint;
use sui_indexer_alt_framework::types::object::{Object, Owner};
use sui_indexer_alt_framework::types::transaction::{Command, TransactionData, TransactionKind};
use sui_indexer_alt_framework::types::TypeTag;

use crate::analytics::{self, ActivityFact, CharacterFact, MoneyFact, TransactionFact};
use crate::decode::{Addr, Id};
use crate::graph::{self, CheckpointView};
use crate::ownership::{self, ObjView, OwnerKind, TypeKey};
use crate::publish::{self, EventView, TxView};
use crate::store::FalkorStore;

/// Key holding the latest ingested checkpoint (plain JSON string — no RedisJSON
/// in the FalkorDB image).
pub const LATEST_CHECKPOINT_KEY: &str = "idx:checkpoint:latest";

/// Sales-history retention (README): newest 500 rows per address, 90-day idle TTL.
const SALES_CAP: i64 = 500;
const SALES_TTL_SECS: i64 = 90 * 24 * 60 * 60;

/// One store mutation. `process` renders these; `commit` executes them in order.
#[derive(Debug, Clone)]
pub enum Write {
    /// A Cypher statement against the one graph (`GRAPH.QUERY aresrpg`).
    Graph(String),
    /// A sales-history row (executor applies the cap + idle TTL with it).
    Sale {
        key: String,
        score: u64,
        member: String,
    },
    /// One replay-deduplicated exact-money contribution to both chart tiers.
    Money(MoneyFact),
    /// One successful game-package sender projected into every dashboard activity tier.
    Activity(ActivityFact),
    /// One checkpoint's successful game count plus net gas for every non-deployment game attempt.
    Transaction(TransactionFact),
    /// One replay-safe live-character counter delta.
    Character(CharacterFact),
    /// A live-wire event (`PUBLISH channel payload`).
    Publish { channel: String, payload: String },
    /// A plain bookkeeping key (`SET key value`).
    SetKey { key: String, value: String },
}

/// Everything one checkpoint produced, in execution order.
#[derive(Debug, Clone)]
pub struct CheckpointWrites {
    pub sequence_number: u64,
    pub writes: Vec<Write>,
}

/// The game projection handler.
pub struct AresHandler {
    /// The seed (living-content) package's original id — the SECOND origin:
    /// content events (ContentWritten, template creations) are typed by it.
    seed_original: String,
    /// Original package id — the type origin every game type matches against
    /// (Sui type identity pins to the DEFINING package; one publish = one id).
    package_original: String,
    /// Latest upgrade id, used for lineage validation only.
    /// Invariant: upgrades must not introduce indexed object or event types;
    /// supporting those requires matching every package id that introduced a type.
    #[allow(dead_code)]
    package_latest: String,
    /// Every configured game call target known to this deployment. Original types still
    /// identify objects; activity follows executable package versions.
    game_packages: std::collections::HashSet<String>,
}

impl AresHandler {
    pub fn new(
        package_original: &str,
        package_latest: &str,
        seed_original: &str,
        game_packages: &[String],
    ) -> Result<Self> {
        let package_original = canonical(package_original)?;
        let package_latest = canonical(package_latest)?;
        Ok(Self {
            game_packages: game_packages.iter().cloned().collect(),
            package_original,
            seed_original: canonical(seed_original)?,
            package_latest,
        })
    }
}

/// Normalize a configured id to canonical full-width lowercase `0x…` hex.
pub fn canonical(id: &str) -> Result<String> {
    let hex_part = id
        .strip_prefix("0x")
        .or_else(|| id.strip_prefix("0X"))
        .unwrap_or(id);
    ensure!(
        !hex_part.is_empty()
            && hex_part.len() <= 64
            && hex_part.chars().all(|c| c.is_ascii_hexdigit()),
        "not a hex object id: {id}"
    );
    Ok(format!("0x{:0>64}", hex_part.to_ascii_lowercase()))
}

// ╔════════════════ [ Framework → owned views (stage 1) ] ════════════════════ ]

/// An owned object view — the borrow-free stage every `ObjView` points into.
struct OwnedObj {
    id: Id,
    owner: OwnerKind,
    type_key: TypeKey,
    bytes: Vec<u8>,
}

/// One event, lifted whole. `index` = the intra-checkpoint ordinal.
struct OwnedEvent {
    package: String,
    module: String,
    name: String,
    type_params: Vec<String>,
    bytes: Vec<u8>,
    index: u64,
}

/// One transaction, lifted whole.
struct OwnedTx {
    sender: Addr,
    digest: String,
    successful: bool,
    gas_mist: i64,
    move_calls: Vec<String>,
    events: Vec<OwnedEvent>,
    inputs: Vec<OwnedObj>,
    outputs: Vec<OwnedObj>,
    deleted: Vec<OwnedObj>,
}

fn addr32(bytes: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(bytes);
    out
}

fn owned(obj: &Object) -> Option<OwnedObj> {
    let mv = obj.data.try_as_move()?;
    let TypeTag::Struct(tag) = TypeTag::from(mv.type_().clone()) else {
        return None;
    };
    let owner = match obj.owner() {
        Owner::AddressOwner(a) => OwnerKind::Address(Addr(addr32(a.as_ref()))),
        Owner::ObjectOwner(a) => OwnerKind::Object(Id(addr32(a.as_ref()))),
        Owner::Shared { .. } => OwnerKind::Shared,
        Owner::Immutable => OwnerKind::Immutable,
        // consensus-owned reads as address-owned for custody purposes
        Owner::ConsensusAddressOwner { owner, .. } => {
            OwnerKind::Address(Addr(addr32(owner.as_ref())))
        }
        // ownership kinds the game never uses (consensus Party today): the
        // OBJECT still projects its node — only custody stays silent. Dropping
        // it whole would let the watermark advance past real node updates.
        Owner::Party { .. } => OwnerKind::Other,
    };
    Some(OwnedObj {
        id: Id(addr32(obj.id().as_ref())),
        owner,
        type_key: TypeKey {
            package: tag.address.to_canonical_string(true),
            module: tag.module.to_string(),
            name: tag.name.to_string(),
            type_params: tag
                .type_params
                .iter()
                .map(|tp| tp.to_canonical_string(true))
                .collect(),
        },
        bytes: mv.contents().to_vec(),
    })
}

fn clone_obj(o: &OwnedObj) -> OwnedObj {
    OwnedObj {
        id: o.id,
        owner: o.owner,
        type_key: o.type_key.clone(),
        bytes: o.bytes.clone(),
    }
}

/// Every MoveCall target, canonical `0xpkg::module::function`.
fn move_calls(data: &TransactionData) -> Vec<String> {
    let TransactionKind::ProgrammableTransaction(pt) = &data.as_v1().kind else {
        return vec![];
    };
    pt.commands
        .iter()
        .filter_map(|command| match command {
            Command::MoveCall(call) => Some(format!(
                "{}::{}::{}",
                call.package.to_canonical_string(true),
                call.module,
                call.function
            )),
            _ => None,
        })
        .collect()
}

fn is_game_activity(
    successful: bool,
    calls: &[String],
    game_packages: &std::collections::HashSet<String>,
) -> bool {
    successful && is_game_transaction(calls, game_packages)
}

fn is_game_transaction(
    calls: &[String],
    game_packages: &std::collections::HashSet<String>,
) -> bool {
    let game_calls = calls
        .iter()
        .filter_map(|call| call.split_once("::"))
        .filter(|(package, _)| game_packages.contains(*package))
        .map(|(_, target)| target);
    game_calls
        .clone()
        .any(|target| !is_deployment_only_target(target))
}

pub(crate) fn is_deployment_only_target(target: &str) -> bool {
    matches!(
        target,
        "version::admin_update"
            | "version::admin_freeze"
            | "admin::create_item_display"
            | "admin::create_character_display"
            | "protected_policy::mint_and_share"
            | "listing_rule::add"
            | "lot_rule::add"
            | "naked_rule::add"
            | "world::create"
            | "distribution::new_airdrop"
            | "distribution::new_giftcard"
            | "loot_box::add_loot_reward"
            | "loot_box::clear_loot_table"
            | "mastery::new_offer"
            | "mastery::set_offer"
    )
}

fn game_activity_txs<'a>(
    txs: &'a [OwnedTx],
    game_packages: &'a std::collections::HashSet<String>,
) -> impl Iterator<Item = &'a OwnedTx> {
    txs.iter()
        .filter(|tx| is_game_activity(tx.successful, &tx.move_calls, game_packages))
}

fn game_gas_txs<'a>(
    txs: &'a [OwnedTx],
    game_packages: &'a std::collections::HashSet<String>,
) -> impl Iterator<Item = &'a OwnedTx> {
    txs.iter()
        .filter(|tx| is_game_transaction(&tx.move_calls, game_packages))
}

fn is_character(obj: &OwnedObj, game: &str) -> bool {
    obj.type_key.package == game
        && obj.type_key.module == "character"
        && obj.type_key.name == "Character"
}

fn character_facts(txs: &[OwnedTx], checkpoint: u64, ts_ms: u64, game: &str) -> Vec<CharacterFact> {
    txs.iter()
        .enumerate()
        .flat_map(|(tx_index, tx)| {
            let inputs = tx
                .inputs
                .iter()
                .map(|obj| obj.id)
                .collect::<std::collections::HashSet<_>>();
            let created = tx
                .outputs
                .iter()
                .filter(move |obj| is_character(obj, game) && !inputs.contains(&obj.id))
                .map(|obj| (obj.id, true));
            let deleted = tx
                .deleted
                .iter()
                .filter(|obj| is_character(obj, game))
                .map(|obj| (obj.id, false));
            created
                .chain(deleted)
                .map(move |(character, present)| CharacterFact {
                    coordinate: format!(
                        "{checkpoint}:{tx_index}:{}:{}",
                        character.hex(),
                        u8::from(present)
                    ),
                    delta: if present { 1 } else { -1 },
                    ts_ms,
                })
        })
        .collect()
}

fn lift(checkpoint: &Checkpoint) -> Vec<OwnedTx> {
    let mut event_ordinal = 0u64;
    checkpoint
        .transactions
        .iter()
        .map(|tx| {
            let inputs: Vec<OwnedObj> = tx
                .input_objects(&checkpoint.object_set)
                .filter_map(owned)
                .collect();
            let outputs: Vec<OwnedObj> = tx
                .output_objects(&checkpoint.object_set)
                .filter_map(owned)
                .collect();
            // deleted ids resolve to their PRE-STATE input views (law 2)
            let deleted: Vec<OwnedObj> = tx
                .effects
                .deleted()
                .into_iter()
                .filter_map(|r| {
                    let id = Id(addr32(r.0.as_ref()));
                    inputs.iter().find(|o| o.id == id).map(clone_obj)
                })
                .collect();
            let events = tx
                .events
                .iter()
                .flat_map(|events| &events.data)
                .map(|event| {
                    let row = OwnedEvent {
                        package: event.type_.address.to_canonical_string(true),
                        module: event.type_.module.to_string(),
                        name: event.type_.name.to_string(),
                        type_params: event
                            .type_
                            .type_params
                            .iter()
                            .map(|tp| tp.to_canonical_string(true))
                            .collect(),
                        bytes: event.contents.clone(),
                        index: event_ordinal,
                    };
                    event_ordinal += 1;
                    row
                })
                .collect();
            OwnedTx {
                sender: Addr(addr32(tx.transaction.as_v1().sender.as_ref())),
                digest: tx.transaction.digest().to_string(),
                successful: matches!(tx.effects.status(), ExecutionStatus::Success),
                gas_mist: tx.effects.gas_cost_summary().net_gas_usage(),
                move_calls: move_calls(&tx.transaction),
                events,
                inputs,
                outputs,
                deleted,
            }
        })
        .collect()
}

fn views<'a>(objs: &'a [OwnedObj]) -> Vec<ObjView<'a>> {
    objs.iter()
        .map(|o| ObjView {
            id: o.id,
            owner: o.owner,
            type_key: &o.type_key,
            bytes: &o.bytes,
        })
        .collect()
}

// ╔════════════════ [ The pure core, driven (stage 2) ] ══════════════════════ ]

#[async_trait]
impl Processor for AresHandler {
    type Value = CheckpointWrites;

    const NAME: &'static str = "ares";

    async fn process(&self, checkpoint: &Arc<Checkpoint>) -> Result<Vec<Self::Value>> {
        let summary = &checkpoint.summary;
        let ckpt = summary.sequence_number;
        let ts_ms = summary.timestamp_ms;
        let game = self.package_original.as_str();

        let txs = lift(checkpoint);

        // custody: one checkpoint-wide view, inputs FIRST, outputs LAST
        // (newest wins in the resolver's by-id map)
        let custody_views: Vec<ObjView<'_>> = txs
            .iter()
            .flat_map(|tx| views(&tx.inputs))
            .chain(txs.iter().flat_map(|tx| views(&tx.outputs)))
            .collect();
        let custody = ownership::resolve(&custody_views, game)?;

        // the wire: per-tx event views borrowing the owned stage
        let event_views: Vec<Vec<EventView<'_>>> = txs
            .iter()
            .map(|tx| {
                tx.events
                    .iter()
                    .map(|event| EventView {
                        package: &event.package,
                        module: &event.module,
                        name: &event.name,
                        type_params: &event.type_params,
                        bytes: &event.bytes,
                        index: event.index,
                    })
                    .collect()
            })
            .collect();
        let input_views: Vec<Vec<ObjView<'_>>> = txs.iter().map(|tx| views(&tx.inputs)).collect();
        let output_views: Vec<Vec<ObjView<'_>>> = txs.iter().map(|tx| views(&tx.outputs)).collect();
        let deleted_views: Vec<Vec<ObjView<'_>>> =
            txs.iter().map(|tx| views(&tx.deleted)).collect();
        let tx_views: Vec<TxView<'_>> = txs
            .iter()
            .enumerate()
            .map(|(i, tx)| TxView {
                tx_index: i as u64,
                sender: tx.sender,
                move_calls: &tx.move_calls,
                events: &event_views[i],
                inputs: &input_views[i],
                outputs: &output_views[i],
            })
            .collect();
        let digests = txs.iter().map(|tx| tx.digest.clone()).collect::<Vec<_>>();
        let mut wire = publish::analyze_with_digests(
            ckpt,
            ts_ms,
            &tx_views,
            &digests,
            game,
            self.seed_original.as_str(),
        )?;
        publish::route_character_custody(&mut wire, ckpt, ts_ms, &custody);

        // the graph: flat outputs + deletes, tx order
        let flat_outputs: Vec<ObjView<'_>> = output_views.iter().flatten().cloned().collect();
        let flat_deleted: Vec<ObjView<'_>> = deleted_views.iter().flatten().cloned().collect();
        let cypher = graph::project(
            &CheckpointView {
                ckpt,
                ts_ms,
                outputs: &flat_outputs,
                deleted: &flat_deleted,
                custody: &custody,
                market: &wire.market,
                fight_lifecycle: &wire.fight_lifecycle,
            },
            game,
        )?;

        // assemble — execution order: graph → sales → publish → heartbeat
        let mut writes: Vec<Write> = cypher.into_iter().map(Write::Graph).collect();
        for row in wire.sales {
            writes.push(Write::Sale {
                key: format!("sales:{}", row.address.hex()),
                score: row.ts_ms,
                member: row.member,
            });
        }
        writes.extend(wire.money.into_iter().map(Write::Money));
        let mut transaction_count = 0u64;
        for tx in game_activity_txs(&txs, &self.game_packages) {
            transaction_count += 1;
            writes.push(Write::Activity(ActivityFact {
                address: tx.sender,
                ts_ms,
            }));
        }
        let transaction_gas_mist =
            game_gas_txs(&txs, &self.game_packages).try_fold(0i64, |total, tx| {
                total
                    .checked_add(tx.gas_mist)
                    .ok_or_else(|| anyhow::anyhow!("game gas total overflow at checkpoint {ckpt}"))
            })?;
        if transaction_count > 0 || transaction_gas_mist != 0 {
            writes.push(Write::Transaction(TransactionFact {
                checkpoint: ckpt,
                count: transaction_count,
                gas_mist: transaction_gas_mist,
                ts_ms,
            }));
        }
        writes.extend(
            character_facts(&txs, ckpt, ts_ms, game)
                .into_iter()
                .map(Write::Character),
        );
        for publication in wire.publications {
            writes.push(Write::Publish {
                channel: publication.channel,
                payload: publication.payload,
            });
        }
        writes.push(Write::SetKey {
            key: LATEST_CHECKPOINT_KEY.to_string(),
            value: serde_json::json!({
                "sequence_number": ckpt,
                "epoch": summary.epoch,
                "timestamp_ms": ts_ms,
                "transaction_count": checkpoint.transactions.len(),
            })
            .to_string(),
        });
        Ok(vec![CheckpointWrites {
            sequence_number: ckpt,
            writes,
        }])
    }
}

#[async_trait]
impl Handler for AresHandler {
    type Store = FalkorStore;
    type Batch = Vec<CheckpointWrites>;

    fn batch(&self, batch: &mut Self::Batch, values: std::vec::IntoIter<Self::Value>) {
        batch.extend(values);
    }

    async fn commit<'a>(
        &self,
        batch: &Self::Batch,
        conn: &mut <Self::Store as Store>::Connection<'a>,
    ) -> Result<usize> {
        let mut executed = 0usize;
        for checkpoint in batch {
            for write in &checkpoint.writes {
                match write {
                    Write::Graph(cypher) => {
                        let _: redis::Value = redis::cmd("GRAPH.QUERY")
                            .arg("aresrpg")
                            .arg(cypher)
                            .query_async(conn.connection())
                            .await?;
                    }
                    Write::Sale { key, score, member } => {
                        let _: () = redis::cmd("ZADD")
                            .arg(key)
                            .arg(*score)
                            .arg(member)
                            .query_async(conn.connection())
                            .await?;
                        let _: () = redis::cmd("ZREMRANGEBYRANK")
                            .arg(key)
                            .arg(0)
                            .arg(-(SALES_CAP + 1))
                            .query_async(conn.connection())
                            .await?;
                        let _: () = redis::cmd("EXPIRE")
                            .arg(key)
                            .arg(SALES_TTL_SECS)
                            .query_async(conn.connection())
                            .await?;
                    }
                    Write::Money(fact) => {
                        let bucket = analytics::bucket_day(fact.ts_ms);
                        let key = analytics::series_key("money", "day", bucket);
                        let _: () = redis::cmd("HSET")
                            .arg(&key)
                            .arg(&fact.coordinate)
                            .arg(fact.value())
                            .query_async(conn.connection())
                            .await?;
                    }
                    Write::Activity(fact) => {
                        let address = fact.address.hex();
                        let buckets = analytics::activity_buckets(fact.ts_ms);
                        for (tier, bucket, width, retention) in buckets {
                            let key = analytics::series_key("active", tier, bucket);
                            let _: () = redis::cmd("SADD")
                                .arg(&key)
                                .arg(&address)
                                .query_async(conn.connection())
                                .await?;
                            let keep = if tier == "day" || tier == "week" || tier == "month" {
                                analytics::DAILY_ACTIVITY_RETENTION_MS
                            } else {
                                retention
                            };
                            let _: () = redis::cmd("EXPIREAT")
                                .arg(key)
                                .arg(analytics::expiry_seconds(bucket, width, keep))
                                .query_async(conn.connection())
                                .await?;
                        }
                        let _: () = redis::cmd("ZADD")
                            .arg(analytics::ADDRESS_FIRST_SEEN_KEY)
                            .arg("NX")
                            .arg(fact.ts_ms)
                            .arg(address)
                            .query_async(conn.connection())
                            .await?;
                    }
                    Write::Transaction(fact) => {
                        let _: () = redis::cmd("HSET")
                            .arg(analytics::TRANSACTIONS_ALL_KEY)
                            .arg(fact.checkpoint)
                            .arg(fact.count)
                            .query_async(conn.connection())
                            .await?;
                        let _: () = redis::cmd("HSET")
                            .arg(analytics::GAS_ALL_KEY)
                            .arg(fact.checkpoint)
                            .arg(fact.gas_mist)
                            .query_async(conn.connection())
                            .await?;
                        for (tier, bucket, width, retention) in
                            analytics::activity_buckets(fact.ts_ms)
                        {
                            let key = analytics::series_key("transactions", tier, bucket);
                            let _: () = redis::cmd("HSET")
                                .arg(&key)
                                .arg(fact.checkpoint)
                                .arg(fact.count)
                                .query_async(conn.connection())
                                .await?;
                            let gas_key = analytics::series_key("gas", tier, bucket);
                            let _: () = redis::cmd("HSET")
                                .arg(&gas_key)
                                .arg(fact.checkpoint)
                                .arg(fact.gas_mist)
                                .query_async(conn.connection())
                                .await?;
                            let keep = if tier == "day" || tier == "week" || tier == "month" {
                                analytics::DAILY_ACTIVITY_RETENTION_MS
                            } else {
                                retention
                            };
                            let _: () = redis::cmd("EXPIREAT")
                                .arg(key)
                                .arg(analytics::expiry_seconds(bucket, width, keep))
                                .query_async(conn.connection())
                                .await?;
                            let _: () = redis::cmd("EXPIREAT")
                                .arg(gas_key)
                                .arg(analytics::expiry_seconds(bucket, width, keep))
                                .query_async(conn.connection())
                                .await?;
                        }
                    }
                    Write::Character(fact) => {
                        let bucket = analytics::bucket_day(fact.ts_ms);
                        let key = analytics::series_key("characters", "day", bucket);
                        let _: () = redis::cmd("HSET")
                            .arg(&key)
                            .arg(&fact.coordinate)
                            .arg(fact.value())
                            .query_async(conn.connection())
                            .await?;
                        let _: () = redis::cmd("EXPIREAT")
                            .arg(key)
                            .arg(analytics::expiry_seconds(
                                bucket,
                                analytics::DAY_MS,
                                analytics::DAILY_ACTIVITY_RETENTION_MS,
                            ))
                            .query_async(conn.connection())
                            .await?;
                    }
                    Write::Publish { channel, payload } => {
                        let _: () = redis::cmd("PUBLISH")
                            .arg(channel)
                            .arg(payload)
                            .query_async(conn.connection())
                            .await?;
                    }
                    Write::SetKey { key, value } => {
                        let _: () = redis::cmd("SET")
                            .arg(key)
                            .arg(value)
                            .query_async(conn.connection())
                            .await?;
                    }
                }
                executed += 1;
            }
        }
        if let Some(tip) = batch.last() {
            tracing::debug!(
                checkpoint = tip.sequence_number,
                batched = batch.len(),
                writes = executed,
                "committed checkpoint batch"
            );
        }
        Ok(executed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_normalizes_short_and_mixed_ids() {
        assert_eq!(
            canonical("0x2").unwrap(),
            "0x0000000000000000000000000000000000000000000000000000000000000002"
        );
        let full = format!("0x{}", "ab".repeat(32));
        assert_eq!(canonical(&full.to_uppercase()).unwrap(), full);
        assert!(canonical("not-hex").is_err());
        assert!(canonical(&"f".repeat(65)).is_err());
    }

    #[test]
    fn activity_requires_a_successful_call_into_the_game_lineage() {
        let game = canonical("0xaa").unwrap();
        let old_upgrade = canonical("0xbb").unwrap();
        let packages = std::collections::HashSet::from([game.clone(), old_upgrade.clone()]);
        let game_call = vec![format!("{game}::api::claim_airdrop")];
        let multi_call = vec![
            format!("{game}::kiosk::borrow"),
            format!("{game}::api::claim_airdrop"),
        ];
        let old_call = vec![format!("{old_upgrade}::world::join")];
        let foreign_call = vec![format!("{}::kiosk::purchase", canonical("0x2").unwrap())];
        let deployment_calls = vec![
            format!("{game}::version::admin_update"),
            format!("{game}::version::admin_freeze"),
            format!("{game}::admin::create_item_display"),
            format!("{game}::admin::create_character_display"),
            format!("{game}::protected_policy::mint_and_share"),
            format!("{game}::listing_rule::add"),
            format!("{game}::lot_rule::add"),
            format!("{game}::naked_rule::add"),
            format!("{game}::world::create"),
            format!("{game}::distribution::new_airdrop"),
            format!("{game}::distribution::new_giftcard"),
            format!("{game}::loot_box::add_loot_reward"),
            format!("{game}::loot_box::clear_loot_table"),
        ];
        let mixed_calls = vec![
            format!("{game}::version::admin_update"),
            format!("{game}::api::claim_airdrop"),
        ];
        assert!(is_game_activity(true, &game_call, &packages));
        assert!(is_game_activity(true, &multi_call, &packages));
        assert!(is_game_activity(true, &old_call, &packages));
        assert!(!is_game_activity(false, &game_call, &packages));
        assert!(!is_game_activity(true, &foreign_call, &packages));
        assert!(!is_game_activity(true, &deployment_calls, &packages));
        assert!(!is_game_transaction(&deployment_calls, &packages));
        assert!(is_game_activity(true, &mixed_calls, &packages));
    }

    #[test]
    fn package_content_and_authority_operations_never_count_as_gameplay_or_gas() {
        let game = canonical("0xaa").unwrap();
        let seed = canonical("0xbb").unwrap();
        let control = canonical("0xcc").unwrap();
        let system = canonical("0x2").unwrap();
        let packages = std::collections::HashSet::from([game]);
        let operations = [
            vec![],
            vec![format!("{system}::package::authorize_upgrade")],
            vec![format!("{system}::package::commit_upgrade")],
            vec![format!("{seed}::registry::write_item")],
            vec![format!("{control}::admin::mint_temp_admin_cap")],
        ];
        for calls in operations {
            assert!(!is_game_activity(true, &calls, &packages));
            assert!(!is_game_transaction(&calls, &packages));
        }
    }

    #[test]
    fn a_multi_call_ptb_is_one_game_transaction() {
        let game = canonical("0xaa").unwrap();
        let packages = std::collections::HashSet::from([game.clone()]);
        let tx = |successful: bool, move_calls: Vec<String>| OwnedTx {
            sender: Addr([0; 32]),
            digest: String::new(),
            successful,
            gas_mist: 7,
            move_calls,
            events: vec![],
            inputs: vec![],
            outputs: vec![],
            deleted: vec![],
        };
        let txs = vec![
            tx(
                true,
                vec![
                    format!("{game}::kiosk::borrow"),
                    format!("{game}::api::claim_airdrop"),
                ],
            ),
            tx(false, vec![format!("{game}::api::claim_airdrop")]),
            tx(
                true,
                vec![format!("{}::kiosk::purchase", canonical("0x2").unwrap())],
            ),
        ];

        let activity = game_activity_txs(&txs, &packages).collect::<Vec<_>>();
        assert_eq!(activity.len(), 1);
        assert_eq!(activity.iter().map(|tx| tx.gas_mist).sum::<i64>(), 7);
        assert_eq!(
            game_gas_txs(&txs, &packages)
                .map(|tx| tx.gas_mist)
                .sum::<i64>(),
            14
        );
    }

    #[test]
    fn character_totals_count_birth_and_deletion_but_not_custody_moves() {
        let game = canonical("0xaa").unwrap();
        let character = |byte: u8| OwnedObj {
            id: Id([byte; 32]),
            owner: OwnerKind::Shared,
            type_key: TypeKey {
                package: game.clone(),
                module: "character".to_string(),
                name: "Character".to_string(),
                type_params: vec![],
            },
            bytes: vec![],
        };
        let tx = |inputs: Vec<OwnedObj>, outputs: Vec<OwnedObj>, deleted: Vec<OwnedObj>| OwnedTx {
            sender: Addr([0; 32]),
            digest: String::new(),
            successful: true,
            gas_mist: 0,
            move_calls: vec![],
            events: vec![],
            inputs,
            outputs,
            deleted,
        };
        let moved = character(2);
        let deleted = character(3);
        let facts = character_facts(
            &[
                tx(vec![], vec![character(1)], vec![]),
                tx(vec![clone_obj(&moved)], vec![moved], vec![]),
                tx(vec![clone_obj(&deleted)], vec![], vec![deleted]),
            ],
            9,
            10,
            &game,
        );
        assert_eq!(facts.len(), 2);
        assert_eq!(facts[0].delta, 1);
        assert_eq!(facts[1].delta, -1);
    }
}
