// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Boot derivation — TWO configured ids, everything else from chain state
//! (owner ruling 2026-08-11: hand-pasted allowlists and hand-anchored start
//! checkpoints are the disease the rewrite removes).
//!
//! At boot, against the official GraphQL endpoint:
//!
//! * **lineage** — the latest id must be a version of the original package
//!   (`packageVersionsAfter` — the endpoint renamed `packageVersions` away in
//!   the 2026-08 schema); a typo'd or foreign id refuses to boot.
//! * **start checkpoint** — the checkpoint containing the ORIGINAL package's
//!   publish transaction. Consulted only when no watermark exists yet; a
//!   resuming deploy never needs the network at boot.
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

/// Resolve every executable package version for activity attribution. A fresh store fetches
/// the whole chain lineage once; later upgrades append their configured latest id locally, so
/// ordinary resume keeps the network-free boot law.
pub async fn activity_lineage(
    conn: &mut MultiplexedConnection,
    url: &str,
    original: &str,
    latest: &str,
    fresh: bool,
) -> Result<Vec<String>> {
    const KEY: &str = "idx:package_lineage";
    let stored: Option<String> = redis::cmd("GET")
        .arg(KEY)
        .query_async(conn)
        .await
        .context("reading activity package lineage")?;
    let mut lineage = stored
        .as_deref()
        .map(serde_json::from_str::<Vec<String>>)
        .transpose()
        .context("decoding activity package lineage")?
        .unwrap_or_default();
    if fresh {
        let data = graphql(
            url,
            &format!(
                r#"{{ object(address: "{original}") {{
                     asMovePackage {{ packageVersionsAfter {{ nodes {{ address }} }} }}
                   }} }}"#
            ),
        )
        .await?;
        lineage = lineage_ids(&data, original)?;
        if !lineage.iter().any(|id| id == latest) {
            return Err(anyhow!(
                "{latest} is not an upgrade of {original} — check the two ids"
            ));
        }
    }
    lineage.extend([original.to_string(), latest.to_string()]);
    lineage.sort();
    lineage.dedup();
    let encoded = serde_json::to_string(&lineage)?;
    let _: () = redis::cmd("SET")
        .arg(KEY)
        .arg(encoded)
        .query_async(conn)
        .await
        .context("writing activity package lineage")?;
    Ok(lineage)
}

/// Pure read of the lineage response: is `latest` among the versions published
/// after `original`? (Querying from the ORIGINAL, "after" is every upgrade.)
#[cfg(test)]
fn lineage_contains(data: &Value, original: &str, latest: &str) -> Result<bool> {
    let versions = data["object"]["asMovePackage"]["packageVersionsAfter"]["nodes"]
        .as_array()
        .ok_or_else(|| anyhow!("{original} is not a package on this network"))?;
    Ok(versions
        .iter()
        .filter_map(|node| node["address"].as_str())
        .any(|address| address == latest))
}

fn lineage_ids(data: &Value, original: &str) -> Result<Vec<String>> {
    let versions = data["object"]["asMovePackage"]["packageVersionsAfter"]["nodes"]
        .as_array()
        .ok_or_else(|| anyhow!("{original} is not a package on this network"))?;
    Ok(versions
        .iter()
        .filter_map(|node| node["address"].as_str().map(str::to_string))
        .chain(std::iter::once(original.to_string()))
        .collect())
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

fn projection_identity(game_original: &str, seed_original: &str) -> String {
    format!("{game_original}:{seed_original}")
}

/// Bind the store to both ORIGINAL package ids (the chain-id guard's sibling):
/// reusing a watermark after either game or content lineage changed would skip
/// the new package's early objects and events. Latest ids may change on a
/// compatible upgrade and are deliberately not bound.
pub async fn bind_projection(
    conn: &mut MultiplexedConnection,
    game_original: &str,
    seed_original: &str,
) -> Result<()> {
    const KEY: &str = "idx:projection_originals";
    let wanted = projection_identity(game_original, seed_original);
    let stored: Option<String> = redis::cmd("GET")
        .arg(KEY)
        .query_async(conn)
        .await
        .context("reading package binding")?;
    match stored {
        Some(bound) if bound == wanted => Ok(()),
        Some(bound) => Err(anyhow!(
            "this store is bound to projection {bound}, refusing to index {wanted} into it — \
             point at a fresh store or restore both original ids"
        )),
        None => {
            let _: () = redis::cmd("SET")
                .arg(KEY)
                .arg(wanted)
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
    use super::{lineage_contains, projection_identity, publish_checkpoint_from};
    use serde_json::json;

    #[test]
    fn projection_identity_changes_with_either_original_package() {
        assert_ne!(
            projection_identity("0xgame", "0xseed-a"),
            projection_identity("0xgame", "0xseed-b")
        );
        assert_ne!(
            projection_identity("0xgame-a", "0xseed"),
            projection_identity("0xgame-b", "0xseed")
        );
    }

    #[test]
    fn decodes_the_current_sui_graphql_package_versions_after_shape() {
        // Captured from the official testnet GraphQL endpoint for package
        // 0xff31200a…0baa on 2026-08-22 — the schema that renamed
        // `packageVersions` to `packageVersionsAfter`/`Before` and broke boot.
        let data = json!({
            "object": {
                "asMovePackage": {
                    "packageVersionsAfter": {
                        "nodes": [{
                            "address": "0x80ce7b5b5b3b2809da8ea973f9f267f9e5d8372524a01e7427a97a640762c79a"
                        }]
                    }
                }
            }
        });

        assert!(lineage_contains(
            &data,
            "0xff31200a",
            "0x80ce7b5b5b3b2809da8ea973f9f267f9e5d8372524a01e7427a97a640762c79a"
        )
        .expect("lineage"));
        assert!(!lineage_contains(&data, "0xff31200a", "0xdead").expect("lineage"));
    }

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
