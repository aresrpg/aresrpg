//! The one native dynamic field holding the active currency's two trade balances.
//! Native field types avoid introducing an indexed type origin during a game upgrade.

use anyhow::{ensure, Result};
use std::collections::BTreeSet;

use crate::decode::{self, Balance, Field, Id, Trade};
use crate::ownership::{ObjView, OwnerKind, SUI_FRAMEWORK};
use crate::publish::TxView;

fn is_trade(object: &ObjView<'_>, game: &str) -> bool {
    object.type_key.package == game
        && object.type_key.module == "trade"
        && object.type_key.name == "Trade"
}

fn field_parent(object: &ObjView<'_>, tx: &TxView<'_>, game: &str) -> Option<Id> {
    let OwnerKind::Object(parent) = object.owner else {
        return None;
    };
    let tag = object.type_key;
    let balance = format!("vector<{SUI_FRAMEWORK}::balance::Balance<");
    if tag.package != SUI_FRAMEWORK
        || tag.module != "dynamic_field"
        || tag.name != "Field"
        || tag.type_params.len() != 2
        || tag.type_params[0] != "vector<u8>"
        || !tag.type_params[1].starts_with(&balance)
        || !tag.type_params[1].ends_with(">>")
    {
        return None;
    }
    // Check the typed parent BEFORE decoding a native key that any foreign package can create.
    tx.inputs
        .iter()
        .chain(tx.outputs)
        .find(|row| row.id == parent && is_trade(row, game))?;
    Some(parent)
}

fn balances(object: &ObjView<'_>, tx: &TxView<'_>, game: &str) -> Result<Option<(Id, [u64; 2])>> {
    let Some(parent) = field_parent(object, tx, game) else {
        return Ok(None);
    };
    let field: Field<Vec<u8>, Vec<Balance>> = decode::from_bytes(object.bytes)?;
    if field.name != b"kares" {
        return Ok(None);
    }
    ensure!(
        field.value.len() == 2,
        "trade currency field must contain exactly two balances"
    );
    Ok(Some((parent, [field.value[0].value, field.value[1].value])))
}

/// Parent projection runs first. Child-only changes never create an unverified Trade node.
pub fn project(tx: &TxView<'_>, game: &str, checkpoint: u64) -> Result<Vec<String>> {
    let mut writes = vec![];
    for gone in tx.deleted {
        if tx.outputs.iter().any(|row| row.id == gone.id) {
            continue;
        }
        if let Some((parent, _)) = balances(gone, tx, game)? {
            writes.push(write(parent, [0, 0], checkpoint));
        }
    }
    for output in tx.outputs {
        if let Some((parent, values)) = balances(output, tx, game)? {
            writes.push(write(parent, values, checkpoint));
        }
    }
    Ok(writes)
}

fn write(parent: Id, values: [u64; 2], checkpoint: u64) -> String {
    format!("MATCH (v:Trade {{id: '{}'}}) SET v.token_a = '{}', v.token_b = '{}', v.ckpt = {checkpoint}",
        parent.hex(), values[0], values[1])
}

/// Read-only parents can appear without outputs; only certified deletions end a trade.
pub fn changes(tx: &TxView<'_>, game: &str) -> Result<Vec<(Trade, bool)>> {
    let mut changed = BTreeSet::new();
    for object in tx.outputs.iter().chain(tx.deleted) {
        if is_trade(object, game) {
            changed.insert(object.id.hex());
        }
        if let Some((parent, _)) = balances(object, tx, game)? {
            changed.insert(parent.hex());
        }
    }
    changed
        .into_iter()
        .map(|id| {
            let parent = tx
                .outputs
                .iter()
                .chain(tx.inputs)
                .find(|row| row.id.hex() == id && is_trade(row, game))
                .ok_or_else(|| anyhow::anyhow!("trade change lacks its typed parent"))?;
            let deleted = tx.deleted.iter().any(|row| row.id == parent.id)
                && !tx.outputs.iter().any(|row| row.id == parent.id);
            Ok((decode::from_bytes(parent.bytes)?, deleted))
        })
        .collect()
}

#[cfg(test)]
#[path = "../tests/trade_tokens/mod.rs"]
mod tests;
