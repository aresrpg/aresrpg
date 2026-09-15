// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Exact daily public-sale totals. Each value owns its checkpoint, so partial batch retries skip applied rows.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};

use crate::analytics::DAY_MS;

pub const START_KEY: &str = "market:prices:first_timestamp";
pub const RETENTION_DAYS: u64 = 365;

#[derive(Debug, Clone, PartialEq)]
pub struct Sale {
    pub item_type: String,
    pub mist: u64,
    pub units: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Totals {
    // Strings preserve u128 exactly across Redis JSON and JavaScript consumers.
    total_mist: String,
    units: String,
    sales: String,
    checkpoint: u64,
}

fn add(previous: Option<&str>, checkpoint: u64, sales: &[&Sale]) -> Result<Totals> {
    let previous: Totals = previous
        .map(serde_json::from_str)
        .transpose()?
        .unwrap_or(Totals {
            total_mist: "0".into(),
            units: "0".into(),
            sales: "0".into(),
            checkpoint: 0,
        });
    if previous.checkpoint >= checkpoint {
        return Ok(previous);
    }
    let mut mist = previous.total_mist.parse::<u128>()?;
    let mut units = previous.units.parse::<u128>()?;
    let mut count = previous.sales.parse::<u128>()?;
    for sale in sales {
        anyhow::ensure!(sale.mist > 0 && sale.units > 0, "invalid sale totals");
        mist = mist
            .checked_add(sale.mist.into())
            .context("market price overflow")?;
        units = units
            .checked_add(sale.units.into())
            .context("market units overflow")?;
        count = count.checked_add(1).context("market sales overflow")?;
    }
    Ok(Totals {
        total_mist: mist.to_string(),
        units: units.to_string(),
        sales: count.to_string(),
        checkpoint,
    })
}

pub async fn commit(
    conn: &mut MultiplexedConnection,
    checkpoint: u64,
    ts_ms: u64,
    sales: &[Sale],
) -> Result<()> {
    // Starts at the existing indexer's next checkpoint. Never resets its ingestion cursor.
    let _: () = redis::cmd("SETNX")
        .arg(START_KEY)
        .arg(ts_ms)
        .query_async(conn)
        .await?;
    if sales.is_empty() {
        return Ok(());
    }
    let key = format!("market:prices:day:{}", ts_ms / DAY_MS);
    let mut groups: BTreeMap<&str, Vec<&Sale>> = BTreeMap::new();
    for sale in sales {
        groups.entry(&sale.item_type).or_default().push(sale);
    }
    let fields: Vec<_> = groups.keys().copied().collect();
    let previous: Vec<Option<String>> = redis::cmd("HMGET")
        .arg(&key)
        .arg(&fields)
        .query_async(conn)
        .await?;
    let mut writes = redis::pipe();
    writes.atomic();
    for ((item_type, sales), previous) in groups.into_iter().zip(previous) {
        let next = add(previous.as_deref(), checkpoint, &sales)?;
        // Checkpoint and totals share ONE atomic field replacement. A lost acknowledgement
        // cannot add twice; a later retry reads the checkpoint in the already-written value.
        writes
            .cmd("HSET")
            .arg(&key)
            .arg(item_type)
            .arg(serde_json::to_string(&next)?)
            .ignore();
    }
    writes
        .cmd("EXPIREAT")
        .arg(&key)
        .arg((ts_ms / DAY_MS + RETENTION_DAYS + 1) * DAY_MS / 1000)
        .ignore();
    writes.query_async::<()>(conn).await?;
    Ok(())
}

#[cfg(test)]
#[path = "../tests/market_prices/store.rs"]
mod tests;
