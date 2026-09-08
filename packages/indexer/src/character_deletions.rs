// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

use crate::ownership::ObjView;
use crate::publish::{envelope, Publication, TxView, Wire};

/// Certified destruction invalidates the owner's observed roster after projection completes.
pub fn route(
    wire: &mut Wire,
    checkpoint: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    deleted: &[ObjView<'_>],
    game: &str,
) {
    for object in deleted {
        let key = object.type_key;
        if key.package != game || key.module != "character" || key.name != "Character" {
            continue;
        }
        if tx.outputs.iter().any(|output| output.id == object.id) {
            continue;
        }
        wire.publications.push(Publication {
            channel: format!("evt:character:{}", object.id.hex()),
            payload: envelope(
                checkpoint,
                tx.tx_index,
                0,
                ts_ms,
                "CharacterDeleted",
                serde_json::json!({ "character": object.id.hex() }),
            ),
        });
    }
}

#[cfg(test)]
#[path = "../tests/character_deletions/events.rs"]
mod tests;
