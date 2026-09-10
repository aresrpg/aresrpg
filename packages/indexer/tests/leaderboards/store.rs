use super::*;
use crate::decode::{Addr, Id};

async fn commit(
    conn: &mut MultiplexedConnection,
    checkpoint: u64,
    ts_ms: u64,
    facts: &[Contribution],
) -> Result<()> {
    super::commit(conn, checkpoint, ts_ms, facts).await
}

const SEPTEMBER: u64 = 1_788_220_800_000;
const SEPTEMBER_LAST: u64 = 1_790_812_799_999;
const OCTOBER: u64 = 1_790_812_800_000;
const NOVEMBER: u64 = 1_793_491_200_000;

#[test]
fn exact_order_and_calendar_boundaries() {
    assert_eq!(next_reset(SEPTEMBER).unwrap(), OCTOBER);
    assert_eq!(next_reset(SEPTEMBER_LAST).unwrap(), OCTOBER);
    assert_eq!(next_reset(OCTOBER).unwrap(), NOVEMBER);
    assert_eq!(next_reset(1_706_745_600_000).unwrap(), 1_709_251_200_000); // leap February
    assert_eq!(next_reset(1_796_083_200_000).unwrap(), 1_798_761_600_000); // December → January
    let large = 9_007_199_254_740_992u128;
    assert!(rank_member(large + 1, "0xb") < rank_member(large, "0xa"));
    assert!(rank_member(42, "0xa") < rank_member(42, "0xb"));
    assert!(rank_member(u128::MAX, "0xa") < rank_member(1, "0xa"));
}

#[test]
fn dungeon_dedup_is_per_fight_and_address_even_after_monthly_reset() {
    let completion = |fight, address| Contribution {
        metric: Metric::Dungeons,
        address: Addr([address; 32]),
        amount: 1,
        dungeon_fight: Some(Id([fight; 32])),
    };
    let facts = vec![
        completion(1, 2),
        completion(1, 2),
        completion(1, 3),
        completion(4, 2),
    ];
    let (totals, markers) = aggregate(&facts, &BTreeSet::new()).unwrap();
    assert_eq!(totals[&(Metric::Dungeons, Addr([2; 32]).hex())], 2);
    assert_eq!(totals[&(Metric::Dungeons, Addr([3; 32]).hex())], 1);
    let (after_reset, _) = aggregate(&facts, &markers.into_iter().collect()).unwrap();
    assert!(after_reset.is_empty());
}

#[test]
fn every_character_contributes_xp_to_the_address_without_a_roster_limit() {
    let facts = (0..500)
        .map(|_| Contribution::new(Metric::Xp, Addr([7; 32]), 123))
        .collect::<Vec<_>>();
    let (totals, _) = aggregate(&facts, &BTreeSet::new()).unwrap();
    assert_eq!(totals[&(Metric::Xp, Addr([7; 32]).hex())], 61_500);
}

struct RedisProcess {
    child: std::process::Child,
    socket: std::path::PathBuf,
}
impl Drop for RedisProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.socket);
    }
}

