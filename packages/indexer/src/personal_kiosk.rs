// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Personal ownership is immutable. Kiosk.owner is editable display metadata, never authority.

use crate::decode::{self, Addr, Field, Id, MarkerKey, PersonalKioskCap};
use crate::ownership::{ObjView, OwnerKind, SUI_FRAMEWORK};
use anyhow::{ensure, Result};
use std::collections::HashMap;

pub const PACKAGES: [&str; 2] = [
    "0x06f6bdd3f2e2e759d8a4b9c252f379f7a05e72dfe4c0b9311cdac27b8eb791b1",
    "0x0cb4bcc0560340eb1a1b929cabe56b33fc6449820ec8c1980d69bb98b649b802",
];

#[derive(Debug, Clone, Copy)]
pub struct Owner {
    pub address: Addr,
    pub cap: Option<Id>,
}

fn proof(view: &ObjView<'_>) -> Result<Option<(Id, Owner)>> {
    let key = view.type_key;
    if PACKAGES.contains(&key.package.as_str())
        && key.module == "personal_kiosk"
        && key.name == "PersonalKioskCap"
    {
        let cap: PersonalKioskCap = decode::from_bytes(view.bytes)?;
        if let (OwnerKind::Address(address), Some(inner)) = (view.owner, cap.cap) {
            return Ok(Some((
                inner.for_,
                Owner {
                    address,
                    cap: Some(cap.id),
                },
            )));
        }
    }
    let marker = key.package == SUI_FRAMEWORK
        && key.module == "dynamic_field"
        && key.name == "Field"
        && key
            .type_params
            .get(1)
            .is_some_and(|value| value == "address")
        && PACKAGES.iter().any(|package| {
            key.type_params.first() == Some(&format!("{package}::personal_kiosk::OwnerMarker"))
        });
    if marker {
        let field: Field<MarkerKey, Addr> = decode::from_bytes(view.bytes)?;
        if let OwnerKind::Object(kiosk) = view.owner {
            return Ok(Some((
                kiosk,
                Owner {
                    address: field.value,
                    cap: None,
                },
            )));
        }
    }
    Ok(None)
}

/// Inputs matter: an existing personal cap can be borrowed immutably and never appear in outputs.
pub fn owners<'a>(views: impl IntoIterator<Item = &'a ObjView<'a>>) -> Result<HashMap<Id, Owner>> {
    let mut owners = HashMap::<Id, Owner>::new();
    for view in views {
        if let Some((kiosk, owner)) = proof(view)? {
            if let Some(previous) = owners.get_mut(&kiosk) {
                ensure!(
                    previous.address == owner.address,
                    "personal kiosk ownership proofs disagree: {}",
                    kiosk.hex()
                );
                previous.cap = owner.cap.or(previous.cap);
            } else {
                owners.insert(kiosk, owner);
            }
        }
    }
    Ok(owners)
}

pub fn owner(inputs: &[ObjView<'_>], outputs: &[ObjView<'_>], kiosk: Id) -> Result<Option<Addr>> {
    Ok(owners(inputs.iter().chain(outputs))?
        .get(&kiosk)
        .map(|owner| owner.address))
}

#[cfg(test)]
#[path = "../tests/leaderboards/personal_kiosk.rs"]
mod tests;
