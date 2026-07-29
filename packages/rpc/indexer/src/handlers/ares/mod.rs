// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! AresRPG event-projection handler — the game read-model spine.
//!
//! One sequential pipeline (`ares`) that walks every event in a checkpoint,
//! matches it by `(module, name)`, BCS-decodes the body and projects it into the
//! Redis read-model the API's §14 views read (characters, listings, pools, shop,
//! zones, encyclopedia, config, kolizeum). It ingests events from the AresRPG
//! packages (game / items / dungeon / kolizeum / pools / fight) plus native Sui
//! kiosk listing events (`0x2::kiosk`) for the marketplace view. The fight slice
//! projects the Fight object + soulbound FightResults, AND appends each fight
//! board/turn event to its per-fight ORDERED JOURNAL (`journal.rs`, keyed for
//! observer replay — `/v1/fights/{id}/events`; see HANDLERS.md).
//!
//! Read-only and idempotent by construction (see `project.rs`): the whole store
//! is a re-derivable cache of public chain truth.
//!
//! ## Pure decode/project, thin I/O
//! `process` decodes checkpoint events into a batch of [`RedisWrite`]s via the
//! pure [`project::map`]; `commit` replays that batch against Redis. All game
//! logic lives in the pure, unit-tested `project::map` — this file is only the
//! framework glue and the optional package allowlist.

mod decode;
mod journal;
mod model;
mod party;
mod project;
mod snapshot;
mod xp_curve;

#[cfg(test)]
mod history_tests;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;
use sui_indexer_alt_framework::pipeline::{sequential::Handler, Processor};
use sui_indexer_alt_framework::store::Store;
use sui_indexer_alt_framework::types::base_types::ObjectID;
use sui_indexer_alt_framework::types::effects::TransactionEffectsAPI;
use sui_indexer_alt_framework::types::full_checkpoint_content::Checkpoint;
use sui_indexer_alt_framework::types::transaction::{Command, TransactionData, TransactionKind};
use tracing::debug;

use crate::store::RedisStore;
pub use project::RedisWrite;
pub use snapshot::AresSnapshotHandler;

/// Canonical address of the Sui framework (`0x2`) — the origin of native kiosk
/// listing events. Always allowed through the package filter (the marketplace
/// feed is not an AresRPG package).
const KIOSK_MODULE: &str = "kiosk";

/// The royalty rule's `pay` call adds a TransferRequest receipt and mutates the
/// policy balance but emits no event, so its successful PTB command is the
/// transaction-level proof for a receipted zero-price marketplace purchase.
fn has_royalty_receipt(transaction: &TransactionData) -> bool {
    let TransactionKind::ProgrammableTransaction(pt) = &transaction.as_v1().kind else {
        return false;
    };
    pt.commands.iter().any(|command| {
        matches!(command, Command::MoveCall(call) if call.module == "royalty_rule" && call.function == "pay")
    })
}

/// The event and snapshot pipelines advance independently. Stamp the equipment identity mutation's
/// checkpoint/transaction cursor so `/v1` can withhold a mixed row until EquipmentMap reaches the same fact.
fn equipment_cursor_write(
    module: &str,
    name: &str,
    contents: &[u8],
    checkpoint: u64,
    tx_index: usize,
) -> Option<RedisWrite> {
    if module != "extract" || !matches!(name, "ItemEquipped" | "ItemUnequipped") {
        return None;
    }
    let event = decode::decode_bcs::<model::ItemEquip>(module, name, contents)?;
    let character = event.character.to_canonical_string(true);
    Some(project::set(
        project::k_character(&character),
        "$.equipment_cursor",
        json!({ "checkpoint": checkpoint, "tx_index": tx_index }),
    ))
}

/// Projects AresRPG (and native kiosk) events into the Redis read-model.
pub struct AresHandler {
    /// Optional allowlist of AresRPG package addresses (canonical `0x…` hex). When
    /// set, only events emitted by these packages (plus native `0x2::kiosk`) are
    /// indexed — a hardening seam so a look-alike foreign package can never poison
    /// the cache. Unset (the default until packages publish) = match by
    /// `(module, name)` alone.
    packages: Option<HashSet<String>>,
}

impl AresHandler {
    pub fn new(packages: Option<HashSet<String>>) -> Self {
        Self { packages }
    }

    /// Whether an event from `pkg`/`module` is in scope under the allowlist.
    fn admits(&self, pkg: &str, module: &str) -> bool {
        match &self.packages {
            None => true,
            Some(allow) => module == KIOSK_MODULE || allow.contains(pkg),
        }
    }
}

#[async_trait]
impl Processor for AresHandler {
    type Value = RedisWrite;

    const NAME: &'static str = "ares";

