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

use crate::analytics::{self, ActivityFact, CharacterFact};
use crate::decode::{Addr, Id};
use crate::graph::{self, CheckpointView};
use crate::ownership::{self, ObjView, OwnerKind, TypeKey};
use crate::publish::{self, EventView, TxView};
use crate::store::FalkorStore;
use crate::{leaderboard_store, leaderboards};

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
    Leaderboard {
        checkpoint: u64,
        ts_ms: u64,
        facts: Vec<leaderboards::Contribution>,
    },
    /// A sales-history row (executor applies the cap + idle TTL with it).
    Sale {
        key: String,
        score: u64,
        member: String,
    },
    /// One complete checkpoint contribution to fixed-size numeric analytics.
    Numeric {
        ts_ms: u64,
        totals: crate::analytics_totals::Totals,
    },
    /// Exact per-item daily totals, with replay identity stored in each bucket value.
    MarketPrices {
        ts_ms: u64,
        checkpoint: u64,
        sales: Vec<crate::market_prices::Sale>,
    },
    /// Absolute checkpoint subtotal: replay overwrites instead of incrementing volume twice.
    MarketVolume {
        ts_ms: u64,
        checkpoint: u64,
        mist: u128,
    },
    /// One successful game-package sender projected into every dashboard activity tier.
    Activity(ActivityFact),
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
    /// Canonical lineage identity used by the projection. New types may originate in any
    /// certified upgrade; raw defining IDs are normalized at checkpoint extraction.
    package_original: String,
    /// Every certified version is both an activity target and a possible defining type origin.
    game_packages: std::collections::HashSet<String>,
}

