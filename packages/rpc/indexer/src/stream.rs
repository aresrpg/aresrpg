// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[cfg(test)]
mod tests {
    use super::{
        active_presence_rows, presence_changes, replay_tail, FightCursor, PresenceChange,
        PresenceRecord,
    };
    use std::collections::BTreeSet;

    const WORLD: &str = "0x00000000000000000000000000000000000000000000000000000000000000aa";
    const ALICE: &str = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const BOB: &str = "0x0000000000000000000000000000000000000000000000000000000000000002";

    #[test]
    fn stored_events_replay_from_a_mid_cursor_yields_exactly_the_tail() {
        let stored = [
            r#"000002:0004|{"id":"90:7","kind":"Placed","data":{"cell":"4"},"digest":"a","version":"1"}"#,
            r#"000003:0001|{"id":"90:11","kind":"Ready","data":{},"digest":"b","version":"2"}"#,
            r#"000000:0000|{"id":"91:0","kind":"TurnStarted","data":{"turn":"1"},"digest":"c","version":"3"}"#,
        ];

        let tail = replay_tail(stored, Some(FightCursor::new(90, 7))).unwrap();

        assert_eq!(
            tail.into_iter().map(|event| event.id).collect::<Vec<_>>(),
            [FightCursor::new(90, 11), FightCursor::new(91, 0)]
        );
    }

    #[test]
    fn presence_ttl_lapse_emits_leave() {
        let alice = PresenceRecord::new(WORLD, Some(ALICE), None);
        let bob = PresenceRecord::new(WORLD, Some(BOB), None);
        let rows = vec![
            (serde_json::to_string(&alice).unwrap(), 30_000),
            (serde_json::to_string(&bob).unwrap(), 45_000),
        ];
        let before = active_presence_rows(rows.clone(), 29_999);
        let after = active_presence_rows(rows, 30_001);

        assert_eq!(
            before,
            BTreeSet::from_iter([alice.clone(), bob.clone()])
        );
        assert_eq!(after, BTreeSet::from_iter([bob]));
        assert_eq!(
            presence_changes(&before, &after),
            vec![PresenceChange::Leave(alice)]
        );
    }
}
