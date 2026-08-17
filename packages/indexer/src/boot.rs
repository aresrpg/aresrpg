// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Boot derivation — TWO configured ids, everything else from chain state
//! (owner ruling 2026-08-11: hand-pasted allowlists and hand-anchored start
//! checkpoints are the disease the rewrite removes).
//!
//! At boot, against the official GraphQL endpoint:
//!
//! * **lineage** — the latest id must be a version of the original package
//!   (`packageVersions`); a typo'd or foreign id refuses to boot.
//! * **start checkpoint** — the checkpoint containing the ORIGINAL package's
//!   publish transaction. Consulted only when no watermark exists yet and no
//!   `FIRST_CHECKPOINT` override is given; a resuming deploy never needs the
//!   network at boot.
//!
//! Also declares the graph INDEXES (idempotent — an already-indexed error is
//! the success state).

use anyhow::{anyhow, Context, Result};
use redis::aio::MultiplexedConnection;
use serde_json::{json, Value};
use tracing::info;

/// Ask the official GraphQL endpoint one query. Bounded: a hung endpoint must
/// fail the boot loudly, never hang it.
async fn graphql(url: &str, query: &str) -> Result<Value> {
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .context("building graphql client")?
        .post(url)
        .json(&json!({ "query": query }))
        .send()
        .await
        .with_context(|| format!("graphql request to {url}"))?;
    let body: Value = response.json().await.context("graphql response body")?;
    if let Some(errors) = body.get("errors").and_then(Value::as_array) {
        if !errors.is_empty() {
            return Err(anyhow!("graphql: {}", errors[0]["message"]));
        }
    }
    Ok(body["data"].clone())
}

/// The checkpoint of the original package's publish transaction.
pub async fn publish_checkpoint(url: &str, original: &str) -> Result<u64> {
    let data = graphql(
        url,
        &format!(
            r#"{{ object(address: "{original}") {{
                 previousTransaction {{ effects {{ checkpoint {{ sequenceNumber }} }} }}
               }} }}"#
        ),
    )
    .await?;
    publish_checkpoint_from(&data, original)
}

fn publish_checkpoint_from(data: &Value, original: &str) -> Result<u64> {
    data["object"]["previousTransaction"]["effects"]["checkpoint"]["sequenceNumber"]
        .as_u64()
        .ok_or_else(|| {
            anyhow!("no publish checkpoint for {original} — is the id a package on this network?")
        })
}

/// Refuse to boot unless `latest` is a version of the `original` package.
pub async fn validate_lineage(url: &str, original: &str, latest: &str) -> Result<()> {
    if original == latest {
        return Ok(());
    }
    let data = graphql(
        url,
        &format!(
            r#"{{ object(address: "{original}") {{
                 asMovePackage {{ packageVersions {{ nodes {{ address }} }} }}
               }} }}"#
        ),
    )
    .await?;
    let versions = data["object"]["asMovePackage"]["packageVersions"]["nodes"]
        .as_array()
        .ok_or_else(|| anyhow!("{original} is not a package on this network"))?;
    let is_version = versions
        .iter()
        .filter_map(|node| node["address"].as_str())
        .any(|address| address == latest);
    if !is_version {
        return Err(anyhow!(
            "{latest} is not an upgrade of {original} — check the two ids"
        ));
    }
    Ok(())
}

/// Does the pipeline already have a watermark? (A resuming deploy must never
/// depend on the network at boot.)
pub async fn has_watermark(conn: &mut MultiplexedConnection) -> Result<bool> {
    let stored: Option<String> = redis::cmd("GET")
        .arg("idx:watermark:ares")
        .query_async(conn)
        .await
        .context("reading watermark at boot")?;
    Ok(stored.is_some())
}

/// Bind the store to its ORIGINAL package id (the chain-id guard's sibling): a
/// restart pointed at a different game against the same store would silently
/// advance the old graph's watermark over foreign state. Local, network-free.
/// The LATEST id may legitimately change (upgrade day) and is not bound.
pub async fn bind_package(conn: &mut MultiplexedConnection, original: &str) -> Result<()> {
    const KEY: &str = "idx:package_original";
    let stored: Option<String> = redis::cmd("GET")
        .arg(KEY)
        .query_async(conn)
        .await
        .context("reading package binding")?;
    match stored {
        Some(bound) if bound == original => Ok(()),
        Some(bound) => Err(anyhow!(
            "this store is bound to package {bound}, refusing to index {original} into it — \
             point at a fresh store or restore the original id"
        )),
        None => {
            let _: () = redis::cmd("SET")
                .arg(KEY)
                .arg(original)
                .query_async(conn)
                .await
                .context("writing package binding")?;
            Ok(())
        }
    }
}

/// Declare every index the README schema names. Idempotent: an
/// "already indexed" error IS the success state; anything else aborts boot.
pub async fn ensure_indexes(conn: &mut MultiplexedConnection) -> Result<()> {
    let indexes = [
        "CREATE INDEX FOR (n:User) ON (n.address)",
        "CREATE INDEX FOR (n:Kiosk) ON (n.id)",
        "CREATE INDEX FOR (n:Character) ON (n.id)",
        "CREATE INDEX FOR (n:Character) ON (n.world)",
        "CREATE INDEX FOR (n:Item) ON (n.id)",
        "CREATE INDEX FOR (n:Item) ON (n.item_type)",
        "CREATE INDEX FOR (n:Fight) ON (n.id)",
        "CREATE INDEX FOR (n:Party) ON (n.id)",
        "CREATE INDEX FOR (n:Kolizeum) ON (n.id)",
        "CREATE INDEX FOR (n:Sale) ON (n.id)",
        "CREATE INDEX FOR (n:Airdrop) ON (n.id)",
        "CREATE INDEX FOR (n:Giftcard) ON (n.id)",
        "CREATE INDEX FOR (n:Zone) ON (n.world, n.zx, n.zz)",
        "CREATE INDEX FOR (n:Market) ON (n.item_type)",
        "CREATE INDEX FOR (n:Meta) ON (n.id)",
    ];
    for statement in indexes {
        let result: std::result::Result<redis::Value, redis::RedisError> =
            redis::cmd("GRAPH.QUERY")
                .arg("aresrpg")
                .arg(statement)
                .query_async(conn)
                .await;
        match result {
            Ok(_) => {}
            Err(error) if error.to_string().contains("already indexed") => {}
            Err(error) => return Err(error).with_context(|| format!("declaring: {statement}")),
        }
    }
    info!(count = indexes.len(), "graph indexes declared");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::publish_checkpoint_from;
    use serde_json::json;

    #[test]
    fn decodes_the_current_sui_graphql_previous_transaction_shape() {
        // Captured from the official testnet GraphQL endpoint for package
        // 0xb68b4685…2387 on 2026-08-17.
        let data = json!({
            "object": {
                "previousTransaction": {
                    "effects": { "checkpoint": { "sequenceNumber": 372_762_581 } }
                }
            }
        });

        assert_eq!(
            publish_checkpoint_from(&data, "0xb68b4685").expect("checkpoint"),
            372_762_581
        );
    }
}
