// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE 240-SPELL CONFORMANCE TOOTH — the owner's bar, verbatim: "all spells working as they should."
//
// spell_conformance_engine.js folds EVERY authored spell × level × effect through the REAL reducer and asserts
// its resolution matches its AUTHORED definition (AP debit, damage magnitude + element, stat/resist SIGN +
// magnitude, timed-row duration, self/enemy targeting). This gate:
//   1. proves the fold is DETERMINISTIC (same table twice),
//   2. proves the authored durations EXPIRE by ticking the real per-turn plumbing,
//   3. FAILS on any mismatch outside the documented BASELINE — the tooth. The baseline only ever SHRINKS
//      (a fix removes its rows; a new divergence has nowhere to hide).
//
// MISSING-ARTIFACT (#96): the authored corpus is content (private seed repo → asset-host blob), absent by design in
// this repo. The tooth runs where the corpus is materialized at `seed/mainnet/spells/` (gitignored) — locally
// and in the seed-side parity gate; here in the public CI it SKIPS LOUDLY (never silently green).

import { describe, expect, test } from 'bun:test'

import {
  CORPUS,
  SPELLS_CORPUS_AVAILABLE,
  conform_corpus,
  prove_expiry,
} from './spell_conformance_engine.js'

// ── THE BASELINE — known-red conformance rows, each with its root cause. RATCHET LAW: this set only shrinks. ──
// A fix that resolves a row makes it drop out of the fold, and the stale-baseline assertion below then FAILS
// until the row is deleted here — so the baseline can never drift upward or hide a regression.
//
// SPELL-CONF-MARTYRS — RESOLVED. ikari_martyrs_call (6 levels) double-encoded its strength-debuff sign: a
// NEGATIVE value (-8..-33) AND FLAG_NEGATIVE. `normalize_effect` (spell_templates.js) now decodes ALTER_STAT/
// ALTER_RESIST/STEAL_STAT the way the chain does — magnitude = abs(value), direction = the flag alone (the
// seed writer emits `Math.abs(value)` on-chain; Move's Effect.value is u64) — so it never trusts a raw corpus
// row's own sign for these kinds. The baseline is empty: any future sign_magnitude mismatch is a NEW regression.
const BASELINE = new Set([])

const key = f => `${f.spell_id}:L${f.level}:${f.slot}:${f.axis}`

describe('the 240-spell conformance sweep — authored corpus vs the fold', () => {
  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'drives every authored spell × level × effect through the real reducer',
    () => {
      const { stats } = conform_corpus()
      expect(CORPUS).toHaveLength(240)
      expect(stats.spells).toBe(240)
      expect(stats.levels).toBe(1440) // 240 spells × 6 level variants — no sampling
      expect(stats.effects_driven).toBeGreaterThan(4000)
      expect(stats.ap_checks).toBeGreaterThan(1300)
      expect(stats.pass_axes).toBeGreaterThan(13000)
    },
  )

  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'the fold is deterministic — the same table twice',
    () => {
      const a = conform_corpus()
      const b = conform_corpus()
      expect(b.findings).toEqual(a.findings)
      expect(b.gaps).toEqual(a.gaps)
      expect(b.stats).toEqual(a.stats)
    },
  )

  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'authored durations expire by ticking the real per-turn plumbing (④ tick the fight)',
    () => {
      // One representative timed effect per row-minting mechanism — each must clear at EXACTLY its authored turn.
      const pick = (kind, want_turns) =>
        CORPUS.flatMap(s => s.levels.flatMap(l => l.effects ?? [])).find(
          e =>
            e.kind === kind &&
            e.turns > 0 &&
            (!want_turns || e.turns === want_turns),
        )
      for (const kind of [9, 11, 21, 22, 24, 25, 27, 29]) {
        const raw = pick(kind)
        if (!raw) continue
        const proof = prove_expiry(raw, 4)
        expect(proof).toMatchObject({ ok: true })
        expect(proof.cleared_after).toBe(Math.max(1, raw.turns))
      }
    },
  )

  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'THE TOOTH — no conformance mismatch outside the documented baseline; baseline never stale',
    () => {
      const { findings } = conform_corpus()
      const found = new Set(findings.map(key))

      // (a) No NEW divergence: every mismatch must be a documented baseline row.
      const unexpected = findings.filter(f => !BASELINE.has(key(f)))
      expect(unexpected.map(f => `${key(f)} — ${f.detail}`)).toEqual([])

      // (b) RATCHET: every baseline row must still be red — a fixed row must be DELETED from the baseline, so the
      // set can only shrink and can never mask a regression.
      const stale = [...BASELINE].filter(k => !found.has(k))
      expect(stale).toEqual([])
    },
  )
})
