// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The one pipeline: checkpoint in → ordered write batch out.
//!
//! `process` is the IMPURE-EXTRACTION shell around the pure core: it lifts the
//! framework's checkpoint into plain owned views (objects, deletes, events),
//! then the pure modules decide everything — `ownership::resolve` the custody
//! facts, `publish::analyze` the wire + sales + market, `graph::project` the
//! Cypher. `commit` executes the list verbatim. Every write is idempotent by
//! construction (README, law 5), so a crash-replay of any batch converges.

use std::sync::Arc;

use anyhow::{ensure, Result};
use async_trait::async_trait;
use sui_indexer_alt_framework::pipeline::{sequential::Handler, Processor};
use sui_indexer_alt_framework::store::Store;
use sui_indexer_alt_framework::types::effects::TransactionEffectsAPI;
use sui_indexer_alt_framework::types::full_checkpoint_content::Checkpoint;
use sui_indexer_alt_framework::types::object::{Object, Owner};
use sui_indexer_alt_framework::types::transaction::{Command, TransactionData, TransactionKind};
use sui_indexer_alt_framework::types::TypeTag;

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
    /// Original package id — the type origin every game type matches against
    /// (Sui type identity pins to the DEFINING package; one publish = one id).
    package_original: String,
    /// Latest upgrade id — new types introduced by upgrades resolve to it.
    /// Carried for the upgrade day; until then it equals the original.
    #[allow(dead_code)]
    package_latest: String,
}

impl AresHandler {
    pub fn new(package_original: &str, package_latest: &str) -> Result<Self> {
        Ok(Self {
            package_original: canonical(package_original)?,
            package_latest: canonical(package_latest)?,
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
        let wire = publish::analyze(ckpt, ts_ms, &tx_views, game)?;

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
}
