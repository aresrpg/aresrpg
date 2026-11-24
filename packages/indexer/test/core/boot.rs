// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Boot: credentials stay out of logs, a store refuses another lineage, and package
//! identity follows only certified upgrades.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write as _};
use std::net::TcpListener;

use serde_json::json;
use sui_indexer_alt_framework::types::TypeTag;

use super::*;
use crate::pipeline::{canonical, game_type};
use crate::test_redis::redis_process;

/// A GraphQL endpoint answering each request with the next body; it returns every query.
fn graphql(bodies: Vec<Value>) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        bodies
            .into_iter()
            .map(|body| {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(&mut stream);
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse::<usize>().unwrap();
                        }
                    }
                }
                let mut request = vec![0; length];
                reader.read_exact(&mut request).unwrap();
                let request: Value = serde_json::from_slice(&request).unwrap();
                let body = body.to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                request["query"].as_str().unwrap().to_string()
            })
            .collect()
    });
    (url, server)
}

fn versions(addresses: &[&str], next: Option<&str>) -> Value {
    json!({ "data": { "object": { "asMovePackage": { "packageVersionsAfter": {
        "nodes": addresses.iter().map(|address| json!({ "address": address })).collect::<Vec<_>>(),
        "pageInfo": { "hasNextPage": next.is_some(), "endCursor": next }
    }}}}})
}

#[tokio::test]
async fn boot_logs_redact_credentials_and_store_binding_refuses_other_lineage() {
    // A password never reaches a boot log, even one containing '@'.
    assert_eq!(
        crate::redacted_url("redis://admin:hunter2@falkor.internal:6379"),
        "redis://***@falkor.internal:6379"
    );
    assert_eq!(
        crate::redacted_url("redis://admin:p@ss@falkor.internal:6379"),
        "redis://***@falkor.internal:6379"
    );
    assert_eq!(
        crate::redacted_url("redis://127.0.0.1:6379"),
        "redis://127.0.0.1:6379"
    );
    assert_eq!(crate::redacted_url("not-a-url"), "not-a-url");

    // A store is bound to both original packages; either one changing refuses to start.
    let (_process, mut conn) = redis_process().await;
    crate::boot::bind_projection(&mut conn, "0xgame", "0xseed")
        .await
        .unwrap();
    crate::boot::bind_projection(&mut conn, "0xgame", "0xseed")
        .await
        .unwrap();
    assert!(crate::boot::bind_projection(&mut conn, "0xgame", "0xother")
        .await
        .is_err());
    assert!(crate::boot::bind_projection(&mut conn, "0xother", "0xseed")
        .await
        .is_err());

    // A fresh store follows every lineage cursor at the server's page size. The first page is
    // the shape captured from the official testnet endpoint for package 0xff31200a…0baa on
    // 2026-08-22, after `packageVersions` became `packageVersionsAfter`.
    let latest = "0x80ce7b5b5b3b2809da8ea973f9f267f9e5d8372524a01e7427a97a640762c79a";
    let (url, server) = graphql(vec![
        versions(&["0xintermediate"], Some("next")),
        versions(&[latest], None),
    ]);
    let lineage = crate::boot::activity_lineage(&mut conn, &url, "0xoriginal", latest, true)
        .await
        .unwrap();
    let queries = server.join().unwrap();
    assert!(queries[0].contains("after: null") && queries[1].contains("after: \"next\""));
    assert!(queries.iter().all(|query| !query.contains("first:")));
    assert_eq!(
        lineage,
        [
            "0x80ce7b5b5b3b2809da8ea973f9f267f9e5d8372524a01e7427a97a640762c79a",
            "0xintermediate",
            "0xoriginal"
        ]
    );
    // A resumed store at the same version never touches the network.
    let resumed =
        crate::boot::activity_lineage(&mut conn, "http://127.0.0.1:9", "0xoriginal", latest, false);
    assert_eq!(resumed.await.unwrap(), lineage);
    // A latest id outside the lineage refuses to boot.
    let (url, server) = graphql(vec![versions(&[latest], None)]);
    let foreign =
        crate::boot::activity_lineage(&mut conn, &url, "0xoriginal", "0xdead", true).await;
    server.join().unwrap();
    assert!(foreign.is_err());

    // The start checkpoint: the shape captured from the official testnet endpoint for package
    // 0xb68b4685…2387 on 2026-08-17.
    let (url, server) = graphql(vec![json!({ "data": { "object": { "previousTransaction": {
        "effects": { "checkpoint": { "sequenceNumber": 372_762_581 } } } } } })]);
    let start = crate::boot::publish_checkpoint(&url, "0xb68b4685").await;
    server.join().unwrap();
    assert_eq!(start.unwrap(), 372_762_581);
    let (url, server) = graphql(vec![
        json!({ "errors": [{ "message": "Page size is too large" }] }),
    ]);
    assert!(crate::boot::publish_checkpoint(&url, "0xb68b4685")
        .await
        .is_err());
    server.join().unwrap();
}

