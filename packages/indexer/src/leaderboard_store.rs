// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Exact rankings in the existing private Redis. One sequential writer, replay-safe absolutes.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result};
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};

use crate::analytics::{bucket_month, DAY_MS};
use crate::leaderboards::{Contribution, Metric, CHANNEL, META_KEY};

const PENDING_KEY: &str = "leaderboards:pending";
const DUNGEONS_KEY: &str = "leaderboards:dungeons";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Meta {
    #[serde(default)]
    pub reset_at_ms: u64,
    #[serde(default)]
    pub timestamp_ms: u64,
    pub checkpoint: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Update {
    key: String,
    address: String,
    previous: String,
    total: String,
}

/// A bounded write-ahead batch retains absolute replacements until Redis confirms them.
/// EXEC errors do not roll back Redis commands; retaining this batch makes that path replayable too.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Prepared {
    meta: Meta,
    updates: Vec<Update>,
    #[serde(default)]
    removals: Vec<String>,
    dungeons: Vec<String>,
    changed: bool,
}

pub fn rank_member(total: u128, address: &str) -> String {
    // Ascending lexicographic rank: largest exact total first, then normalized address.
    format!("{:039}:{address}", u128::MAX - total)
}

pub fn next_reset(ts_ms: u64) -> Result<u64> {
    // The 32nd day after a month's start is always in the following calendar month.
    let next_month = bucket_month(ts_ms)
        .checked_add(32 * DAY_MS)
        .context("leaderboard month overflow")?;
    Ok(bucket_month(next_month))
}

async fn ranking_keys(conn: &mut MultiplexedConnection) -> Result<Vec<String>> {
    let mut cursor = 0u64;
    let mut keys = BTreeSet::new();
    loop {
        let (next, page): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg("leaderboards:*")
            .arg("COUNT")
            .arg(1000)
            .query_async(conn)
            .await?;
        keys.extend(
            page.into_iter()
                .filter(|key| key.ends_with(":rank") || key.ends_with(":totals")),
        );
        cursor = next;
        if cursor == 0 {
            break;
        }
    }
    Ok(keys.into_iter().collect())
}

type Totals = BTreeMap<(Metric, String), u128>;

fn aggregate(facts: &[Contribution], credited: &BTreeSet<String>) -> Result<(Totals, Vec<String>)> {
    let mut totals = Totals::new();
    let mut dungeons = BTreeSet::new();
    for fact in facts.iter().filter(|fact| fact.amount > 0) {
        let address = fact.address.hex();
        if let Some(fight) = fact.dungeon_fight {
            let key = format!("{}:{address}", fight.hex());
            if credited.contains(&key) || !dungeons.insert(key) {
                continue;
            }
        }
        let total = totals.entry((fact.metric, address)).or_default();
        *total = total
            .checked_add(fact.amount as u128)
            .context("leaderboard contribution overflow")?;
    }
    Ok((totals, dungeons.into_iter().collect()))
}

async fn read_json<T: serde::de::DeserializeOwned>(
    conn: &mut MultiplexedConnection,
    key: &str,
) -> Result<Option<T>> {
    let value: Option<String> = redis::cmd("GET").arg(key).query_async(conn).await?;
    value
        .map(|value| serde_json::from_str(&value).context("invalid leaderboard projection"))
        .transpose()
}

async fn prepare(
    conn: &mut MultiplexedConnection,
    meta: Meta,
    facts: &[Contribution],
    rolled: bool,
) -> Result<Prepared> {
    let candidates: Vec<String> = facts
        .iter()
        .filter_map(|fact| {
            fact.dungeon_fight
                .map(|fight| format!("{}:{}", fight.hex(), fact.address.hex()))
        })
        .collect();
    let mut credited = BTreeSet::new();
    if !candidates.is_empty() {
        let present: Vec<bool> = redis::cmd("SMISMEMBER")
            .arg(DUNGEONS_KEY)
            .arg(&candidates)
            .query_async(conn)
            .await?;
        credited.extend(
            candidates
                .into_iter()
                .zip(present)
                .filter_map(|(key, present)| present.then_some(key)),
        );
    }
    let (totals, dungeons) = aggregate(facts, &credited)?;
    let removals = if rolled {
        ranking_keys(conn).await?
    } else {
        vec![]
    };
    let mut reads = redis::pipe();
    let keys: Vec<_> = totals
        .into_iter()
        .map(|((metric, address), amount)| {
            let key = format!("leaderboards:{}", metric.key());
            reads.cmd("HGET").arg(format!("{key}:totals")).arg(&address);
            (key, address, amount)
        })
        .collect();
    let previous: Vec<Option<String>> = if rolled || keys.is_empty() {
        vec![None; keys.len()]
    } else {
        reads.query_async(conn).await?
    };
    let mut updates = Vec::new();
    for ((key, address, amount), previous) in keys.into_iter().zip(previous) {
        let previous = previous.unwrap_or_else(|| "0".to_string());
        let total = previous
            .parse::<u128>()?
            .checked_add(amount)
            .context("leaderboard total overflow")?;
        updates.push(Update {
            key,
            address,
            previous,
            total: total.to_string(),
        });
    }
    let changed = rolled || !updates.is_empty();
    Ok(Prepared {
        meta,
        updates,
        removals,
        dungeons,
        changed,
    })
}

