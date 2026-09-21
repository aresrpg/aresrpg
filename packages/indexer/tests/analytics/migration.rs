use super::*;
use crate::analytics_totals::{checkpoint_totals, commit, ALL_KEY};
use crate::test_redis::redis_process;

#[tokio::test]
async fn migration_preserves_committed_history_restarts_and_replays_partial_checkpoint() {
    let (_process, mut conn) = redis_process().await;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let day = crate::analytics::bucket_day(now);
    let mut seed = redis::pipe();
    seed.cmd("SET")
        .arg("idx:watermark:ares")
        .arg(r#"{"checkpoint_hi_inclusive":100}"#)
        .ignore();
    for suffix in ["all".into(), format!("day:{day}")] {
        seed.cmd("HSET")
            .arg(format!("analytics:transactions:{suffix}"))
            .arg(1)
            .arg(5)
            .arg(2)
            .arg(7)
            .arg(101)
            .arg(99)
            .ignore();
        seed.cmd("HSET")
            .arg(format!("analytics:gas:{suffix}"))
            .arg(1)
            .arg(-3)
            .arg(2)
            .arg(4)
            .arg(101)
            .arg(-9)
            .ignore();
    }
    for (coordinate, amount) in [("1:0:0", 2), ("2:0:0", 3), ("101:0:0", 99)] {
        seed.cmd("HSET").arg(format!("analytics:money:day:{day}")).arg(coordinate).arg(serde_json::json!({"ts_ms":now,"item_royalty_mist":amount.to_string(),"character_royalty_mist":"0"}).to_string()).ignore();
    }
    // A prior migration attempt wrote an incomplete destination but never committed the schema marker.
    seed.cmd("SET")
        .arg(ALL_KEY)
        .arg(serde_json::to_string(&Totals::default()).unwrap())
        .ignore();
    seed.query_async::<()>(&mut conn).await.unwrap();
    initialize(&mut conn, false).await.unwrap();
    let raw: String = redis::cmd("GET")
        .arg(ALL_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    let totals: Totals = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        (
            totals.transactions,
            totals.gas_mist,
            totals.item_royalty_mist
        ),
        (12, 1, 5)
    );
    assert_eq!(totals.checkpoint, 100);
    let ttl: i64 = redis::cmd("TTL")
        .arg("analytics:transactions:all")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(ttl > 0 && ttl <= LEGACY_GRACE_SECS as i64);
    commit(
        &mut conn,
        now,
        &checkpoint_totals(101, 99, -9, &[]).unwrap(),
    )
    .await
    .unwrap();
    initialize(&mut conn, false).await.unwrap();
    let raw: String = redis::cmd("GET")
        .arg(ALL_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    let totals: Totals = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        (
            totals.transactions,
            totals.gas_mist,
            totals.item_royalty_mist
        ),
        (111, -8, 5)
    );
}

#[tokio::test]
async fn fresh_database_initializes_but_unknown_or_corrupt_history_stays_untouched() {
    let (_process, mut conn) = redis_process().await;
    initialize(&mut conn, true).await.unwrap();
    initialize(&mut conn, false).await.unwrap();
    let _: () = redis::cmd("SET")
        .arg(SCHEMA_KEY)
        .arg("unknown")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(initialize(&mut conn, false).await.is_err());
    let _: () = redis::cmd("DEL")
        .arg(SCHEMA_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    let _: () = redis::cmd("HSET")
        .arg("analytics:transactions:all")
        .arg(1)
        .arg("bad")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(initialize(&mut conn, true).await.is_err());
    let _: () = redis::cmd("SET")
        .arg("idx:watermark:ares")
        .arg(r#"{"checkpoint_hi_inclusive":100}"#)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(initialize(&mut conn, false).await.is_err());
    let ttl: i64 = redis::cmd("TTL")
        .arg("analytics:transactions:all")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(ttl, -1);
    let exists: bool = redis::cmd("EXISTS")
        .arg(SCHEMA_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn large_legacy_history_compacts_without_changing_totals() {
    let (_process, mut conn) = redis_process().await;
    let count = 10_000u64;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let day = crate::analytics::bucket_day(now);
    let mut seed = redis::pipe();
    seed.cmd("SET")
        .arg("idx:watermark:ares")
        .arg(format!(r#"{{"checkpoint_hi_inclusive":{count}}}"#))
        .ignore();
    for suffix in ["all".into(), format!("day:{day}")] {
        for metric in ["transactions", "gas"] {
            seed.cmd("HSET").arg(format!("analytics:{metric}:{suffix}"));
            for checkpoint in 1..=count {
                seed.arg(checkpoint)
                    .arg(if metric == "transactions" { 1 } else { -2 });
            }
            seed.ignore();
        }
    }
    seed.query_async::<()>(&mut conn).await.unwrap();
    let before: u64 = redis::cmd("MEMORY")
        .arg("USAGE")
        .arg("analytics:transactions:all")
        .query_async(&mut conn)
        .await
        .unwrap();
    initialize(&mut conn, false).await.unwrap();
    let raw: String = redis::cmd("GET")
        .arg(ALL_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    let totals: Totals = serde_json::from_str(&raw).unwrap();
    assert_eq!(totals.transactions, u128::from(count));
    assert_eq!(totals.gas_mist, -2 * i128::from(count));
    let after: u64 = redis::cmd("MEMORY")
        .arg("USAGE")
        .arg(ALL_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(after * 100 < before);
    println!("10,000-checkpoint sample: one legacy metric {before} bytes; compact record holding every numeric metric {after} bytes");
}