#[tokio::test]
async fn a_fresh_store_marks_the_compact_analytics_format() {
    let (_process, mut conn) = redis_process().await;
    crate::boot::bind_analytics_schema(&mut conn).await.unwrap();
    crate::boot::bind_analytics_schema(&mut conn).await.unwrap();
    let schema: Option<String> = redis::cmd("GET")
        .arg(crate::analytics_totals::SCHEMA_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(schema.as_deref(), Some("compact-v1"));
}

#[tokio::test]
async fn a_store_in_another_analytics_format_refuses_to_boot() {
    let (_process, mut conn) = redis_process().await;
    let _: () = redis::cmd("SET")
        .arg(crate::analytics_totals::SCHEMA_KEY)
        .arg("legacy-v0")
        .query_async(&mut conn)
        .await
        .unwrap();
    let refused = crate::boot::bind_analytics_schema(&mut conn).await;
    assert!(refused.unwrap_err().to_string().contains("legacy-v0"));
    // the unknown format is left as found, never overwritten
    let schema: Option<String> = redis::cmd("GET")
        .arg(crate::analytics_totals::SCHEMA_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(schema.as_deref(), Some("legacy-v0"));
}

#[test]
fn certified_upgrade_types_normalize_to_original() {
    assert_eq!(
        canonical("0x2").unwrap(),
        "0x0000000000000000000000000000000000000000000000000000000000000002"
    );
    assert!(canonical("not-hex").is_err() && canonical(&"f".repeat(65)).is_err());
    let original = canonical("0x11").unwrap();
    let versions = HashSet::from([original.clone(), canonical("0x22").unwrap()]);
    let normalize = |tag: &str| {
        game_type(tag.parse::<TypeTag>().unwrap(), &original, &versions).to_canonical_string(true)
    };
    // New types and events born in a certified upgrade reach the original projection identity.
    assert_eq!(
        normalize("0x22::tournament::Tournament"),
        format!("{original}::tournament::Tournament")
    );
    assert_eq!(
        normalize("0x22::tournament::TournamentUpdated"),
        format!("{original}::tournament::TournamentUpdated")
    );
    // Nested dynamic-field keys normalize; foreign lookalikes never do.
    let expected: TypeTag =
        "0x2::dynamic_field::Field<0x11::tournament::Key, vector<0x33::tournament::Tournament>>"
            .parse()
            .unwrap();
    assert_eq!(
        normalize("0x2::dynamic_field::Field<0x22::tournament::Key, vector<0x33::tournament::Tournament>>"),
        expected.to_canonical_string(true)
    );
    assert_eq!(
        normalize("0x33::token::Token"),
        "0x0000000000000000000000000000000000000000000000000000000000000033::token::Token"
    );
    assert_eq!(game_type(TypeTag::U64, &original, &versions), TypeTag::U64);
}
