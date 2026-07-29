// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The ONE BCS decode door for chain payloads whose type is ALREADY known.
//!
//! Every caller here has discriminated the payload before asking: an event by its
//! `(module, name)`, a dynamic field by its key TYPE parameter, an object by its
//! `type_()`. So a decode failure is never "these bytes were something else" — it is
//! "our Rust mirror in [`super::model`] no longer matches its Move source", i.e. a BUG,
//! and the event or object is silently DROPPED from the read model.
//!
//! That silence is what made #1579 a release blocker: `fight_events::TurnStarted` grew two
//! trailing `u64`s on chain, the mirror stayed 4 fields wide, `bcs::from_bytes` refused the
//! 16 trailing bytes, and a bare `.ok()?` turned the only writer of `$.status = "active"`
//! into a no-op — for EVERY fight, for weeks, while `/v1/status` kept reporting
//! `indexed: true`. The house law is "no silent failures, ever" (`.claude/rules/craft.md`);
//! this module is that law's mechanical home for the decode seam.
//!
//! ## Loud, not fatal
//! A failure logs at ERROR with `sentry_event = true` — the same envelope `main.rs` uses for
//! panics and terminal errors, so the JSONL shipper forwards it to Sentry and its occurrence
//! count on the fingerprint IS the counter (`packages/rpc/README.md`). It does NOT fail the
//! pipeline: with no package allowlist configured, ANY published package can emit a
//! look-alike `fight_events::TurnStarted` with junk bytes, so a hard failure would hand a
//! stranger an indexer halt. Loud + dropped is the honest middle: the operator sees it, the
//! cache stays a cache.
//!
//! ## Decade rate-limiting
//! A mirror mismatch is DETERMINISTIC — it fails identically for every occurrence, and a
//! backfill from genesis replays millions. So each `{domain}::{name}` logs on occurrence
//! 1, 10, 100, … carrying the running total: the first line is immediate, the volume stays
//! bounded, and the count never lies.
//!
//! The one decode that is legitimately a SHAPE PROBE — `snapshot::world_shell`, where the
//! decode itself is the discriminator — deliberately does NOT come through this door and
//! says so at its definition.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::de::DeserializeOwned;
use tracing::error;

/// Occurrence counts per `{domain}::{name}`. Bounded by the handler's own match arms (a
/// payload is only decoded under a name we recognise), so this never grows unbounded.
static FAILURES: Mutex<BTreeMap<String, u64>> = Mutex::new(BTreeMap::new());

/// BCS-decode an already-discriminated payload. `domain` is the Move module for an event
/// (`"fight_events"`), or the payload family for a snapshot (`"object"` / `"df"`); `name` is
/// the Move struct. `None` means the decode FAILED and was reported — never a quiet skip.
pub(super) fn decode_bcs<T: DeserializeOwned>(
    domain: &str,
    name: &str,
    contents: &[u8],
) -> Option<T> {
    match bcs::from_bytes::<T>(contents) {
        Ok(value) => Some(value),
        Err(failure) => {
            report(domain, name, contents.len(), &failure);
            None
        }
    }
}

/// Whether this occurrence number is a decade boundary (1, 10, 100, …).
fn is_decade(occurrences: u64) -> bool {
    let mut decade = 1_u64;
    while decade < occurrences {
        match decade.checked_mul(10) {
            Some(next) => decade = next,
            None => return false,
        }
    }
    decade == occurrences
}

/// Report a hand-rolled cursor walk (`snapshot::ByteReader`) that ran off an
/// already-discriminated payload. Same class as a failed [`decode_bcs`]: the layout moved on
/// chain and the walk's byte widths did not follow, so the field is DROPPED.
pub(super) fn report_parse_failure(domain: &str, name: &str, wire_bytes: usize, reason: &str) {
    report(domain, name, wire_bytes, &reason);
}

fn report(domain: &str, name: &str, wire_bytes: usize, error_chain: &dyn std::fmt::Display) {
    let culprit = format!("{domain}::{name}");
    let occurrences = {
        let mut counts = FAILURES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let slot = counts.entry(culprit.clone()).or_insert(0);
        *slot += 1;
        *slot
    };
    if !is_decade(occurrences) {
        return;
    }
    error!(
        sentry_event = true,
        error_type = "bcs_decode",
        culprit = %culprit,
        wire_bytes,
        occurrences,
        error_chain = %error_chain,
        sentry_fingerprint = %format!("indexer:bcs_decode:{culprit}"),
        "BCS decode FAILED for a known chain payload — it is DROPPED from the read model. \
         `RemainingInput` = the Rust mirror in handlers/ares/model.rs is NARROWER than its \
         Move struct (fields were added on chain); an end-of-input error = it is WIDER. \
         Fix the mirror field-for-field against packages/move, then reindex."
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decades_are_the_only_reported_occurrences() {
        let reported: Vec<u64> = (1..=1_001).filter(|n| is_decade(*n)).collect();
        assert_eq!(reported, vec![1, 10, 100, 1_000]);
    }

    #[test]
    fn a_narrow_mirror_reports_and_drops_instead_of_returning_garbage() {
        // Two trailing u64s the mirror does not know about — the #1579 shape exactly.
        let wire = bcs::to_bytes(&(1_u64, 2_u64, 3_u64)).unwrap();
        let decoded: Option<(u64, u64)> = decode_bcs("test", "NarrowMirror", &wire);
        assert!(decoded.is_none(), "trailing input must never decode");
        // …and it was COUNTED, not swallowed: the whole point of #1579.
        let counted = |name: &str| {
            let counts = FAILURES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            counts.get(&format!("test::{name}")).copied().unwrap_or(0)
        };
        assert_eq!(counted("NarrowMirror"), 1);
        let _: Option<(u64, u64)> = decode_bcs("test", "NarrowMirror", &wire);
        assert_eq!(
            counted("NarrowMirror"),
            2,
            "every occurrence counts, even when not logged"
        );
    }

    #[test]
    fn a_matching_mirror_decodes() {
        let wire = bcs::to_bytes(&(7_u64, 9_u64)).unwrap();
        assert_eq!(
            decode_bcs::<(u64, u64)>("test", "ExactMirror", &wire),
            Some((7, 9))
        );
    }
}
