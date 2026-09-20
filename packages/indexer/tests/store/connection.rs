// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[tokio::test]
async fn slow_responses_preserve_the_indexer_connection() {
    let (_process, mut conn) = crate::test_redis::redis_process().await;
    let _: () = redis::cmd("CLIENT")
        .arg("PAUSE")
        .arg(750)
        .arg("ALL")
        .query_async(&mut conn)
        .await
        .unwrap();
    let pong: String = redis::cmd("PING").query_async(&mut conn).await.unwrap();
    assert_eq!(pong, "PONG");
}
