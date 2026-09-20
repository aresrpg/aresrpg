// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Checkpoint child writes invalidate their Character, independently of nearby zone viewers.
use crate::decode::{self, Checkpoint, CheckpointKey, Field, Id};
use crate::graph::{current_world_output, df_parent, field_key};
use crate::ownership::ObjView;

pub fn changed(
    inputs: &[ObjView<'_>],
    outputs: &[ObjView<'_>],
    game: &str,
) -> anyhow::Result<Vec<(usize, Id)>> {
    let key = format!("{game}::world::CheckpointKey");
    let mut result = Vec::new();
    for (index, output) in outputs.iter().enumerate() {
        if field_key(output.type_key) != Some(key.as_str())
            || inputs
                .iter()
                .any(|input| input.id == output.id && input.bytes == output.bytes)
        {
            continue;
        }
        let Some((character, _)) = df_parent(output, outputs, game, "character", "Character")
        else {
            continue;
        };
        let field = decode::from_bytes::<Field<CheckpointKey, Checkpoint>>(output.bytes)?;
        if current_world_output(outputs, &character, game)?
            .is_some_and(|world| world != field.name.0)
        {
            continue;
        }
        if !result.iter().any(|(_, id)| *id == character) {
            result.push((index, character));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ownership::{OwnerKind, SUI_FRAMEWORK, TypeKey};

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
        assert_eq!(
            changed(&[], &[output.clone()], "0xgame").unwrap(),
            vec![(0, character)]
        );
        assert!(
            changed(&[output.clone()], &[output.clone()], "0xgame")
                .unwrap()
                .is_empty()
        );
        assert!(
            changed(&[], &[output.clone()], "0xother")
                .unwrap()
                .is_empty()
        );
        let outputs = [output.clone()];
        let tx = crate::publish::TxView {
            tx_index: 3,
            sender: crate::decode::Addr([3; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs: &outputs,
        };
        let wire = crate::publish::analyze(7, 42, &[tx], "0xgame", "0xseed").unwrap();
        assert_eq!(wire.publications.len(), 1);
        assert_eq!(
            wire.publications[0].channel,
            format!("evt:character:{}", character.hex())
        );
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "CharacterCheckpointChanged");
        assert_eq!(payload["data"]["character"], character.hex());
        let foreign = ObjView {
            owner: OwnerKind::Shared,
            ..output
        };
        assert!(changed(&[], &[foreign], "0xgame").unwrap().is_empty());
    }
}
