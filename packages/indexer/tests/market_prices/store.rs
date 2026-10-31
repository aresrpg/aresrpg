use super::*;
use crate::test_redis::redis_process;

fn sale(item_type: &str, mist: u64, units: u64) -> Sale {
    Sale {
        item_type: item_type.into(),
        mist,
        units,
    }
}

#[test]
fn mixed_lots_retain_exact_money_and_units_before_division() {
    let sales = [
        sale("quartz", 1, 1),
        sale("quartz", 11, 10),
        sale("quartz", 91, 100),
        sale("quartz", 901, 1000),
    ];
    let totals = add(None, 42, &sales.iter().collect::<Vec<_>>()).unwrap();
    assert_eq!(totals.total_mist, "1004");
    assert_eq!(totals.units, "1111");
    assert_eq!(totals.sales, "4");
    let encoded = serde_json::to_string(&totals).unwrap();
    assert_eq!(add(Some(&encoded), 42, &[&sales[0]]).unwrap(), totals);
    assert_eq!(add(Some(&encoded), 41, &[&sales[0]]).unwrap(), totals);
    let big = sale("quartz", u64::MAX, 1);
    assert_eq!(
        add(None, 43, &[&big, &big]).unwrap().total_mist,
        (u128::from(u64::MAX) * 2).to_string()
    );
    assert!(add(None, 1, &[&sale("quartz", 1, 0)]).is_err());

    assert!(add(None, 1, &[&sale("quartz", 0, 1)]).is_err());
    assert!(add(Some("invalid"), 42, &[]).is_err());
}

#[test]
fn candles_follow_sale_order_and_compare_exact_unit_ratios() {
    let first = sale("wheat", 10, 10);
    let high = sale("wheat", 11, 10);
    let low = sale("wheat", 1, 1000);
    let close = sale("wheat", 50, 100);
    let totals = add(None, 1, &[&first, &high, &low, &close]).unwrap();
    let price = |sale: &Sale| UnitPrice {
        mist: sale.mist.to_string(),
        units: sale.units.to_string(),
    };
    assert_eq!(
        totals.ohlc,
        Some(Ohlc {
            open: price(&first),
            high: price(&high),
            low: price(&low),
            close: price(&close),
        })
    );
    let encoded = serde_json::to_string(&totals).unwrap();
    assert_eq!(add(Some(&encoded), 1, &[&high]).unwrap(), totals);
    let next = add(Some(&encoded), 2, &[&first]).unwrap().ohlc.unwrap();
    assert_eq!(next.open, price(&first));
    assert_eq!(next.high, price(&high));
    assert_eq!(next.low, price(&low));
    assert_eq!(next.close, price(&first));
    let near_one = sale("wheat", u64::MAX - 1, u64::MAX);
    let one = sale("wheat", u64::MAX, u64::MAX);
    let exact = add(None, 1, &[&one, &near_one]).unwrap().ohlc.unwrap();
    assert_eq!(exact.high, price(&one));
    assert_eq!(exact.low, price(&near_one));
}

#[test]
fn legacy_days_remain_readable_without_inventing_missing_extremes() {
    let legacy = r#"{"total_mist":"100","units":"10","sales":"1","checkpoint":5}"#;
    let next = add(Some(legacy), 6, &[&sale("wheat", 1, 1000)]).unwrap();
    assert_eq!(next.total_mist, "101");
    assert_eq!(next.units, "1010");
    assert_eq!(next.sales, "2");
    assert!(next.ohlc.is_none());
    let encoded = serde_json::to_string(&next).unwrap();
    assert!(!encoded.contains("ohlc"));
    assert_eq!(
        add(Some(&encoded), 6, &[&sale("wheat", 1, 1)]).unwrap(),
        next
    );
    assert!(add(None, 7, &[&sale("wheat", 1, 1000)])
        .unwrap()
        .ohlc
        .is_some());
}

#[tokio::test]
async fn starts_without_backfill_and_recovers_partial_writes_with_absolute_expiry() {
    let (_process, mut conn) = redis_process().await;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let key = format!("market:prices:day:{}", now / DAY_MS);
    commit(&mut conn, 1000, now, &[]).await.unwrap();
    let start: String = redis::cmd("GET")
        .arg(START_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(start, now.to_string());
    let quartz = sale("quartz", 91, 100);
    let wood = sale("wood", 11, 10);
    // The first field reached Redis, but the rest of the checkpoint did not.
    let first = serde_json::to_string(&add(None, 1001, &[&quartz]).unwrap()).unwrap();
    let _: () = redis::cmd("HSET")
        .arg(&key)
        .arg("quartz")
        .arg(&first)
        .query_async(&mut conn)
        .await
        .unwrap();
    commit(&mut conn, 1001, now, &[quartz.clone(), wood.clone()])
        .await
        .unwrap();
    commit(&mut conn, 1001, now, &[quartz.clone(), wood])
        .await
        .unwrap();
    let actual: String = redis::cmd("HGET")
        .arg(&key)
        .arg("quartz")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(actual, first);
    let fields: u64 = redis::cmd("HLEN")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(fields, 2);
    let expiry: u64 = redis::cmd("EXPIRETIME")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(expiry, (now / DAY_MS + RETENTION_DAYS + 1) * DAY_MS / 1000);
    commit(&mut conn, 1002, now, &[quartz]).await.unwrap();
    let actual: String = redis::cmd("HGET")
        .arg(&key)
        .arg("quartz")
        .query_async(&mut conn)
        .await
        .unwrap();
    let totals: Totals = serde_json::from_str(&actual).unwrap();
    assert_eq!(totals.total_mist, "182");
    assert_eq!(totals.units, "200");
    assert_eq!(totals.sales, "2");
    assert_eq!(totals.checkpoint, 1002);
    let old = now - 400 * DAY_MS;
    commit(&mut conn, 1, old, &[sale("old", 1, 1)])
        .await
        .unwrap();
    let exists: bool = redis::cmd("EXISTS")
        .arg(format!("market:prices:day:{}", old / DAY_MS))
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(!exists);
    let start_after: String = redis::cmd("GET")
        .arg(START_KEY)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(start_after, start);
}

#[test]
fn retention_matches_the_wire_contract() {
    let protocol = include_str!("../../../protocol/src/market_prices.ts");
    assert!(protocol.contains(&format!("MARKET_PRICE_RETENTION_DAYS = {RETENTION_DAYS}")));
}