impl AresHandler {
    pub fn new(
        package_original: &str,
        package_latest: &str,
        game_packages: &[String],
    ) -> Result<Self> {
        let package_original = canonical(package_original)?;
        let package_latest = canonical(package_latest)?;
        let game_packages: std::collections::HashSet<String> = game_packages
            .iter()
            .map(|id| canonical(id))
            .collect::<Result<_>>()?;
        ensure!(
            game_packages.contains(&package_original) && game_packages.contains(&package_latest),
            "game lineage is missing a configured package"
        );
        Ok(Self {
            game_packages,
            package_original,
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
#[derive(Debug, Clone)]
pub struct OwnedObj {
    pub id: Id,
    pub version: u64,
    pub owner: OwnerKind,
    pub type_key: TypeKey,
    pub bytes: Vec<u8>,
}

/// One event, lifted whole. `index` = the intra-checkpoint ordinal.
#[derive(Debug, Clone)]
pub struct OwnedEvent {
    pub package: String,
    pub module: String,
    pub name: String,
    pub type_params: Vec<String>,
    pub bytes: Vec<u8>,
    pub index: u64,
}

/// One transaction, lifted whole.
#[derive(Debug, Clone)]
pub struct OwnedTx {
    pub lamport_version: u64,
    pub sender: Addr,
    pub digest: String,
    pub successful: bool,
    pub gas_mist: i64,
    pub move_calls: Vec<String>,
    pub events: Vec<OwnedEvent>,
    pub inputs: Vec<OwnedObj>,
    pub outputs: Vec<OwnedObj>,
    /// Certified deletions, as their pre-state input views.
    pub deleted: Vec<OwnedObj>,
}

fn addr32(bytes: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(bytes);
    out
}

/// A type keeps its defining ID on-chain. Projection identity follows only certified game
/// versions, recursively including keys and values embedded in framework dynamic fields.
pub(crate) fn game_type(
    mut tag: TypeTag,
    original: &str,
    versions: &std::collections::HashSet<String>,
) -> TypeTag {
    match &mut tag {
        TypeTag::Struct(tag) => {
            if versions.contains(&tag.address.to_canonical_string(true)) {
                tag.address = original.parse().expect("validated canonical game package");
            }
            for parameter in &mut tag.type_params {
                *parameter = game_type(parameter.clone(), original, versions);
            }
        }
        TypeTag::Vector(inner) => **inner = game_type((**inner).clone(), original, versions),
        _ => {}
    }
    tag
}

fn owned(
    obj: &Object,
    game: &str,
    versions: &std::collections::HashSet<String>,
) -> Option<OwnedObj> {
    let mv = obj.data.try_as_move()?;
    let TypeTag::Struct(tag) = game_type(TypeTag::from(mv.type_().clone()), game, versions) else {
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
        version: obj.version().value(),
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

/// The `module::function` of a call into a certified game version; `None` for any other
/// package, however its module and function are named.
pub(crate) fn game_target<'a>(
    call: &'a str,
    game_packages: &std::collections::HashSet<String>,
) -> Option<&'a str> {
    let (package, target) = call.split_once("::")?;
    game_packages.contains(package).then_some(target)
}

/// A call into any certified game version, excluding deployment-only doors.
fn is_game_transaction(
    calls: &[String],
    game_packages: &std::collections::HashSet<String>,
) -> bool {
    calls
        .iter()
        .filter_map(|call| game_target(call, game_packages))
        .any(|target| !is_deployment_only_target(target))
}

pub(crate) fn is_deployment_only_target(target: &str) -> bool {
    matches!(
        target,
        "version::admin_update"
            | "version::admin_freeze"
            | "protected_policy::mint_and_share"
            | "listing_rule::add"
            | "lot_rule::add"
            | "naked_rule::add"
            | "world::create"
            | "distribution::new_giftcard"
            | "loot_box::add_loot_reward"
            | "loot_box::clear_loot_table"
            | "mastery::new_offer"
            | "mastery::set_offer"
            | "mastery::set_enabled"
    )
}

/// Successful game senders, and the gas of every game transaction (a failed one pays too).
fn game_activity(
    txs: &[OwnedTx],
    game_packages: &std::collections::HashSet<String>,
) -> Option<(Vec<Addr>, i64)> {
    let game_txs = txs
        .iter()
        .filter(|tx| is_game_transaction(&tx.move_calls, game_packages));
    let senders = game_txs
        .clone()
        .filter(|tx| tx.successful)
        .map(|tx| tx.sender)
        .collect();
    let gas = game_txs
        .map(|tx| tx.gas_mist)
        .try_fold(0i64, i64::checked_add)?;
    Some((senders, gas))
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
                .filter(move |obj| {
                    obj.type_key.is(game, "character", "Character") && !inputs.contains(&obj.id)
                })
                .map(|obj| (obj.id, true));
            let deleted = tx
                .deleted
                .iter()
                .filter(|obj| obj.type_key.is(game, "character", "Character"))
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

fn lift(
    checkpoint: &Checkpoint,
    game: &str,
    versions: &std::collections::HashSet<String>,
) -> Vec<OwnedTx> {
    let mut event_ordinal = 0u64;
    checkpoint
        .transactions
        .iter()
        .map(|tx| {
            let inputs: Vec<OwnedObj> = tx
                .input_objects(&checkpoint.object_set)
                .filter_map(|object| owned(object, game, versions))
                .collect();
            let outputs: Vec<OwnedObj> = tx
                .output_objects(&checkpoint.object_set)
                .filter_map(|object| owned(object, game, versions))
                .collect();
            // deleted ids resolve to their PRE-STATE input views (law 2)
            let deleted: Vec<OwnedObj> = tx
                .effects
                .deleted()
                .into_iter()
                .filter_map(|r| {
                    let id = Id(addr32(r.0.as_ref()));
                    inputs.iter().find(|o| o.id == id).cloned()
                })
                .collect();
            let events = tx
                .events
                .iter()
                .flat_map(|events| &events.data)
                .map(|event| {
                    let TypeTag::Struct(tag) = game_type(
                        TypeTag::Struct(Box::new(event.type_.clone())),
                        game,
                        versions,
                    ) else {
                        unreachable!("event tags are structs")
                    };
                    let row = OwnedEvent {
                        package: tag.address.to_canonical_string(true),
                        module: tag.module.to_string(),
                        name: tag.name.to_string(),
                        type_params: tag
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
                lamport_version: tx.effects.lamport_version().value(),
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
            version: o.version,
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
        let txs = lift(checkpoint, &self.package_original, &self.game_packages);
        Ok(vec![CheckpointWrites {
            sequence_number: summary.sequence_number,
            writes: self.writes(
                summary.sequence_number,
                summary.epoch,
                summary.timestamp_ms,
                &txs,
            )?,
        }])
    }
}

impl AresHandler {
    /// The pure core: one lifted checkpoint in, its ordered write list out.
    pub fn writes(&self, ckpt: u64, epoch: u64, ts_ms: u64, txs: &[OwnedTx]) -> Result<Vec<Write>> {
        let game = self.package_original.as_str();
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
                deleted: &deleted_views[i],
                tx_index: i as u64,
                digest: &tx.digest,
                sender: tx.sender,
                move_calls: &tx.move_calls,
                events: &event_views[i],
                inputs: &input_views[i],
                outputs: &output_views[i],
            })
            .collect();
        let mut wire = publish::analyze(ckpt, ts_ms, &tx_views, game, &self.game_packages)?;
        // A transaction's outputs are its final state, while inputs only resolve unchanged
        // parents. Retired wrappers must never reassert pre-transaction custody.
        let mut cypher = vec![];
        for (i, tx) in tx_views.iter().enumerate() {
            let final_views: Vec<_> = tx
                .inputs
                .iter()
                .chain(tx.outputs)
                .filter(|object| {
                    !deleted_views[i].iter().any(|gone| gone.id == object.id)
                        || tx.outputs.iter().any(|output| output.id == object.id)
                })
                .cloned()
                .collect();
            crate::character_deletions::route(&mut wire, tx, game);
            let custody = ownership::resolve(&final_views, game)?;
            publish::route_character_custody(&mut wire, &custody);
            cypher.extend(graph::project(
                &CheckpointView {
                    lamport_version: txs[i].lamport_version,
                    ckpt,
                    ts_ms,
                    inputs: tx.inputs,
                    outputs: tx.outputs,
                    deleted: &deleted_views[i],
                    custody: &custody,
                },
                game,
            )?);
            cypher.extend(crate::trade_tokens::project(tx, game, ckpt)?);
        }

        let mut notifications = std::mem::take(&mut wire.notifications);
        for tx in &tx_views {
            notifications.extend(crate::notification_events::extract(ckpt, ts_ms, tx, game)?);
        }
        let mut leaderboard_facts = wire.leaderboard;
        for tx in &tx_views {
            leaderboard_facts.extend(leaderboards::extract(tx, game)?);
        }

        // assemble — execution order: graph → sales → publish → heartbeat
        let mut writes: Vec<Write> = cypher.into_iter().map(Write::Graph).collect();
        for row in wire.sales {
            writes.push(Write::Sale {
                key: format!("sales:{}", row.address.hex()),
                score: row.ts_ms,
                member: row.member,
            });
        }

        writes.push(Write::MarketPrices {
            ts_ms,
            checkpoint: ckpt,
            sales: wire.market_prices,
        });
        writes.push(Write::MarketVolume {
            ts_ms,
            checkpoint: ckpt,
            mist: wire.market_volume_mist,
        });
        let (senders, transaction_gas_mist) = game_activity(txs, &self.game_packages)
            .ok_or_else(|| anyhow::anyhow!("game gas total overflow at checkpoint {ckpt}"))?;
        let transaction_count = senders.len() as u64;
        writes.extend(
            senders
                .into_iter()
                .map(|address| Write::Activity(ActivityFact { address, ts_ms })),
        );
        if transaction_count > 0 || transaction_gas_mist != 0 || !wire.money.is_empty() {
            writes.push(Write::Numeric {
                ts_ms,
                totals: crate::analytics_totals::checkpoint_totals(
                    ckpt,
                    transaction_count,
                    transaction_gas_mist,
                    &wire.money,
                )?,
            });
        }
        writes.extend(
            character_facts(txs, ckpt, ts_ms, game)
                .into_iter()
                .map(Write::Character),
        );
        writes.push(Write::Leaderboard {
            checkpoint: ckpt,
            ts_ms,
            facts: leaderboard_facts,
        });
        for publication in wire.publications {
            writes.push(Write::Publish {
                channel: publication.channel,
                payload: publication.payload,
            });
        }
        writes.extend(
            notifications
                .into_iter()
                .map(|notification| Write::Publish {
                    channel: format!("evt:notifications:{game}"),
                    payload: notification.to_string(),
                }),
        );
        writes.push(Write::SetKey {
            key: LATEST_CHECKPOINT_KEY.to_string(),
            value: serde_json::json!({
                "sequence_number": ckpt,
                "epoch": epoch,
            })
            .to_string(),
        });
        Ok(writes)
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
                    Write::Leaderboard {
                        checkpoint,
                        ts_ms,
                        facts,
                    } => {
                        leaderboard_store::commit(conn.connection(), *checkpoint, *ts_ms, facts)
                            .await?;
                    }
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
                    Write::Numeric { ts_ms, totals } => {
                        crate::analytics_totals::commit(conn.connection(), *ts_ms, totals).await?;
                    }
                    Write::MarketPrices {
                        ts_ms,
                        checkpoint,
                        sales,
                    } => {
                        crate::market_prices::commit(conn.connection(), *checkpoint, *ts_ms, sales)
                            .await?;
                    }
                    Write::MarketVolume {
                        ts_ms,
                        checkpoint,
                        mist,
                    } => {
                        crate::market_volume::commands(*checkpoint, *ts_ms, *mist)
                            .query_async::<()>(conn.connection())
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
                            let _: () = redis::cmd("EXPIREAT")
                                .arg(key)
                                .arg(analytics::expiry_seconds(bucket, width, retention))
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
                                analytics::LONG_RETENTION_MS,
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
