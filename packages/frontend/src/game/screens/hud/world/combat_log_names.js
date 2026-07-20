// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure combat-log name resolution, split out of WorldChat.jsx for bun:test coverage (mirrors the
// compass_math.js co-location pattern — presentation logic a .jsx test can't cheaply import directly).

/**
 * A combat-log segment's CURRENT display text. `ref` (set on caster/target/death name segments — see
 * fight.js LogSegment) is a fighter/participant id: when the LIVE fight.fighters map still has that entity,
 * its CURRENT name wins over the segment's AT-EMIT-TIME `text` — so a mob whose identity resolves AFTER its
 * first hit landed (dungeon_store `_resolve_mob_identities` racing fight_bridge's 'Mob' placeholder — the
 * literal "Mob hit … for N" bug) heals to the real template name on the very next render, for every past line
 * that referenced it. Falls back to `text` once the fighter is gone (fight ended) or for `ref`-less segments
 * (verbs/spells/numbers) — never worse than the old snapshot.
 * @param {{ text: string, ref?: string }} seg
 * @param {Map<string, { name?: string }> | undefined} fighters
 * @returns {string}
 */
export const resolve_segment_text = (seg, fighters) => (seg.ref && fighters?.get(seg.ref)?.name) || seg.text
