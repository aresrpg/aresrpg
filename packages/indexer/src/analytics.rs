// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Replay-safe dashboard facts and bucket policy.

use crate::decode::Addr;

pub const BUCKET_15M_MS: u64 = 15 * 60 * 1_000;
pub const HOUR_MS: u64 = 60 * 60 * 1_000;
pub const DAY_MS: u64 = 24 * 60 * 60 * 1_000;
pub const WEEK_MS: u64 = 7 * DAY_MS;
pub const INTERVAL_RETENTION_MS: u64 = 2 * DAY_MS;
pub const HOURLY_RETENTION_MS: u64 = 8 * DAY_MS;
pub const WEEKLY_RETENTION_MS: u64 = 105 * DAY_MS;
pub const MONTHLY_RETENTION_MS: u64 = 400 * DAY_MS;
pub const DAILY_ACTIVITY_RETENTION_MS: u64 = 400 * DAY_MS;
pub const ROYALTY_FLOOR_MIST: u64 = 10_000_000;
pub const CHARACTER_CREATION_MIST: u64 = 1_000_000_000;

pub const ADDRESS_FIRST_SEEN_KEY: &str = "analytics:addresses";
pub const TRANSACTIONS_ALL_KEY: &str = "analytics:transactions:all";
pub const GAS_ALL_KEY: &str = "analytics:gas:all";

pub fn bucket_15m(ts_ms: u64) -> u64 {
    ts_ms / BUCKET_15M_MS * BUCKET_15M_MS
}

pub fn bucket_day(ts_ms: u64) -> u64 {
    ts_ms / DAY_MS * DAY_MS
}

pub fn bucket_hour(ts_ms: u64) -> u64 {
    ts_ms / HOUR_MS * HOUR_MS
}

pub fn bucket_week(ts_ms: u64) -> u64 {
    let monday_offset = 4 * DAY_MS;
    ts_ms.saturating_sub(monday_offset) / WEEK_MS * WEEK_MS + monday_offset
}

// Howard Hinnant's civil calendar transform, kept local to avoid a calendar dependency.
fn civil_from_days(days: i64) -> (i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month)
}

fn days_from_civil(year: i64, month: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * shifted_month + 2) / 5;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

pub fn bucket_month(ts_ms: u64) -> u64 {
    let (year, month) = civil_from_days((ts_ms / DAY_MS) as i64);
    (days_from_civil(year, month) as u64) * DAY_MS
}

pub fn activity_buckets(ts_ms: u64) -> [(&'static str, u64, u64, u64); 5] {
    [
        (
            "15m",
            bucket_15m(ts_ms),
            BUCKET_15M_MS,
            INTERVAL_RETENTION_MS,
        ),
        ("hour", bucket_hour(ts_ms), HOUR_MS, HOURLY_RETENTION_MS),
        ("day", bucket_day(ts_ms), DAY_MS, 0),
        ("week", bucket_week(ts_ms), WEEK_MS, WEEKLY_RETENTION_MS),
        (
            "month",
            bucket_month(ts_ms),
            31 * DAY_MS,
            MONTHLY_RETENTION_MS,
        ),
    ]
}

pub fn royalty_mist(gross_mist: u64) -> u64 {
    (gross_mist / 10).max(ROYALTY_FLOOR_MIST)
}

pub fn expiry_seconds(bucket_ms: u64, bucket_width_ms: u64, retention_ms: u64) -> u64 {
    (bucket_ms + bucket_width_ms + retention_ms) / 1_000
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MoneyDelta {
    pub item_royalty_mist: u64,
    pub character_royalty_mist: u64,
    pub character_creation_mist: u64,
    pub kolizeum_mist: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoneyFact {
    pub coordinate: String,
    pub ts_ms: u64,
    pub delta: MoneyDelta,
}

impl MoneyFact {
    pub fn value(&self) -> String {
        serde_json::json!({
            "ts_ms": self.ts_ms,
            "item_royalty_mist": self.delta.item_royalty_mist.to_string(),
            "character_royalty_mist": self.delta.character_royalty_mist.to_string(),
            "character_creation_mist": self.delta.character_creation_mist.to_string(),
            "kolizeum_mist": self.delta.kolizeum_mist.to_string(),
        })
        .to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityFact {
    pub address: Addr,
    pub ts_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransactionFact {
    pub checkpoint: u64,
    pub count: u64,
    pub gas_mist: i64,
    pub ts_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterFact {
    pub coordinate: String,
    pub delta: i8,
    pub ts_ms: u64,
}

impl CharacterFact {
    pub fn value(&self) -> String {
        serde_json::json!({ "ts_ms": self.ts_ms, "delta": self.delta }).to_string()
    }
}

pub fn series_key(domain: &str, tier: &str, bucket: u64) -> String {
    format!("analytics:{domain}:{tier}:{bucket}")
}

#[cfg(test)]
mod tests {
    use super::{
        bucket_15m, bucket_day, bucket_hour, bucket_month, bucket_week, royalty_mist,
        BUCKET_15M_MS, DAY_MS,
    };

    #[test]
    fn checkpoint_time_selects_utc_buckets() {
        assert_eq!(bucket_15m(BUCKET_15M_MS + 42), BUCKET_15M_MS);
        assert_eq!(bucket_day(DAY_MS + 42), DAY_MS);
        assert_eq!(bucket_hour(3_600_042), 3_600_000);
        assert_eq!(bucket_week(4 * DAY_MS + 42), 4 * DAY_MS);
        assert_eq!(bucket_month(1_787_961_600_000), 1_785_542_400_000); // 2026-08-29 → 2026-08-01
    }

    #[test]
    fn royalty_uses_ten_percent_with_the_floor() {
        assert_eq!(royalty_mist(1), 10_000_000);
        assert_eq!(royalty_mist(100_000_000), 10_000_000);
        assert_eq!(royalty_mist(1_000_000_000), 100_000_000);
    }
}
