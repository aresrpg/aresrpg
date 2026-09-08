// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
use crate::decode::{self, Field, Id, MarkerKey};
use crate::graph::{project, CheckpointView};
use crate::ownership::{ObjView, OwnerKind, TypeKey, SUI_FRAMEWORK};

const GAME: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

struct FieldFixture {
    id: Id,
    owner: Id,
    ty: TypeKey,
    bytes: Vec<u8>,
}
impl FieldFixture {
    fn view(&self) -> ObjView<'_> {
        ObjView {
            id: self.id,
            version: 2,
            owner: OwnerKind::Object(self.owner),
            type_key: &self.ty,
            bytes: &self.bytes,
        }
    }
}
fn listing(kiosk: u8, price: u64) -> FieldFixture {
    let id = Id([kiosk + 10; 32]);
    FieldFixture {
        id,
        owner: Id([kiosk; 32]),
        ty: TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec![format!("{SUI_FRAMEWORK}::kiosk::Listing"), "u64".into()],
        },
        bytes: bcs::to_bytes(&Field {
            id,
            name: decode::KioskListingKey {
                id: Id([1; 32]),
                is_exclusive: false,
            },
            value: price,
        })
        .unwrap(),
    }
}
fn run(room: u8) -> FieldFixture {
    let id = Id([30; 32]);
    FieldFixture {
        id,
        owner: Id([2; 32]),
        ty: TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec![
                format!("{GAME}::dungeon::DungeonRunKey"),
                format!("{GAME}::dungeon::DungeonRun"),
            ],
        },
        bytes: bcs::to_bytes(&Field {
            id,
            name: true as MarkerKey,
            value: decode::DungeonRun {
                dungeon: "test".into(),
                room: room.into(),
                seed: 7,
            },
        })
        .unwrap(),
    }
}
fn world(name: &str, x: u32) -> [FieldFixture; 2] {
    let current = Id([40; 32]);
    let checkpoint = Id([41; 32]);
    [
        FieldFixture {
            id: current,
            owner: Id([2; 32]),
            ty: TypeKey {
                package: SUI_FRAMEWORK.into(),
                module: "dynamic_field".into(),
                name: "Field".into(),
                type_params: vec![
                    format!("{GAME}::world::CurrentWorldKey"),
                    "0x1::string::String".into(),
                ],
            },
            bytes: bcs::to_bytes(&Field {
                id: current,
                name: false,
                value: name.to_string(),
            })
            .unwrap(),
        },
        FieldFixture {
            id: checkpoint,
            owner: Id([2; 32]),
            ty: TypeKey {
                package: SUI_FRAMEWORK.into(),
                module: "dynamic_field".into(),
                name: "Field".into(),
                type_params: vec![
                    format!("{GAME}::world::CheckpointKey"),
                    format!("{GAME}::world::Checkpoint"),
                ],
            },
            bytes: bcs::to_bytes(&Field {
                id: checkpoint,
                name: decode::CheckpointKey(name.into()),
                value: decode::Checkpoint {
                    x,
                    z: 5,
                    at_ms: 10,
                    pet: false,
                },
            })
            .unwrap(),
        },
    ]
}

fn statements(outputs: &[ObjView<'_>], deleted: &[ObjView<'_>]) -> Vec<String> {
    project(
        &CheckpointView {
            lamport_version: 2,
            ckpt: 9,
            ts_ms: 100,
            outputs,
            deleted,
            custody: &[],
            market: &[],
            fight_lifecycle: &[],
        },
        GAME,
    )
    .unwrap()
}
async fn query(
    connection: &mut redis::aio::MultiplexedConnection,
    graph: &str,
    cypher: &str,
) -> redis::Value {
    redis::cmd("GRAPH.QUERY")
        .arg(graph)
        .arg(cypher)
        .arg("--compact")
        .query_async(connection)
        .await
        .unwrap()
}
async fn apply(
    connection: &mut redis::aio::MultiplexedConnection,
    graph: &str,
    statements: &[String],
) {
    for statement in statements {
        query(connection, graph, statement).await;
    }
}

fn scalar(result: redis::Value) -> redis::Value {
    let redis::Value::Array(response) = result else {
        panic!("response array")
    };
    let redis::Value::Array(rows) = &response[1] else {
        panic!("rows array")
    };
    let redis::Value::Array(columns) = &rows[0] else {
        panic!("columns array")
    };
    let redis::Value::Array(value) = &columns[0] else {
        panic!("typed scalar")
    };
    value[1].clone()
}

