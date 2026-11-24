// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Replay-safe accumulation in an isolated Redis: partial writes and replays never double count.

use redis::aio::MultiplexedConnection;

use super::*;
use crate::analytics::{self, MoneyDelta, DAY_MS};
use crate::analytics_totals::{self, checkpoint_totals, Totals, ALL_KEY};
use crate::leaderboard_store::{self as store, Meta, PENDING_KEY};
use crate::leaderboards::{Contribution, Metric, META_KEY};
use crate::market_prices::{self, Sale, RETENTION_DAYS, START_KEY};
use crate::test_redis::redis_process;

async fn get(conn: &mut MultiplexedConnection, key: &str) -> Option<String> {
    redis::cmd("GET").arg(key).query_async(conn).await.unwrap()
}

async fn set(conn: &mut MultiplexedConnection, key: &str, value: &str) {
    let _: () = redis::cmd("SET")
        .arg(key)
        .arg(value)
        .query_async(conn)
        .await
        .unwrap();
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[tokio::test]
async fn analytics_totals_replay_is_idempotent() {
    let (_process, mut conn) = redis_process().await;
    let ts = now();
    let commit = |conn: &mut MultiplexedConnection, totals: Totals| {
        let mut conn = conn.clone();
        async move { analytics_totals::commit(&mut conn, ts, &totals).await }
    };
    // Exact money beyond u64 and negative net gas.
    let max = MoneyDelta {
        item_royalty_mist: u64::MAX,
        tournament_mist: u64::MAX,
        ..MoneyDelta::default()
    };
    let first = checkpoint_totals(10, 4, -7, &[max, max]).unwrap();
    commit(&mut conn, first.clone()).await.unwrap();
    let stored = get(&mut conn, ALL_KEY).await.unwrap();
    assert!(stored.contains(&format!(
        "\"item_royalty_mist\":\"{}\"",
        u128::from(u64::MAX) * 2
    )));
    assert!(stored.contains("\"gas_mist\":\"-7\""));
    // The all-time value already holds checkpoint 11 (a partial batch): the retry and a
    // replay leave every tier equal.
    let second = checkpoint_totals(11, 3, 2, &[]).unwrap();
    let expected = Totals {
        checkpoint: 11,
        transactions: 7,
        gas_mist: -5,
        ..first.clone()
    };
    set(
        &mut conn,
        ALL_KEY,
        &serde_json::to_string(&expected).unwrap(),
    )
    .await;
    commit(&mut conn, second.clone()).await.unwrap();
    commit(&mut conn, second).await.unwrap();
    commit(&mut conn, first).await.unwrap();
    for (key, expiry) in analytics_totals::keys(ts) {
        let actual: Totals = serde_json::from_str(&get(&mut conn, &key).await.unwrap()).unwrap();
        assert_eq!(actual, expected, "{key}");
        let ttl: i64 = redis::cmd("TTL")
            .arg(&key)
            .query_async(&mut conn)
            .await
            .unwrap();
        assert_eq!(ttl > 0, expiry.is_some());
    }
    // A hundred more checkpoints reuse the same six values.
    for checkpoint in 12..112 {
        commit(&mut conn, checkpoint_totals(checkpoint, 1, 1, &[]).unwrap())
            .await
            .unwrap();
    }
    let size: u64 = redis::cmd("DBSIZE").query_async(&mut conn).await.unwrap();
    assert_eq!(size, 6);
    // A record from before the tournament channel existed accepts it without recounting.
    let mut legacy = serde_json::to_value(Totals {
        checkpoint: 200,
        ..Totals::default()
    })
    .unwrap();
    legacy.as_object_mut().unwrap().remove("tournament_mist");
    set(&mut conn, ALL_KEY, &legacy.to_string()).await;
    let tournament = Totals {
        checkpoint: 201,
        tournament_mist: 7,
        ..Totals::default()
    };
    commit(&mut conn, tournament.clone()).await.unwrap();
    commit(&mut conn, tournament).await.unwrap();
    let all: Totals = serde_json::from_str(&get(&mut conn, ALL_KEY).await.unwrap()).unwrap();
    assert_eq!(all.tournament_mist, 7);
    // A corrupt value or an overflow refuses the checkpoint instead of guessing.
    set(&mut conn, ALL_KEY, "broken").await;
    assert!(
        commit(&mut conn, checkpoint_totals(300, 1, 1, &[]).unwrap())
            .await
            .is_err()
    );
    let full = Totals {
        checkpoint: 300,
        transactions: u128::MAX,
        ..Totals::default()
    };
    set(&mut conn, ALL_KEY, &serde_json::to_string(&full).unwrap()).await;
    assert!(
        commit(&mut conn, checkpoint_totals(301, 1, 1, &[]).unwrap())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn market_prices_candles_are_exact_and_replay_safe() {
    let (_process, mut conn) = redis_process().await;
    let ts = now();
    let key = format!("market:prices:day:{}", ts / DAY_MS);
    let sale = |item: &str, mist, units| Sale {
        item_type: item.into(),
        mist,
        units,
    };
    let day = |conn: &mut MultiplexedConnection, item: &'static str| {
        let mut conn = conn.clone();
        let key = key.clone();
        async move {
            let raw: Option<String> = redis::cmd("HGET")
                .arg(&key)
                .arg(item)
                .query_async(&mut conn)
                .await
                .unwrap();
            raw.map(|raw| serde_json::from_str::<Value>(&raw).unwrap())
        }
    };
    let price = |sale: &Sale| serde_json::json!({ "mist": sale.mist.to_string(), "units": sale.units.to_string() });
    market_prices::commit(&mut conn, 1000, ts, &[])
        .await
        .unwrap();
    assert_eq!(get(&mut conn, START_KEY).await.unwrap(), ts.to_string());
    // Mixed lots keep exact money and units; candles follow sale order and compare exact
    // unit ratios (1/1000 is the low, 11/10 the high).
    let first = sale("wheat", 10, 10);
    let high = sale("wheat", 11, 10);
    let low = sale("wheat", 1, 1000);
    let close = sale("wheat", 50, 100);
    let huge = sale("quartz", u64::MAX, 1);
    let batch = [
        first.clone(),
        high.clone(),
        low.clone(),
        close.clone(),
        huge.clone(),
        huge,
    ];
    market_prices::commit(&mut conn, 1001, ts, &batch)
        .await
        .unwrap();
    // A replay of the same checkpoint, even with other rows, changes nothing.
    market_prices::commit(&mut conn, 1001, ts, std::slice::from_ref(&first))
        .await
        .unwrap();
    let wheat = day(&mut conn, "wheat").await.unwrap();
    assert_eq!(
        (&wheat["total_mist"], &wheat["units"], &wheat["sales"]),
        (&"72".into(), &"1120".into(), &"4".into())
    );
    assert_eq!(
        wheat["ohlc"],
        serde_json::json!({
            "open": price(&first), "high": price(&high), "low": price(&low), "close": price(&close)
        })
    );
    let quartz = day(&mut conn, "quartz").await.unwrap();
    assert_eq!(quartz["total_mist"], (u128::from(u64::MAX) * 2).to_string());
    let expiry: u64 = redis::cmd("EXPIRETIME")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(expiry, (ts / DAY_MS + RETENTION_DAYS + 1) * DAY_MS / 1000);
    // A partial batch: one field reached Redis at 1002, the other did not. The retry writes
    // only the missing one.
    let applied =
        serde_json::json!({ "total_mist": "1", "units": "1", "sales": "1", "checkpoint": 1002 });
    let _: () = redis::cmd("HSET")
        .arg(&key)
        .arg("ore")
        .arg(applied.to_string())
        .query_async(&mut conn)
        .await
        .unwrap();
    let retry = [sale("ore", 1, 1), sale("wood", 11, 10)];
    market_prices::commit(&mut conn, 1002, ts, &retry)
        .await
        .unwrap();
    assert_eq!(day(&mut conn, "ore").await.unwrap(), applied);
    assert_eq!(day(&mut conn, "wood").await.unwrap()["sales"], "1");
    // A legacy day without extremes stays readable and never invents them.
    let legacy = r#"{"total_mist":"100","units":"10","sales":"1","checkpoint":5}"#;
    let _: () = redis::cmd("HSET")
        .arg(&key)
        .arg("legacy")
        .arg(legacy)
        .query_async(&mut conn)
        .await
        .unwrap();
    market_prices::commit(&mut conn, 1003, ts, &[sale("legacy", 1, 1000)])
        .await
        .unwrap();
    let legacy = day(&mut conn, "legacy").await.unwrap();
    assert_eq!(
        (&legacy["total_mist"], &legacy["units"]),
        (&"101".into(), &"1010".into())
    );
    assert!(legacy.get("ohlc").is_none());
    // Zero money or zero units are refused; sales older than retention write nothing.
    assert!(
        market_prices::commit(&mut conn, 1004, ts, &[sale("bad", 0, 1)])
            .await
            .is_err()
    );
    assert!(
        market_prices::commit(&mut conn, 1004, ts, &[sale("bad", 1, 0)])
            .await
            .is_err()
    );
    let old = ts - 400 * DAY_MS;
    market_prices::commit(&mut conn, 1, old, &[sale("old", 1, 1)])
        .await
        .unwrap();
    let exists: bool = redis::cmd("EXISTS")
        .arg(format!("market:prices:day:{}", old / DAY_MS))
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(!exists);
    assert_eq!(get(&mut conn, START_KEY).await.unwrap(), ts.to_string());

    // Market volume stores one absolute subtotal per checkpoint: a replay overwrites it and a
    // zero replay removes it; money above 2^53 stays exact.
    let volume = format!("market:volume:day:{}", ts / DAY_MS);
    for mist in [9_007_199_254_740_993u128, 9_007_199_254_740_993] {
        crate::market_volume::commands(42, ts, mist)
            .query_async::<()>(&mut conn)
            .await
            .unwrap();
    }
    let subtotals: Vec<String> = redis::cmd("HVALS")
        .arg(&volume)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(subtotals, [format!("{ts}:9007199254740993")]);
    crate::market_volume::commands(42, ts, 0)
        .query_async::<()>(&mut conn)
        .await
        .unwrap();
    let exists: bool = redis::cmd("EXISTS")
        .arg(&volume)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(!exists);
}

const SEPTEMBER: u64 = 1_788_220_800_000;
const SEPTEMBER_LAST: u64 = 1_790_812_799_999;
const OCTOBER: u64 = 1_790_812_800_000;
const NOVEMBER: u64 = 1_793_491_200_000;

async fn total(conn: &mut MultiplexedConnection, metric: &str, address: u8) -> Option<String> {
    redis::cmd("HGET")
        .arg(format!("leaderboards:{metric}:totals"))
        .arg(addr(address).hex())
        .query_async(conn)
        .await
        .unwrap()
}

fn dungeon(fight: u8) -> Contribution {
    Contribution {
        metric: Metric::Dungeons,
        address: addr(2),
        amount: 1,
        dungeon_fight: Some(id(fight)),
    }
}

#[tokio::test]
async fn leaderboards_recover_partial_exec_and_monthly_reset() {
    // Calendar months and the exact rank order.
    assert_eq!(store::next_reset(SEPTEMBER).unwrap(), OCTOBER);
    assert_eq!(store::next_reset(SEPTEMBER_LAST).unwrap(), OCTOBER);
    assert_eq!(
        store::next_reset(1_706_745_600_000).unwrap(),
        1_709_251_200_000
    ); // leap February
    assert_eq!(
        store::next_reset(1_796_083_200_000).unwrap(),
        1_798_761_600_000
    ); // December
    let large = 9_007_199_254_740_992u128;
    assert!(store::rank_member(large + 1, "0xb") < store::rank_member(large, "0xa"));
    assert!(store::rank_member(42, "0xa") < store::rank_member(42, "0xb"));

    let (_process, mut conn) = redis_process().await;
    let xp = Contribution::new(Metric::Xp, addr(2), 10);
    store::commit(&mut conn, 1, SEPTEMBER, &[]).await.unwrap();
    store::commit(&mut conn, 2, SEPTEMBER_LAST, std::slice::from_ref(&xp))
        .await
        .unwrap();
    store::commit(&mut conn, 2, SEPTEMBER_LAST, std::slice::from_ref(&xp))
        .await
        .unwrap();
    assert_eq!(total(&mut conn, "xp", 2).await.as_deref(), Some("10"));
    // Every character contributes to its address: no roster limit.
    let many = vec![Contribution::new(Metric::Xp, addr(7), 123); 500];
    store::commit(&mut conn, 3, SEPTEMBER_LAST, &many)
        .await
        .unwrap();
    assert_eq!(total(&mut conn, "xp", 7).await.as_deref(), Some("61500"));

    // Redis executes HSET even when a later ZADD fails: real EXEC partial success.
    let rank_key = "leaderboards:xp:rank";
    let _: () = redis::cmd("DEL")
        .arg(rank_key)
        .query_async(&mut conn)
        .await
        .unwrap();
    set(&mut conn, rank_key, "wrong type").await;
    let failed = store::commit(&mut conn, 4, SEPTEMBER_LAST, std::slice::from_ref(&xp)).await;
    assert!(failed.is_err());
    assert_eq!(total(&mut conn, "xp", 2).await.as_deref(), Some("20"));
    let meta: Meta = serde_json::from_str(&get(&mut conn, META_KEY).await.unwrap()).unwrap();
    assert_eq!(meta.checkpoint, 3);
    assert!(get(&mut conn, PENDING_KEY).await.is_some());
    let _: () = redis::cmd("DEL")
        .arg(rank_key)
        .query_async(&mut conn)
        .await
        .unwrap();
    // A framework batch replay starts BEFORE the pending checkpoint.
    store::commit(&mut conn, 3, SEPTEMBER_LAST, &many)
        .await
        .unwrap();
    store::commit(&mut conn, 4, SEPTEMBER_LAST, std::slice::from_ref(&xp))
        .await
        .unwrap();
    assert_eq!(total(&mut conn, "xp", 2).await.as_deref(), Some("20"));
    let members: Vec<String> = redis::cmd("ZRANGE")
        .arg(rank_key)
        .arg(0)
        .arg(-1)
        .query_async(&mut conn)
        .await
        .unwrap();
    // (the test itself deleted the rank key, so only the replayed checkpoint ranks)
    assert_eq!(members, [store::rank_member(20, &addr(2).hex())]);
    // A lost acknowledgement leaves the write-ahead batch: reapplying it is a no-op.
    let next = Meta {
        checkpoint: 5,
        timestamp_ms: SEPTEMBER_LAST,
        reset_at_ms: OCTOBER,
    };
    let prepared = store::prepare(&mut conn, next, std::slice::from_ref(&xp), false)
        .await
        .unwrap();
    store::apply(&mut conn, &prepared).await.unwrap();
    set(
        &mut conn,
        PENDING_KEY,
        &serde_json::to_string(&prepared).unwrap(),
    )
    .await;
    store::commit(&mut conn, 5, SEPTEMBER_LAST, &[])
        .await
        .unwrap();
    assert_eq!(total(&mut conn, "xp", 2).await.as_deref(), Some("30"));

    // A monthly reset and a full rebuild produce identical rankings; dungeon completions
    // count once per fight and address, even across the reset.
    let (_first, mut a) = redis_process().await;
    let (_second, mut b) = redis_process().await;
    for conn in [&mut a, &mut b] {
        store::commit(conn, 1, SEPTEMBER, &[]).await.unwrap();
        let september = [
            dungeon(3),
            dungeon(3),
            Contribution::new(Metric::Marketplace, addr(2), u64::MAX),
        ];
        store::commit(conn, 2, SEPTEMBER_LAST, &september)
            .await
            .unwrap();
        assert_eq!(total(conn, "dungeons", 2).await.as_deref(), Some("1"));
        let october = Meta {
            checkpoint: 3,
            timestamp_ms: OCTOBER,
            reset_at_ms: NOVEMBER,
        };
        let facts = [
            dungeon(3),
            dungeon(4),
            Contribution::new(Metric::Marketplace, addr(2), 1),
        ];
        let prepared = store::prepare(conn, october, &facts, true).await.unwrap();
        store::apply(conn, &prepared).await.unwrap();
        // A lost acknowledgement during reset replays the same clear and absolute replacements.
        set(
            conn,
            PENDING_KEY,
            &serde_json::to_string(&prepared).unwrap(),
        )
        .await;
        store::commit(conn, 2, SEPTEMBER_LAST, &[dungeon(3)])
            .await
            .unwrap();
        store::commit(conn, 3, OCTOBER, &[dungeon(4)])
            .await
            .unwrap();
        assert_eq!(total(conn, "dungeons", 2).await.as_deref(), Some("1"));
        assert_eq!(total(conn, "marketplace", 2).await.as_deref(), Some("1"));
        let keys = store::ranking_keys(conn).await.unwrap();
        assert_eq!(keys.len(), 4);
        assert!(keys.iter().all(|key| key.split(':').count() == 3));
    }
    for metric in ["dungeons", "marketplace"] {
        let key = format!("leaderboards:{metric}:rank");
        let range = |conn: &mut MultiplexedConnection| {
            let mut conn = conn.clone();
            let key = key.clone();
            async move {
                redis::cmd("ZRANGE")
                    .arg(&key)
                    .arg(0)
                    .arg(-1)
                    .query_async::<Vec<String>>(&mut conn)
                    .await
                    .unwrap()
            }
        };
        assert_eq!(range(&mut a).await, range(&mut b).await);
    }
    store::commit(&mut a, 4, NOVEMBER, &[]).await.unwrap();
    assert!(store::ranking_keys(&mut a).await.unwrap().is_empty());

    // Obsolete ranking tables go when the current month initializes.
    let (_third, mut c) = redis_process().await;
    set(
        &mut c,
        META_KEY,
        r#"{"origin_epoch":100,"epoch":129,"checkpoint":1}"#,
    )
    .await;
    for key in [
        "leaderboards:0:xp:totals",
        "leaderboards:12:xp:rank",
        "leaderboards:xp:totals",
    ] {
        set(&mut c, key, "obsolete").await;
    }
    store::commit(&mut c, 2, SEPTEMBER, &[]).await.unwrap();
    assert!(store::ranking_keys(&mut c).await.unwrap().is_empty());
    let meta: Meta = serde_json::from_str(&get(&mut c, META_KEY).await.unwrap()).unwrap();
    assert_eq!((meta.reset_at_ms, meta.timestamp_ms), (OCTOBER, SEPTEMBER));
}

#[test]
fn activity_buckets_and_character_counts() {
    use analytics::*;
    // UTC buckets; weeks start on Monday; 2026-08-29 falls in the month of 2026-08-01.
    assert_eq!(bucket_15m(BUCKET_15M_MS + 42), BUCKET_15M_MS);
    assert_eq!(bucket_hour(3_600_042), 3_600_000);
    assert_eq!(bucket_day(DAY_MS + 42), DAY_MS);
    assert_eq!(bucket_week(4 * DAY_MS + 42), 4 * DAY_MS);
    assert_eq!(bucket_month(1_787_961_600_000), 1_785_542_400_000);
    // Day, week and month series all keep 400 days.
    for (tier, _, _, retention) in activity_buckets(DAY_MS) {
        let long = matches!(tier, "day" | "week" | "month");
        assert_eq!(retention == LONG_RETENTION_MS, long, "{tier}");
    }

    // Live characters count a birth and a certified deletion, never a custody move.
    let hero = |byte| character(id(byte), OwnerKind::Object(id(90)));
    let writes = run(&[
        OwnedTx {
            outputs: vec![hero(1)],
            ..tx()
        },
        OwnedTx {
            inputs: vec![hero(2)],
            outputs: vec![character(id(2), OwnerKind::Object(id(91)))],
            ..tx()
        },
        OwnedTx {
            inputs: vec![hero(3)],
            deleted: vec![hero(3)],
            ..tx()
        },
    ]);
    let deltas = writes
        .iter()
        .filter_map(|write| match write {
            Write::Character(fact) => Some(fact.delta),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(deltas, [1, -1]);
}
