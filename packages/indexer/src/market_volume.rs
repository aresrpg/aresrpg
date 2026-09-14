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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_uses_the_same_checkpoint_field_and_exact_large_money() {
        let packed = commands(42, 123456789, 9007199254740993).get_packed_pipeline();
        assert_eq!(
            packed,
            commands(42, 123456789, 9007199254740993).get_packed_pipeline()
        );
        let wire = String::from_utf8(packed).unwrap();
        assert!(wire.contains("HSET"));
        assert!(wire.contains("market:volume:day:1"));
        assert!(wire.contains("123456789:9007199254740993"));
        assert!(!wire.contains("INCR"));
        assert!(wire.contains("EXPIREAT"));
    }

    #[test]
    fn zero_replay_removes_any_previous_subtotal() {
        let wire = String::from_utf8(commands(42, 123456789, 0).get_packed_pipeline()).unwrap();
        assert!(wire.contains("HDEL"));
        assert!(wire.contains("SETNX"));
        assert!(!wire.contains("HSET"));
    }
}