async fn apply(conn: &mut MultiplexedConnection, prepared: &Prepared) -> Result<()> {
    let mut writes = redis::pipe();
    writes.atomic();
    if !prepared.removals.is_empty() {
        writes.cmd("UNLINK").arg(&prepared.removals).ignore();
    }
    for update in &prepared.updates {
        let rank_key = format!("{}:rank", update.key);
        writes
            .cmd("HSET")
            .arg(format!("{}:totals", update.key))
            .arg(&update.address)
            .arg(&update.total)
            .ignore();
        writes
            .cmd("ZREM")
            .arg(&rank_key)
            .arg(rank_member(update.previous.parse()?, &update.address))
            .ignore();
        writes
            .cmd("ZADD")
            .arg(rank_key)
            .arg(0)
            .arg(rank_member(update.total.parse()?, &update.address))
            .ignore();
    }
    if !prepared.dungeons.is_empty() {
        writes
            .cmd("SADD")
            .arg(DUNGEONS_KEY)
            .arg(&prepared.dungeons)
            .ignore();
    }
    if !prepared.removals.is_empty()
        || !prepared.updates.is_empty()
        || !prepared.dungeons.is_empty()
    {
        let _: () = writes.query_async(conn).await?;
    }
    // Only acknowledged data may advance the marker. A lost response leaves the absolute
    // pending batch intact; reapplying it cannot increment a total or duplicate a rank member.
    let _: () = redis::cmd("SET")
        .arg(META_KEY)
        .arg(serde_json::to_string(&prepared.meta)?)
        .query_async(conn)
        .await?;
    let _: () = redis::cmd("DEL").arg(PENDING_KEY).query_async(conn).await?;
    Ok(())
}

pub async fn commit(
    conn: &mut MultiplexedConnection,
    checkpoint: u64,
    ts_ms: u64,
    facts: &[Contribution],
) -> Result<()> {
    let mut changed = false;
    if let Some(pending) = read_json::<Prepared>(conn, PENDING_KEY).await? {
        apply(conn, &pending).await?;
        changed = pending.changed;
    }
    let previous = read_json::<Meta>(conn, META_KEY).await?;
    if previous
        .as_ref()
        .is_none_or(|meta| checkpoint > meta.checkpoint)
    {
        let reset_at_ms = next_reset(ts_ms)?;
        let rolled = previous
            .as_ref()
            .is_none_or(|meta| meta.reset_at_ms != reset_at_ms);
        let prepared = prepare(
            conn,
            Meta {
                reset_at_ms,
                timestamp_ms: ts_ms,
                checkpoint,
            },
            facts,
            rolled,
        )
        .await?;
        let _: () = redis::cmd("SET")
            .arg(PENDING_KEY)
            .arg(serde_json::to_string(&prepared)?)
            .query_async(conn)
            .await?;
        apply(conn, &prepared).await?;
        changed |= prepared.changed;
    }
    // A replay may have lost the original publication after its commit. Publishing again is
    // harmless: consumers re-read a versioned snapshot. No score depends on notification delivery.
    if changed || !facts.is_empty() {
        let _: () = redis::cmd("PUBLISH")
            .arg(CHANNEL)
            .arg(
                serde_json::json!({
                    "ckpt": checkpoint, "tx": 0, "evt": 0, "ts_ms": ts_ms,
                    "type": "LeaderboardsChanged", "data": {},
                })
                .to_string(),
            )
            .query_async(conn)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/leaderboards/store.rs"]
mod tests;