    async fn process(&self, checkpoint: &Arc<Checkpoint>) -> Result<Vec<Self::Value>> {
        let mut writes = Vec::new();
        // Chain-derived event ordinal: count EVERY emitted event in checkpoint order,
        // including foreign/deferred events. This is the second component of the SSE
        // Last-Event-ID; it can always be re-derived from the checkpoint and never
        // depends on Redis or on which events this handler happens to admit.
        let mut intra_checkpoint_event_index = 0_u64;
        // The sale "when": no event carries its own timestamp, so the enclosing
        // checkpoint's time stamps every sale row (same for every event in it).
        let ts_ms = checkpoint.summary.timestamp_ms;
        for (tx_index, tx) in checkpoint.transactions.iter().enumerate() {
            let Some(events) = &tx.events else { continue };
            // The per-fight journal's tx context (the tx digest + a fight-object-id → post-tx
            // version map), computed LAZILY on the first journalled event in this tx — most txs
            // emit no fight event, so this stays `None` and costs nothing there.
            let mut journal_ctx: Option<(String, HashMap<ObjectID, u64>)> = None;
            // `extract::extract_locked` identifies its non-trade exit as a
            // same-transaction ItemListed(0) → ItemPurchased(0) pair. Key by
            // kiosk+item so another purchase in the same PTB cannot be suppressed.
            let transient_zero_listings = events
                .data
                .iter()
                .filter_map(|event| {
                    if event.type_.module.as_str() != KIOSK_MODULE
                        || event.type_.name.as_str() != "ItemListed"
                    {
                        return None;
                    }
                    let listed: model::KioskItemListed =
                        decode::decode_bcs(KIOSK_MODULE, "ItemListed", &event.contents)?;
                    (listed.price == 0).then_some((listed.kiosk, listed.id))
                })
                .collect::<HashSet<_>>();
            // An atomic marketplace purchase may itself contain a royalty `pay`
            // call, so correlate the extract terminal by item id as the stronger
            // signal. This also handles buy→equip composition without suppressing
            // the seller-kiosk purchase earlier in the same transaction.
            let confirmed_extract_items = events
                .data
                .iter()
                .filter_map(|event| {
                    match (event.type_.module.as_str(), event.type_.name.as_str()) {
                        ("extract", "ItemEquipped") => {
                            decode::decode_bcs::<model::ItemEquip>("extract", "ItemEquipped", &event.contents)
                                .map(|event| event.item)
                        }
                        ("extract", "ItemBurned") => {
                            decode::decode_bcs::<model::ItemBurned>("extract", "ItemBurned", &event.contents)
                                .map(|event| event.item)
                        }
                        _ => None,
                    }
                })
                .collect::<HashSet<_>>();
            let royalty_receipt = has_royalty_receipt(&tx.transaction);
            for (event_index, event) in events.data.iter().enumerate() {
                let chain_event_index = intra_checkpoint_event_index;
                intra_checkpoint_event_index += 1;
                let module = event.type_.module.as_str();
                let name = event.type_.name.as_str();
                let pkg = event.type_.address.to_canonical_string(/* with_prefix */ true);
                if !self.admits(&pkg, module) {
                    continue;
                }
                let sender = event.sender.to_string();
                let mapped = if module == KIOSK_MODULE && name == "ItemPurchased" {
                    let purchase = decode::decode_bcs::<model::KioskItemListed>(
                        KIOSK_MODULE,
                        "ItemPurchased",
                        &event.contents,
                    )
                        .map(|event| project::KioskPurchaseContext {
                            transient_zero_listing: event.price == 0
                                && transient_zero_listings.contains(&(event.kiosk, event.id)),
                            has_royalty_receipt: royalty_receipt,
                            confirmed_extract_exit: confirmed_extract_items.contains(&event.id),
                        })
                        .unwrap_or_default();
                    project::map_with_context(
                        module,
                        name,
                        &pkg,
                        &sender,
                        ts_ms,
                        &event.contents,
                        purchase,
                    )
                } else {
                    project::map(module, name, &pkg, &sender, ts_ms, &event.contents)
                };
                if let Some(mut w) = mapped {
                    writes.append(&mut w);
                }
                if let Some(w) = equipment_cursor_write(
                    module,
                    name,
                    &event.contents,
                    checkpoint.summary.sequence_number,
                    tx_index,
                ) {
                    writes.push(w);
                }

                // ── per-fight ordered JOURNAL (#216) ──────────────────────────
                // A fight board/turn event ALSO appends to its per-fight ordered
                // journal (`journal.rs`), keyed by `(fight, seq=rank)` for observer
                // replay — additive to the fight-doc projection above, never replacing
                // it. The `(checkpoint, tx_index, event_index)` triple is the total
                // order; the tx digest + the fight object's post-tx version ride each
                // entry (the client correlates its own receipts / snapshot polls by them).
                if let Some((fight_oid, kind, data)) =
                    journal::decode_journal_event(module, name, &event.contents)
                {
                    let (digest, version_of) = journal_ctx.get_or_insert_with(|| {
                        let digest = tx.effects.transaction_digest().base58_encode();
                        let versions = tx
                            .output_objects(&checkpoint.object_set)
                            .map(|obj| (obj.id(), obj.version().value()))
                            .collect::<HashMap<_, _>>();
                        (digest, versions)
                    });
                    // `None` version = a terminal tx that DELETED the Fight (Settled/Swept):
                    // the object is not an output, so there is no post-tx version to carry.
                    let version = version_of.get(&fight_oid).copied();
                    writes.append(&mut journal::journal_writes(
                        &fight_oid.to_canonical_string(true),
                        journal::JournalCursor {
                            checkpoint: checkpoint.summary.sequence_number,
                            intra_checkpoint_event_index: chain_event_index,
                            tx_index,
                            event_index,
                        },
                        kind,
                        data,
                        digest,
                        version,
                    ));
                }
            }
        }
        if !writes.is_empty() {
            debug!(count = writes.len(), checkpoint = checkpoint.summary.sequence_number, "projected ares writes");
        }
        Ok(writes)
    }
}

#[async_trait]
impl Handler for AresHandler {
    type Store = RedisStore;
    type Batch = Vec<RedisWrite>;

    fn batch(&self, batch: &mut Self::Batch, values: std::vec::IntoIter<Self::Value>) {
        batch.extend(values);
    }

    async fn commit<'a>(
        &self,
        batch: &Self::Batch,
        conn: &mut <Self::Store as Store>::Connection<'a>,
    ) -> Result<usize> {
        project::execute(batch, conn.connection()).await?;
        Ok(batch.len())
    }
}
