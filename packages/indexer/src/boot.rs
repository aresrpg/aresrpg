// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Boot derivation — TWO configured ids, everything else from chain state: no hand-pasted
//! allowlist or hand-anchored start checkpoint.
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
/// the whole chain lineage once and refreshes it on upgrades, including intermediate versions
/// that introduced types. Ordinary resume at the same version remains network-free.
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
    if fresh || !lineage.iter().any(|id| id == latest) {
        lineage = complete_lineage(url, original).await?;
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

async fn complete_lineage(url: &str, original: &str) -> Result<Vec<String>> {
    let mut lineage = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let after = serde_json::to_string(&cursor)?;
        let data = graphql(
            url,
            &format!(
                r#"{{ object(address: "{original}") {{ asMovePackage {{
                packageVersionsAfter(after: {after}) {{
                    nodes {{ address }} pageInfo {{ hasNextPage endCursor }}
                }}
            }} }} }}"#
            ),
        )
        .await?;
        lineage.extend(lineage_ids(&data, original)?);
        let page = &data["object"]["asMovePackage"]["packageVersionsAfter"]["pageInfo"];
        if page["hasNextPage"].as_bool() != Some(true) {
            break;
        }
        let next = page["endCursor"]
            .as_str()
            .ok_or_else(|| anyhow!("package lineage page lacks a cursor"))?;
        anyhow::ensure!(
            cursor.as_deref() != Some(next),
            "package lineage cursor did not advance"
        );
        cursor = Some(next.to_string());
    }
    Ok(lineage)
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

/// Mark a fresh store with the numeric analytics format, and refuse any store that holds
/// another one: the writer never runs on an unknown format.
pub async fn bind_analytics_schema(conn: &mut MultiplexedConnection) -> Result<()> {
    use crate::analytics_totals::{SCHEMA, SCHEMA_KEY};
    let _: Option<String> = redis::cmd("SET")
        .arg(SCHEMA_KEY)
        .arg(SCHEMA)
        .arg("NX")
        .query_async(conn)
        .await
        .context("writing the analytics schema")?;
    let stored: Option<String> = redis::cmd("GET")
        .arg(SCHEMA_KEY)
        .query_async(conn)
        .await
        .context("reading the analytics schema")?;
    match stored.as_deref() {
        Some(SCHEMA) => Ok(()),
        other => Err(anyhow!(
            "this store holds analytics format {other:?}, not {SCHEMA}; rebuild the disposable store"
        )),
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
        "CREATE INDEX FOR (n:Character) ON (n.owner)",
        "CREATE INDEX FOR (n:Item) ON (n.id)",
        "CREATE INDEX FOR (n:Item) ON (n.item_type)",
        "CREATE INDEX FOR (n:Item) ON (n.category)",
        "CREATE INDEX FOR (n:Fight) ON (n.id)",
        "CREATE INDEX FOR (n:Party) ON (n.id)",
        "CREATE INDEX FOR (n:Kolizeum) ON (n.id)",
        "CREATE INDEX FOR (n:Tournament) ON (n.id)",
        "CREATE INDEX FOR (n:TournamentKaresPool) ON (n.id)",
        "CREATE INDEX FOR (n:TournamentMatch) ON (n.fight_id)",
        "CREATE INDEX FOR (n:Giftcard) ON (n.id)",
        "CREATE INDEX FOR (n:Zone) ON (n.world, n.zx, n.zz)",
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
