// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Changed projected character state invalidates the full roster, independently of embodiment.
use crate::decode::{Checkpoint, CheckpointKey, Field, Id};
use crate::graph::{character_field, current_world_output, df_parent, CharacterField};
use crate::ownership::ObjView;

fn parent(output: &ObjView<'_>, outputs: &[ObjView<'_>], game: &str) -> anyhow::Result<Option<Id>> {
    let key = output.type_key;
    if key.is(game, "character", "Character") {
        return Ok(Some(output.id));
    }
    let Some(kind) = key.field_key().and_then(|key| character_field(key, game)) else {
        return Ok(None);
    };
    let Some((character, _)) = df_parent(output, outputs, game, "character", "Character") else {
        return Ok(None);
    };
    if kind == CharacterField::Checkpoint {
        let field = output.decode::<Field<CheckpointKey, Checkpoint>>()?;
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
            || gone
                .type_key
                .field_key()
                .and_then(|key| character_field(key, game))
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
