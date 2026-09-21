// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Fixed-size numeric accumulators. One sequential checkpoint writer; each value owns its replay marker.
use anyhow::{Context, Result};
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};

use crate::analytics::{self, MoneyFact};

pub const SCHEMA_KEY: &str = "idx:analytics_schema";
pub const SCHEMA: &str = "compact-v1";
pub const ALL_KEY: &str = "analytics:totals:all";

pub(super) mod decimal {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::{fmt::Display, str::FromStr};
    pub fn serialize<T: Display, S: Serializer>(
        value: &T,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, T: FromStr, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<T, D::Error>
    where
        T::Err: Display,
    {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Totals {
    pub checkpoint: u64,
    #[serde(with = "decimal")]
    pub transactions: u128,
    #[serde(with = "decimal")]
    pub gas_mist: i128,
    #[serde(with = "decimal")]
    pub item_royalty_mist: u128,
    #[serde(with = "decimal")]
    pub character_royalty_mist: u128,
    #[serde(with = "decimal")]
    pub character_creation_mist: u128,
    #[serde(with = "decimal")]
    pub kolizeum_mist: u128,
}

pub fn checkpoint_totals(
    checkpoint: u64,
    transactions: u64,
    gas_mist: i64,
    money: &[MoneyFact],
) -> Result<Totals> {
    let mut totals = Totals {
        checkpoint,
        transactions: transactions.into(),
        gas_mist: gas_mist.into(),
        ..Totals::default()
    };
    for fact in money {
        totals.item_royalty_mist = totals
            .item_royalty_mist
            .checked_add(fact.delta.item_royalty_mist.into())
            .context("item royalty overflow")?;
        totals.character_royalty_mist = totals
            .character_royalty_mist
            .checked_add(fact.delta.character_royalty_mist.into())
            .context("character royalty overflow")?;
        totals.character_creation_mist = totals
            .character_creation_mist
            .checked_add(fact.delta.character_creation_mist.into())
            .context("creation revenue overflow")?;
        totals.kolizeum_mist = totals
            .kolizeum_mist
            .checked_add(fact.delta.kolizeum_mist.into())
            .context("kolizeum revenue overflow")?;
    }
    Ok(totals)
}

fn add(previous: Option<&str>, delta: &Totals) -> Result<Totals> {
    let previous: Option<Totals> = previous.map(serde_json::from_str).transpose()?;
    if let Some(ref value) = previous {
        if value.checkpoint >= delta.checkpoint {
            return Ok(value.clone());
        }
    }
    combine(&previous.unwrap_or_default(), delta)
}

pub(super) fn combine(previous: &Totals, delta: &Totals) -> Result<Totals> {
    Ok(Totals {
        checkpoint: delta.checkpoint,
        transactions: previous
            .transactions
            .checked_add(delta.transactions)
            .context("transaction total overflow")?,
        gas_mist: previous
            .gas_mist
            .checked_add(delta.gas_mist)
            .context("gas total overflow")?,
        item_royalty_mist: previous
            .item_royalty_mist
            .checked_add(delta.item_royalty_mist)
            .context("item royalty overflow")?,
        character_royalty_mist: previous
            .character_royalty_mist
            .checked_add(delta.character_royalty_mist)
            .context("character royalty overflow")?,
        character_creation_mist: previous
            .character_creation_mist
            .checked_add(delta.character_creation_mist)
            .context("creation revenue overflow")?,
        kolizeum_mist: previous
            .kolizeum_mist
            .checked_add(delta.kolizeum_mist)
            .context("kolizeum revenue overflow")?,
    })
}

pub(super) fn keys(ts_ms: u64) -> Vec<(String, Option<u64>)> {
    let mut keys = vec![(ALL_KEY.into(), None)];
    for (tier, bucket, width, retention) in analytics::activity_buckets(ts_ms) {
        let retention = if matches!(tier, "day" | "week" | "month") {
            analytics::DAILY_ACTIVITY_RETENTION_MS
        } else {
            retention
        };
        keys.push((
            analytics::series_key("totals", tier, bucket),
            Some(analytics::expiry_seconds(bucket, width, retention)),
        ));
    }
    keys
}

pub async fn commit(conn: &mut MultiplexedConnection, ts_ms: u64, delta: &Totals) -> Result<()> {
    let keys = keys(ts_ms);
    let previous: Vec<Option<String>> = redis::cmd("MGET")
        .arg(keys.iter().map(|(key, _)| key).collect::<Vec<_>>())
        .query_async(conn)
        .await?;
    // Compute all replacements before issuing writes. A disconnected batch can still be retried per value.
    let values = previous
        .iter()
        .map(|value| {
            add(value.as_deref(), delta).and_then(|next| Ok(serde_json::to_string(&next)?))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut writes = redis::pipe();
    writes.atomic();
    for ((key, expiry), value) in keys.into_iter().zip(values) {
        writes.cmd("SET").arg(key).arg(value);
        if let Some(expiry) = expiry {
            writes.arg("EXAT").arg(expiry);
        }
        writes.ignore();
    }
    writes.query_async::<()>(conn).await?;
    Ok(())
}

#[cfg(test)]
#[path = "../tests/analytics/totals.rs"]
mod tests;
