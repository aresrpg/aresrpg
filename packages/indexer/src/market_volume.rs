// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Timestamped absolute checkpoint totals. Daily hashes bound reads; exact cutoffs stay in the reader.

use crate::analytics::DAY_MS;

pub fn commands(checkpoint: u64, ts_ms: u64, mist: u128) -> redis::Pipeline {
    let mut commands = redis::pipe();
    commands
        .atomic()
        .cmd("SETNX")
        .arg("market:volume:first_timestamp")
        .arg(ts_ms)
        .ignore();
    let key = format!("market:volume:day:{}", ts_ms / DAY_MS);
    if mist > 0 {
        commands
            .cmd("HSET")
            .arg(&key)
            .arg(checkpoint)
            .arg(format!("{ts_ms}:{mist}"))
            .ignore();
        // Absolute expiry also bounds historical replay, rather than extending old buckets from wall time.
        commands
            .cmd("EXPIREAT")
            .arg(&key)
            .arg(((ts_ms / DAY_MS + 32) * DAY_MS) / 1000)
            .ignore();
    } else {
        commands.cmd("HDEL").arg(&key).arg(checkpoint).ignore();
    }
    commands
}
