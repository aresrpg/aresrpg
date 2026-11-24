// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

use crate::publish::{TxView, Wire};

/// Certified destruction invalidates the owner's observed roster after projection completes.
pub fn route(wire: &mut Wire, tx: &TxView<'_>, game: &str) {
    for object in tx.deleted {
        if !object.type_key.is(game, "character", "Character")
            || tx.outputs.iter().any(|output| output.id == object.id)
        {
            continue;
        }
        wire.publish(
            [format!("evt:character:{}", object.id.hex())],
            tx.tx_index,
            0,
            "CharacterDeleted",
            serde_json::json!({ "character": object.id.hex() }),
        );
    }
}
