// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! One-time data conversion before the sole sequential writer starts. Originals expire only after validation.
use std::collections::BTreeMap;

use anyhow::{ensure, Context, Result};
use redis::aio::MultiplexedConnection;
use serde::Deserialize;

use crate::analytics_totals::{self, Totals, SCHEMA, SCHEMA_KEY};

const LEGACY_GRACE_SECS: u64 = 7 * 86_400;
type Converted = BTreeMap<String, (Totals, Option<u64>)>;

fn legacy(key: &str) -> bool {
    key.starts_with("analytics:transactions:")
        || key.starts_with("analytics:gas:")
        || key.starts_with("analytics:money:day:")
}

async fn legacy_keys(conn: &mut MultiplexedConnection) -> Result<Vec<String>> {
    let mut cursor = 0;
    let mut keys = std::collections::BTreeSet::new();
    loop {
        let (next, page): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg("analytics:*")
            .arg("COUNT")
            .arg(1000)
            .query_async(conn)
            .await?;
        keys.extend(page.into_iter().filter(|key| legacy(key)));
        cursor = next;
        if cursor == 0 {
            return Ok(keys.into_iter().collect());
        }
    }
}

#[derive(Deserialize)]
struct Watermark {
    checkpoint_hi_inclusive: u64,
}

#[derive(Deserialize)]
struct Money {
    ts_ms: u64,
    #[serde(with = "analytics_totals::decimal")]
    item_royalty_mist: u128,
    #[serde(with = "analytics_totals::decimal")]
    character_royalty_mist: u128,
    #[serde(default, with = "analytics_totals::decimal")]
    character_creation_mist: u128,
    #[serde(default, with = "analytics_totals::decimal")]
    kolizeum_mist: u128,
}

fn convert_money(
    converted: &mut Converted,
    rows: Vec<(String, String)>,
    checkpoint: u64,
) -> Result<()> {
    for (coordinate, value) in rows {
        let row_checkpoint: u64 = coordinate
            .split(':')
            .next()
            .context("money coordinate missing")?
            .parse()?;
        if row_checkpoint > checkpoint {
            continue;
        }
        let money: Money = serde_json::from_str(&value)?;
        let delta = Totals {
            checkpoint,
            item_royalty_mist: money.item_royalty_mist,
            character_royalty_mist: money.character_royalty_mist,
            character_creation_mist: money.character_creation_mist,
            kolizeum_mist: money.kolizeum_mist,
            ..Totals::default()
        };
        for (key, expiry) in analytics_totals::keys(money.ts_ms) {
            let entry = converted.entry(key).or_insert((
                Totals {
                    checkpoint,
                    ..Totals::default()
                },
                expiry,
            ));
            entry.0 = analytics_totals::combine(&entry.0, &delta)?;
        }
    }
    Ok(())
}

fn convert_counts(
    converted: &mut Converted,
    key: &str,
    rows: Vec<(String, String)>,
    checkpoint: u64,
) -> Result<()> {
    let mut parts = key.splitn(3, ':');
    parts.next();
    let metric = parts.next().context("analytics metric missing")?;
    let suffix = parts.next().context("analytics period missing")?;
    let expiry = if suffix == "all" {
        None
    } else {
        let (tier, bucket) = suffix.split_once(':').context("analytics bucket missing")?;
        let bucket: u64 = bucket.parse()?;
        let (_, expiry) = analytics_totals::keys(bucket)
            .into_iter()
            .find(|(key, _)| key == &format!("analytics:totals:{tier}:{bucket}"))
            .context("invalid analytics tier")?;
        expiry
    };
    let entry = converted
        .entry(format!("analytics:totals:{suffix}"))
        .or_insert((
            Totals {
                checkpoint,
                ..Totals::default()
            },
            expiry,
        ));
    for (row_checkpoint, value) in rows {
        if row_checkpoint.parse::<u64>()? > checkpoint {
            continue;
        }
        match metric {
            "transactions" => {
                entry.0.transactions = entry
                    .0
                    .transactions
                    .checked_add(value.parse()?)
                    .context("transaction migration overflow")?
            }
            "gas" => {
                entry.0.gas_mist = entry
                    .0
                    .gas_mist
                    .checked_add(value.parse()?)
                    .context("gas migration overflow")?
            }
            _ => anyhow::bail!("unknown analytics metric"),
        }
    }
    Ok(())
}

async fn expire_originals(conn: &mut MultiplexedConnection, keys: &[String]) -> Result<()> {
    let mut expiry = redis::pipe();
    for key in keys {
        expiry
            .cmd("EXPIRE")
            .arg(key)
            .arg(LEGACY_GRACE_SECS)
            .arg("LT")
            .ignore();
    }
    if !keys.is_empty() {
        expiry.query_async::<()>(conn).await?;
    }
    Ok(())
}

pub async fn initialize(conn: &mut MultiplexedConnection, fresh: bool) -> Result<()> {
    let schema: Option<String> = redis::cmd("GET").arg(SCHEMA_KEY).query_async(conn).await?;
    let keys = legacy_keys(conn).await?;
    if let Some(schema) = schema {
        ensure!(schema == SCHEMA, "unsupported analytics schema");
        return expire_originals(conn, &keys).await;
    }
    let watermark: Option<String> = redis::cmd("GET")
        .arg("idx:watermark:ares")
        .query_async(conn)
        .await?;
    let checkpoint = match watermark {
        Some(value) => serde_json::from_str::<Watermark>(&value)?.checkpoint_hi_inclusive,
        None => {
            ensure!(
                fresh && keys.is_empty(),
                "legacy analytics require their committed watermark"
            );
            0
        }
    };
    let mut converted = Converted::new();
    for key in &keys {
        // Sources are quiescent: migration runs before pipeline registration, one legacy hash at a time.
        let rows: Vec<(String, String)> = redis::cmd("HGETALL").arg(key).query_async(conn).await?;
        if key.starts_with("analytics:money:") {
            convert_money(&mut converted, rows, checkpoint)?;
        } else {
            convert_counts(&mut converted, key, rows, checkpoint)?;
        }
    }
    for (key, (totals, expiry)) in &converted {
        let value = serde_json::to_string(totals)?;
        let mut write = redis::cmd("SET");
        write.arg(key).arg(&value);
        if let Some(expiry) = expiry {
            write.arg("EXAT").arg(expiry);
        }
        write.query_async::<()>(conn).await?;
        let actual: Option<String> = redis::cmd("GET").arg(key).query_async(conn).await?;
        if let Some(actual) = actual {
            ensure!(actual == value, "analytics migration verification failed");
        } else {
            let (now, _): (u64, u64) = redis::cmd("TIME").query_async(conn).await?;
            ensure!(
                expiry.is_some_and(|expiry| expiry <= now),
                "missing unexpired migrated totals"
            );
        }
    }
    // Until this final marker exists, restarting recomputes absolute values from untouched originals.
    let _: () = redis::cmd("SET")
        .arg(SCHEMA_KEY)
        .arg(SCHEMA)
        .query_async(conn)
        .await?;
    tracing::info!(
        legacy_keys = keys.len(),
        compact_keys = converted.len(),
        checkpoint,
        "numeric analytics ready"
    );
    expire_originals(conn, &keys).await
}

#[cfg(test)]
#[path = "../tests/analytics/migration.rs"]
mod tests;
