// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

use serde_json::{json, Value};

#[tokio::test]
async fn lineage_respects_server_page_size_and_follows_every_cursor() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for page in 0..2 {
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
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let request: Value = serde_json::from_slice(&body).unwrap();
            let query = request["query"].as_str().unwrap();
            let requested = query.split("first:").nth(1).map(|tail| {
                tail.split(',')
                    .next()
                    .unwrap()
                    .trim()
                    .parse::<u64>()
                    .unwrap()
            });
            let oversized = requested.is_some_and(|size| size > 50);
            let response = if oversized {
                json!({"errors": [{"message": "Page size is too large: 100 > 50"}]})
            } else {
                assert!(query.contains(if page == 0 {
                    "after: null"
                } else {
                    "after: \"next\""
                }));
                json!({"data": {"object": {"asMovePackage": {"packageVersionsAfter": {
                    "nodes": [{"address": if page == 0 { "0xintermediate" } else { "0xlatest" }}],
                    "pageInfo": {"hasNextPage": page == 0, "endCursor": "next"}
                }}}}})
            }
            .to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            if oversized {
                break;
            }
        }
    });
    let result = super::complete_lineage(&url, "0xoriginal").await;
    server.join().unwrap();
    let lineage = result.expect("server-sized lineage pagination");
    assert!(lineage.contains(&"0xoriginal".to_string()));
    assert!(lineage.contains(&"0xintermediate".to_string()));
    assert!(lineage.contains(&"0xlatest".to_string()));
}