/// Explicit local integration gate: FALKOR_TEST_URL=redis://127.0.0.1:<disposable-port> cargo test ... -- --ignored.
#[tokio::test]
#[ignore = "requires an isolated local FalkorDB"]
async fn final_relations_survive_transaction_order_and_partial_replay() {
    let url = std::env::var("FALKOR_TEST_URL").expect("set isolated local FALKOR_TEST_URL");
    assert!(url.starts_with("redis://127.0.0.1:"));
    let mut connection = redis::Client::open(url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let graph = format!("projection_regression_{}", std::process::id());
    query(
        &mut connection,
        &graph,
        &format!(
            "CREATE (:Item {{id: '{}'}}), (:Character {{id: '{}'}})",
            Id([1; 32]).hex(),
            Id([2; 32]).hex()
        ),
    )
    .await;
    let old = listing(3, 100);
    let replacement = listing(4, 200);
    let first = statements(&[old.view()], &[]);
    let relist = statements(&[replacement.view()], &[old.view()]);
    apply(&mut connection, &graph, &first).await;
    apply(&mut connection, &graph, &relist).await;
    let expected = query(
        &mut connection,
        &graph,
        "MATCH (:Item)-[l:LISTED_IN]->(k:Kiosk) RETURN k.id, l.price",
    )
    .await;
    let text = format!("{expected:?}");
    assert!(text.contains(&Id([4; 32]).hex()), "{text}");
    assert!(text.contains("200"), "{text}");
    // A crash after the first replacement statement followed by complete checkpoint replay.
    apply(&mut connection, &graph, &relist[..1]).await;
    apply(&mut connection, &graph, &first).await;
    apply(&mut connection, &graph, &relist).await;
    let replay = query(
        &mut connection,
        &graph,
        "MATCH (:Item)-[l:LISTED_IN]->(k:Kiosk) RETURN k.id, l.price",
    )
    .await;
    // Statistics differ, compare the result rows (second response element).
    let redis::Value::Array(expected_parts) = expected else {
        panic!("invalid query response")
    };
    let redis::Value::Array(replay_parts) = replay else {
        panic!("invalid query response")
    };
    assert_eq!(expected_parts[1], replay_parts[1]);
    // A later deletion must win, while an old source deletion cannot delete another kiosk's relist.
    apply(&mut connection, &graph, &statements(&[], &[old.view()])).await;
    let kept = query(
        &mut connection,
        &graph,
        "MATCH (:Item)-[l:LISTED_IN]->() RETURN count(l)",
    )
    .await;
    assert_eq!(scalar(kept), redis::Value::Int(1));
    apply(
        &mut connection,
        &graph,
        &statements(&[], &[replacement.view()]),
    )
    .await;
    let gone = query(
        &mut connection,
        &graph,
        "MATCH (:Item)-[l:LISTED_IN]->() RETURN count(l)",
    )
    .await;
    assert_eq!(scalar(gone), redis::Value::Int(0));
    let old_run = run(0);
    let new_run = run(1);
    apply(&mut connection, &graph, &statements(&[old_run.view()], &[])).await;
    apply(
        &mut connection,
        &graph,
        &statements(&[new_run.view()], &[old_run.view()]),
    )
    .await;
    let survived = query(
        &mut connection,
        &graph,
        "MATCH (c:Character) RETURN c.dungeon_room",
    )
    .await;
    assert_eq!(scalar(survived), redis::Value::Int(1));
    let first_world = world("first", 10);
    let second_world = world("second", 20);
    // Checkpoint fields can precede CurrentWorld in a transaction's object enumeration.
    for fields in [&first_world, &second_world] {
        apply(
            &mut connection,
            &graph,
            &statements(&[fields[1].view(), fields[0].view()], &[]),
        )
        .await;
    }
    assert_eq!(
        scalar(
            query(
                &mut connection,
                &graph,
                "MATCH (c:Character) RETURN c.world"
            )
            .await
        ),
        redis::Value::BulkString(b"second".to_vec())
    );
    assert_eq!(
        scalar(query(&mut connection, &graph, "MATCH (c:Character) RETURN c.x").await),
        redis::Value::Int(20)
    );
    let _: redis::Value = redis::cmd("GRAPH.DELETE")
        .arg(&graph)
        .query_async(&mut connection)
        .await
        .unwrap();
}
