use super::*;
use crate::decode::Addr;

fn row(id: &str, side: &str, exclusive: bool, price: &str) -> SalesRow {
    SalesRow {
        address: Addr([7; 32]),
        ts_ms: 1000,
        member: format!(
            "{id}|{}",
            json!({
                "side": side, "exclusive": exclusive, "price_mist": price, "name": "Gnawed branch",
                "kind": "item", "amount": 10, "item_type": "gnawed_branch", "ts_ms": 1000,
            })
        ),
    }
}

#[test]
fn public_sales_emit_one_seller_event_per_sale_with_exact_money() {
    let rows = vec![
        row("9:0:1", "sold", false, "9007199254740993"),
        row("9:0:1", "bought", false, "9007199254740993"),
        row("9:0:2", "sold", true, "10"),
        row("9:0:3", "sold", false, "0"),
        row("9:1:4", "sold", false, "25"),
    ];
    let notifications = extract(&rows, &["digest-a".into(), "digest-b".into()]).unwrap();
    assert_eq!(notifications.len(), 2);
    assert_eq!(notifications[0]["seller"], Addr([7; 32]).hex());
    assert_eq!(notifications[0]["price_mist"], "9007199254740993");
    assert_eq!(notifications[1]["id"], "9:1:4:sale");
    assert_eq!(notifications[1]["digest"], "digest-b");
    assert!(extract(&rows, &[]).is_err());
}
