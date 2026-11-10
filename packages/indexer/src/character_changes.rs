// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Changed projected character state invalidates the full roster, independently of embodiment.
use crate::decode::{self, Checkpoint, CheckpointKey, Field, Id};
use crate::graph::{character_field, current_world_output, df_parent, field_key, CharacterField};
use crate::ownership::ObjView;

fn parent(output: &ObjView<'_>, outputs: &[ObjView<'_>], game: &str) -> anyhow::Result<Option<Id>> {
    let key = output.type_key;
    if key.package == game && key.module == "character" && key.name == "Character" {
        return Ok(Some(output.id));
    }
    let Some(kind) = field_key(key).and_then(|key| character_field(key, game)) else {
        return Ok(None);
    };
    let Some((character, _)) = df_parent(output, outputs, game, "character", "Character") else {
        return Ok(None);
    };
    if kind == CharacterField::Checkpoint {
        let field = decode::from_bytes::<Field<CheckpointKey, Checkpoint>>(output.bytes)?;
        if current_world_output(outputs, &character, game)?
            .is_some_and(|world| world != field.name.0)
        {
            return Ok(None);
        }
    }
    Ok(Some(character))
}

pub fn changed(
    inputs: &[ObjView<'_>],
    outputs: &[ObjView<'_>],
    deleted: &[ObjView<'_>],
    game: &str,
) -> anyhow::Result<Vec<(usize, Id)>> {
    let mut result = Vec::new();
    for (index, output) in outputs.iter().enumerate() {
        if inputs
            .iter()
            .any(|input| input.id == output.id && input.bytes == output.bytes)
        {
            continue;
        }
        if let Some(character) = parent(output, outputs, game)? {
            if !result.iter().any(|(_, id)| *id == character) {
                result.push((index, character));
            }
        }
    }
    // DungeonRun is the removable Character field; projection clears its parent on certified deletion.
    for (index, gone) in deleted.iter().enumerate() {
        if outputs.iter().any(|output| output.id == gone.id)
            || field_key(gone.type_key).and_then(|key| character_field(key, game))
                != Some(CharacterField::DungeonRun)
        {
            continue;
        }
        if let Some(character) = parent(gone, outputs, game)? {
            if !result.iter().any(|(_, id)| *id == character) {
                result.push((outputs.len() + index, character));
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ownership::{OwnerKind, TypeKey, SUI_FRAMEWORK};

    fn field_type(path: &str) -> TypeKey {
        TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec![format!("0xgame::{path}"), "fixture".into()],
        }
    }

    #[test]
    fn projected_character_field_families_deduplicate_and_ignore_unchanged_versions() {
        let character = Id([1; 32]);
        for path in [
            "progression::HpKey",
            "progression::JobXpKey",
            "progression::SpellBookKey",
            "equipment::FoldedKey",
            "equipment::EquipmentKey",
            "world::CurrentWorldKey",
            "dungeon::DungeonRunKey",
            "gathering::AmbushKey",
        ] {
            let key = field_type(path);
            // Invalidation compares opaque values; graph.rs remains the existing typed decoder.
            let output = ObjView {
                id: Id([2; 32]),
                version: 2,
                owner: OwnerKind::Object(character),
                type_key: &key,
                bytes: &[2],
            };
            let unchanged = ObjView {
                version: 1,
                ..output.clone()
            };
            assert!(
                changed(&[unchanged], std::slice::from_ref(&output), &[], "0xgame")
                    .unwrap()
                    .is_empty(),
                "{path}"
            );
            let before = ObjView {
                bytes: &[1],
                ..output.clone()
            };
            assert_eq!(
                changed(&[before], &[output.clone(), output], &[], "0xgame").unwrap(),
                vec![(0, character)],
                "{path}"
            );
        }
        let foreign = field_type("foreign::EquipmentKey");
        let output = ObjView {
            id: Id([2; 32]),
            version: 2,
            owner: OwnerKind::Object(character),
            type_key: &foreign,
            bytes: &[2],
        };
        assert!(changed(&[], &[output], &[], "0xgame").unwrap().is_empty());
    }

    #[test]
    fn character_root_stats_and_xp_changes_invalidate_once() {
        let key = TypeKey {
            package: "0xgame".into(),
            module: "character".into(),
            name: "Character".into(),
            type_params: vec![],
        };
        let root = ObjView {
            id: Id([1; 32]),
            version: 2,
            owner: OwnerKind::Object(Id([9; 32])),
            type_key: &key,
            bytes: &[2],
        };
        let before = ObjView {
            version: 1,
            bytes: &[1],
            ..root.clone()
        };
        assert_eq!(
            changed(&[before], std::slice::from_ref(&root), &[], "0xgame").unwrap(),
            vec![(0, root.id)]
        );
        assert!(changed(
            std::slice::from_ref(&root),
            std::slice::from_ref(&root),
            &[],
            "0xgame"
        )
        .unwrap()
        .is_empty());
        assert!(changed(&[], &[root], &[], "0xother").unwrap().is_empty());
    }

    #[test]
    fn non_current_world_checkpoints_are_silent_and_current_world_checkpoints_invalidate() {
        let character = Id([1; 32]);
        let world_key = field_type("world::CurrentWorldKey");
        let checkpoint_key = field_type("world::CheckpointKey");
        let current_bytes = bcs::to_bytes(&Field {
            id: Id([2; 32]),
            name: false,
            value: "current".to_string(),
        })
        .unwrap();
        let current = ObjView {
            id: Id([2; 32]),
            version: 2,
            owner: OwnerKind::Object(character),
            type_key: &world_key,
            bytes: &current_bytes,
        };
        for (world, expected) in [("old", false), ("current", true)] {
            let bytes = bcs::to_bytes(&Field {
                id: Id([3; 32]),
                name: CheckpointKey(world.into()),
                value: Checkpoint {
                    x: 1,
                    z: 2,
                    at_ms: 3,
                    pet: false,
                },
            })
            .unwrap();
            let checkpoint = ObjView {
                id: Id([3; 32]),
                version: 2,
                owner: OwnerKind::Object(character),
                type_key: &checkpoint_key,
                bytes: &bytes,
            };
            assert_eq!(
                !changed(
                    std::slice::from_ref(&current),
                    &[current.clone(), checkpoint],
                    &[],
                    "0xgame"
                )
                .unwrap()
                .is_empty(),
                expected
            );
        }
    }

    #[test]
    fn a_removed_dungeon_run_invalidates_only_after_certified_deletion() {
        let key = field_type("dungeon::DungeonRunKey");
        let character = Id([1; 32]);
        let gone = ObjView {
            id: Id([2; 32]),
            version: 1,
            owner: OwnerKind::Object(character),
            type_key: &key,
            bytes: &[1],
        };
        assert!(changed(std::slice::from_ref(&gone), &[], &[], "0xgame")
            .unwrap()
            .is_empty());
        assert_eq!(
            changed(
                std::slice::from_ref(&gone),
                &[],
                std::slice::from_ref(&gone),
                "0xgame"
            )
            .unwrap(),
            vec![(0, character)]
        );
    }

    #[test]
    fn job_field_write_invalidates_its_character_without_a_world_checkpoint() {
        let character = Id([1; 32]);
        let bytes = bcs::to_bytes(&Field {
            id: Id([2; 32]),
            name: decode::JobXpKey("HERBALIST".into()),
            value: 1300u64,
        })
        .unwrap();
        let key = TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec!["0xgame::progression::JobXpKey".into(), "u64".into()],
        };
        let output = ObjView {
            id: Id([2; 32]),
            version: 2,
            owner: OwnerKind::Object(character),
            type_key: &key,
            bytes: &bytes,
        };
        assert_eq!(
            changed(&[], &[output], &[], "0xgame").unwrap(),
            vec![(0, character)]
        );
    }

    #[test]
    fn captured_checkpoint_targets_only_its_character_and_unchanged_writes_are_silent() {
        // Testnet Field<CheckpointKey, Checkpoint>, 0xa75ea0…f46a @ v981006460,
        // character 0x1c493b…7d69, captured 2026-08-19 (same capture as decode.rs).
        let bytes = hex::decode(concat!(
            "a75ea0140fd96747a34866269e67d55496baf09cabcff5d7d140176f240bf46a",
            "0e30315f66697273745f73686f7265",
            "50c3000050c3000070dde70ea001000000"
        ))
        .unwrap();
        let key = TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec![
                "0xgame::world::CheckpointKey".into(),
                "0xgame::world::Checkpoint".into(),
            ],
        };
        let character = Id([1; 32]);
        let output = ObjView {
            id: Id([2; 32]),
            version: 981006460,
            owner: OwnerKind::Object(character),
            type_key: &key,
            bytes: &bytes,
        };
        let outputs = std::slice::from_ref(&output);
        assert_eq!(
            changed(&[], outputs, &[], "0xgame").unwrap(),
            vec![(0, character)]
        );
        assert!(changed(outputs, outputs, &[], "0xgame").unwrap().is_empty());
        assert!(changed(&[], outputs, &[], "0xother").unwrap().is_empty());
        let tx = crate::publish::TxView {
            deleted: &[],
            tx_index: 3,
            sender: crate::decode::Addr([3; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs,
        };
        let wire = crate::publish::analyze(7, 42, &[tx], "0xgame", "0xseed").unwrap();
        assert_eq!(wire.publications.len(), 1);
        assert_eq!(
            wire.publications[0].channel,
            format!("evt:character:{}", character.hex())
        );
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "CharacterChanged");
        assert_eq!(payload["data"]["character"], character.hex());
        let foreign = ObjView {
            owner: OwnerKind::Shared,
            ..output
        };
        assert!(changed(&[], &[foreign], &[], "0xgame").unwrap().is_empty());
    }
}
