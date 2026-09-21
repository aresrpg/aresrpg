use super::*;
use crate::analytics::{MoneyDelta, MoneyFact};
use crate::test_redis::redis_process;

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[test]
fn checkpoint_contributions_are_grouped_and_exact_including_negative_gas() {
    let money = [1, 2].map(|index| MoneyFact {
        coordinate: format!("42:0:{index}"),
        ts_ms: 1,
        delta: MoneyDelta {
            item_royalty_mist: u64::MAX,
            ..MoneyDelta::default()
        },
    });
    let delta = checkpoint_totals(42, 7, -100, &money).unwrap();
    assert_eq!(delta.item_royalty_mist, u128::from(u64::MAX) * 2);
    let encoded = serde_json::to_string(&delta).unwrap();
    assert!(encoded.contains("\"gas_mist\":\"-100\""));
    assert_eq!(add(Some(&encoded), &delta).unwrap(), delta);
    assert_eq!(
        add(
            Some(&encoded),
            &Totals {
                checkpoint: 41,
                ..delta.clone()
            }
        )
        .unwrap(),
        delta
    );
    assert_eq!(
        add(
            Some(&encoded),
            &Totals {
                checkpoint: 43,
                ..delta.clone()
            }
        )
        .unwrap()
        .gas_mist,
        -200
    );
    assert!(add(Some("broken"), &delta).is_err());
    let full = serde_json::to_string(&Totals {
        transactions: u128::MAX,
        ..Totals::default()
    })
    .unwrap();
    assert!(add(Some(&full), &delta).is_err());
}

#[tokio::test]
async fn partial_checkpoint_retry_keeps_all_six_accumulators_equal_and_expiring() {
    let (_process, mut conn) = redis_process().await;
    let ts_ms = now();
    let first = checkpoint_totals(10, 4, -7, &[]).unwrap();
    let second = checkpoint_totals(11, 3, 2, &[]).unwrap();
    commit(&mut conn, ts_ms, &first).await.unwrap();
    let partial = combine(&first, &second).unwrap();
    let _: () = redis::cmd("SET")
        .arg(ALL_KEY)
        .arg(serde_json::to_string(&partial).unwrap())
        .query_async(&mut conn)
        .await
        .unwrap();
    commit(&mut conn, ts_ms, &second).await.unwrap();
    commit(&mut conn, ts_ms, &second).await.unwrap();
    for (key, expiry) in keys(ts_ms) {
        let raw: String = redis::cmd("GET")
            .arg(&key)
            .query_async(&mut conn)
            .await
            .unwrap();
        let actual: Totals = serde_json::from_str(&raw).unwrap();
        assert_eq!(actual, partial);
        let ttl: i64 = redis::cmd("TTL")
            .arg(&key)
            .query_async(&mut conn)
            .await
            .unwrap();
        assert_eq!(ttl > 0, expiry.is_some());
    }
    let initial: u64 = redis::cmd("DBSIZE").query_async(&mut conn).await.unwrap();
    for checkpoint in 12..112 {
        commit(
            &mut conn,
            ts_ms,
            &checkpoint_totals(checkpoint, 1, 1, &[]).unwrap(),
        )
        .await
        .unwrap();
    }
    let final_size: u64 = redis::cmd("DBSIZE").query_async(&mut conn).await.unwrap();
    assert_eq!(initial, 6);
    assert_eq!(initial, final_size);
}
