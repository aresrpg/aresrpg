// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Public sale facts for the live Discord subscription.
use anyhow::{Context, Result};
use serde_json::{json, Value};

use crate::publish::SalesRow;

pub fn extract(rows: &[SalesRow], digests: &[String]) -> Result<Vec<Value>> {
    rows.iter()
        .filter_map(|row| {
            let decode = || -> Result<Option<Value>> {
                let (id, body) = row
                    .member
                    .split_once('|')
                    .context("sale coordinate missing")?;
                let mut sale: Value = serde_json::from_str(body)?;
                if sale["side"] != "sold"
                    || sale["exclusive"] != false
                    || sale["price_mist"]
                        .as_str()
                        .context("sale price missing")?
                        .parse::<u64>()?
                        == 0
                {
                    return Ok(None);
                }
                let tx = id
                    .split(':')
                    .nth(1)
                    .context("sale transaction missing")?
                    .parse::<usize>()?;
                sale["id"] = json!(format!("{id}:sale"));
                sale["asset_kind"] = sale["kind"].clone();
                sale["kind"] = json!("sale");
                sale["seller"] = json!(row.address.hex());
                sale["digest"] = json!(digests.get(tx).context("sale digest missing")?);
                Ok(Some(sale))
            };
            decode().transpose()
        })
        .collect()
}

#[cfg(test)]
#[path = "../tests/notifications/sales.rs"]
mod tests;