async fn redis_process() -> (RedisProcess, MultiplexedConnection) {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let socket = std::env::temp_dir().join(format!("ares-lb-{}-{nonce}.sock", std::process::id()));
    // macOS's default temp directory can exceed the Unix socket path limit.
    let socket = if socket.as_os_str().len() > 100 {
        std::path::PathBuf::from(format!("/tmp/ares-lb-{}-{nonce}.sock", std::process::id()))
    } else {
        socket
    };
    let child = std::process::Command::new("redis-server")
        .args([
            "--port",
            "0",
            "--save",
            "",
            "--appendonly",
            "no",
            "--unixsocket",
        ])
        .arg(&socket)
        .stdout(std::process::Stdio::null())
        .spawn()
        .expect("Redis integration tests require redis-server on PATH");
    let process = RedisProcess { child, socket };
    let client = redis::Client::open(format!("redis+unix://{}", process.socket.display())).unwrap();
    for _ in 0..100 {
        if let Ok(conn) = client.get_multiplexed_async_connection().await {
            return (process, conn);
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("isolated Redis did not start");
}

async fn total(conn: &mut MultiplexedConnection, metric: &str, address: u8) -> Option<String> {
    redis::cmd("HGET")
        .arg(format!("leaderboards:{metric}:totals"))
        .arg(Addr([address; 32]).hex())
        .query_async(conn)
        .await
        .unwrap()
}

#[tokio::test]
async fn redis_partial_exec_and_lost_ack_recover_without_duplicate_scores() {
    let (_process, mut conn) = redis_process().await;
    let xp = Contribution::new(Metric::Xp, Addr([2; 32]), 10);
    commit(&mut conn, 1, SEPTEMBER, &[]).await.unwrap();
    commit(&mut conn, 2, SEPTEMBER_LAST, std::slice::from_ref(&xp))
        .await
        .unwrap();
    commit(&mut conn, 2, SEPTEMBER_LAST, std::slice::from_ref(&xp))
        .await
        .unwrap();
    assert_eq!(total(&mut conn, "xp", 2).await.as_deref(), Some("10"));

    // Redis executes HSET even when a later ZADD fails. This is real EXEC partial success,
    // not a mock pretending Redis rolls back runtime errors.
    let rank_key = "leaderboards:xp:rank";
    let _: () = redis::cmd("DEL")
        .arg(rank_key)
        .query_async(&mut conn)
        .await
        .unwrap();
    let _: () = redis::cmd("SET")
        .arg(rank_key)
        .arg("wrong type")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(
        commit(&mut conn, 3, SEPTEMBER_LAST, std::slice::from_ref(&xp))
            .await
            .is_err()
    );
    assert_eq!(total(&mut conn, "xp", 2).await.as_deref(), Some("20"));
    assert_eq!(
        read_json::<Meta>(&mut conn, META_KEY)
            .await
            .unwrap()
            .unwrap()
            .checkpoint,
        2
    );
    assert!(read_json::<Prepared>(&mut conn, PENDING_KEY)
        .await
        .unwrap()
        .is_some());
    let _: () = redis::cmd("DEL")
        .arg(rank_key)
        .query_async(&mut conn)
        .await
        .unwrap();

    // A framework batch replay starts BEFORE the pending checkpoint.
    commit(&mut conn, 2, SEPTEMBER_LAST, std::slice::from_ref(&xp))
        .await
        .unwrap();
    commit(&mut conn, 3, SEPTEMBER_LAST, std::slice::from_ref(&xp))
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
    assert_eq!(members, vec![rank_member(20, &Addr([2; 32]).hex())]);

    let prepared = prepare(
        &mut conn,
        Meta {
            checkpoint: 4,
            timestamp_ms: SEPTEMBER_LAST,
            reset_at_ms: OCTOBER,
        },
        &[xp],
        false,
    )
    .await
    .unwrap();
    apply(&mut conn, &prepared).await.unwrap();
    // Lost acknowledgement leaves the write-ahead batch for reapplication.
    let _: () = redis::cmd("SET")
        .arg(PENDING_KEY)
        .arg(serde_json::to_string(&prepared).unwrap())
        .query_async(&mut conn)
        .await
        .unwrap();
    commit(&mut conn, 4, SEPTEMBER_LAST, &[]).await.unwrap();
    assert_eq!(total(&mut conn, "xp", 2).await.as_deref(), Some("30"));
}

#[tokio::test]
async fn redis_monthly_reset_and_full_rebuild_produce_identical_current_rankings() {
    let (_first, mut a) = redis_process().await;
    let (_second, mut b) = redis_process().await;
    let dungeon = |fight| Contribution {
        metric: Metric::Dungeons,
        address: Addr([2; 32]),
        amount: 1,
        dungeon_fight: Some(Id([fight; 32])),
    };
    for conn in [&mut a, &mut b] {
        commit(conn, 1, SEPTEMBER, &[]).await.unwrap();
        commit(
            conn,
            2,
            SEPTEMBER_LAST,
            &[
                dungeon(3),
                dungeon(3),
                Contribution::new(Metric::Marketplace, Addr([2; 32]), u64::MAX),
            ],
        )
        .await
        .unwrap();
        assert_eq!(total(conn, "dungeons", 2).await.as_deref(), Some("1"));
        let prepared = prepare(
            conn,
            Meta {
                checkpoint: 3,
                timestamp_ms: OCTOBER,
                reset_at_ms: NOVEMBER,
            },
            &[
                dungeon(3),
                dungeon(4),
                Contribution::new(Metric::Marketplace, Addr([2; 32]), 1),
            ],
            true,
        )
        .await
        .unwrap();
        apply(conn, &prepared).await.unwrap();
        // Lost acknowledgement during reset must replay the same clear + absolute replacements.
        let _: () = redis::cmd("SET")
            .arg(PENDING_KEY)
            .arg(serde_json::to_string(&prepared).unwrap())
            .query_async(conn)
            .await
            .unwrap();
        commit(conn, 2, SEPTEMBER_LAST, &[dungeon(3)])
            .await
            .unwrap();
        commit(conn, 3, OCTOBER, &[dungeon(4)]).await.unwrap();
        assert_eq!(total(conn, "dungeons", 2).await.as_deref(), Some("1"));
        assert_eq!(total(conn, "marketplace", 2).await.as_deref(), Some("1"));
        let keys = ranking_keys(conn).await.unwrap();
        assert_eq!(keys.len(), 4);
        assert!(keys.iter().all(|key| key.split(':').count() == 3));
    }
    for metric in ["dungeons", "marketplace"] {
        let key = format!("leaderboards:{metric}:rank");
        let left: Vec<String> = redis::cmd("ZRANGE")
            .arg(&key)
            .arg(0)
            .arg(-1)
            .query_async(&mut a)
            .await
            .unwrap();
        let right: Vec<String> = redis::cmd("ZRANGE")
            .arg(&key)
            .arg(0)
            .arg(-1)
            .query_async(&mut b)
            .await
            .unwrap();
        assert_eq!(left, right);
    }
    commit(&mut a, 4, NOVEMBER, &[]).await.unwrap();
    assert!(ranking_keys(&mut a).await.unwrap().is_empty());
}

#[tokio::test]
async fn obsolete_ranking_tables_are_removed_when_the_current_month_initializes() {
    let (_process, mut conn) = redis_process().await;
    let _: () = redis::cmd("SET")
        .arg(META_KEY)
        .arg(r#"{"origin_epoch":100,"epoch":129,"checkpoint":1}"#)
        .query_async(&mut conn)
        .await
        .unwrap();
    for key in [
        "leaderboards:0:xp:totals",
        "leaderboards:12:xp:rank",
        "leaderboards:xp:totals",
    ] {
        let _: () = redis::cmd("SET")
            .arg(key)
            .arg("obsolete")
            .query_async(&mut conn)
            .await
            .unwrap();
    }
    commit(&mut conn, 2, SEPTEMBER, &[]).await.unwrap();
    assert!(ranking_keys(&mut conn).await.unwrap().is_empty());
    let meta = read_json::<Meta>(&mut conn, META_KEY)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(meta.reset_at_ms, OCTOBER);
    assert_eq!(meta.timestamp_ms, SEPTEMBER);
}

#[test]
fn wire_metric_vocabulary_matches_the_indexer() {
    let protocol = include_str!("../../../protocol/src/leaderboards.ts");
    for metric in [
        Metric::Xp,
        Metric::Kills,
        Metric::Dungeons,
        Metric::Jobs,
        Metric::Marketplace,
        Metric::Kolizeum,
        Metric::Zones,
        Metric::Feeding,
        Metric::Gathering,
    ] {
        assert!(protocol.contains(&format!("'{}'", metric.key())));
    }
}
